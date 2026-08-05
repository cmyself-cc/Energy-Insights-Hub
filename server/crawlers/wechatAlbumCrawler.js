import { chromium } from "playwright";
import { stripBoilerplate, truncateAtSentence } from "./utils.js";

const WECHAT_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40(0x18002831) NetType/WIFI Language/zh_CN";

function parseConfig(source) {
  let config = source.config || {};
  if (typeof config === "string") {
    try {
      config = JSON.parse(config);
    } catch {
      config = {};
    }
  }
  return config;
}

async function createBrowserContext() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox"
    ]
  });

  const context = await browser.newContext({
    userAgent: WECHAT_UA,
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai"
  });

  // 隐藏 navigator.webdriver 等自动化标记
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  });

  return { browser, context };
}

async function extractAlbumArticles(context, albumUrl, limit = 20) {
  const page = await context.newPage();
  try {
    await page.goto(albumUrl, { waitUntil: "networkidle", timeout: 60000 });

    // 滚动到底部，触发懒加载，直到数量不再变化
    let lastCount = 0;
    let sameCount = 0;
    const maxScrolls = 30;
    for (let i = 0; i < maxScrolls; i++) {
      const count = await page.locator(".album__list-item").count();
      if (count === lastCount) {
        sameCount++;
        if (sameCount >= 2) break;
      } else {
        sameCount = 0;
      }
      lastCount = count;
      await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
      await page.waitForTimeout(1500);
    }

    const items = await page.locator(".album__list-item").evaluateAll(nodes =>
      nodes.map(n => ({
        title: n.getAttribute("data-title") || "",
        url: n.getAttribute("data-link") || ""
      }))
    );

    return items
      .filter(item => item.title && item.url)
      .slice(0, limit);
  } finally {
    await page.close();
  }
}

async function extractArticle(context, articleUrl) {
  const page = await context.newPage();
  try {
    await page.goto(articleUrl, { waitUntil: "networkidle", timeout: 60000 });

    // 摘要优先用 meta description
    const summary = await page
      .locator("meta[name=description]")
      .getAttribute("content")
      .catch(() => "");

    // 正文
    let rawContent = "";
    const contentSelectors = ["#js_content", ".rich_media_content", "article"];
    for (const selector of contentSelectors) {
      const text = await page.locator(selector).innerText().catch(() => "");
      if (text.trim()) {
        rawContent = text.trim();
        break;
      }
    }

    // 发布时间：扫描常见位置，优先匹配“YYYY年MM月DD日 HH:MM”格式
    const publishDateRaw = await page.evaluate(() => {
      const selectors = [
        "#publish_time",
        "#js_publish_time",
        "em#publish_time",
        ".rich_media_meta_text"
      ];
      for (const sel of selectors) {
        const els = Array.from(document.querySelectorAll(sel));
        for (const el of els) {
          const text = el.innerText?.trim() || "";
          const match = /(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(text);
          if (match) {
            const [, y, m, d] = match;
            return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
          }
        }
      }
      return "";
    });

    const cleanedContent = stripBoilerplate(rawContent);
    return {
      summary: truncateAtSentence(stripBoilerplate(summary), 200) || truncateAtSentence(cleanedContent, 200),
      rawContent: cleanedContent,
      publishDate: normalizeDate(publishDateRaw)
    };
  } finally {
    await page.close();
  }
}

function normalizeDate(dateStr) {
  if (!dateStr) return new Date().toISOString();
  const cleaned = dateStr
    .replace(/\//g, "-")
    .replace(/年|月/g, "-")
    .replace(/日/g, "");
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export async function fetchArticles(source) {
  const config = parseConfig(source);
  const albumUrl = source.url;
  const limit = config.articleLimit || 10;

  if (!albumUrl || !albumUrl.includes("mp.weixin.qq.com/mp/appmsgalbum")) {
    throw new Error("Invalid WeChat album URL");
  }

  const { browser, context } = await createBrowserContext();
  try {
    const listItems = await extractAlbumArticles(context, albumUrl, limit);
    if (listItems.length === 0) {
      throw new Error("No articles found in WeChat album");
    }

    const articles = [];
    for (const item of listItems) {
      try {
        const detail = await extractArticle(context, item.url);
        articles.push({
          title: item.title,
          ...detail,
          url: item.url
        });
      } catch (e) {
        console.error(`[wechat_album] Failed to fetch article ${item.url}:`, e.message);
      }
    }

    return articles;
  } finally {
    await context.close();
    await browser.close();
  }
}
