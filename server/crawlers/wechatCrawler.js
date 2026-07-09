import * as cheerio from "cheerio";
import { registerCrawler, fetchWithTimeout, resolveUrl, sleep, randomUserAgent } from "./index.js";

const BASE_URL = "https://weixin.sogou.com";
const DEFAULT_ARTICLE_LIMIT = 3;
const DEFAULT_LOOKBACK_HOURS = 24;

function buildSearchUrl(accountName) {
  return `${BASE_URL}/weixin?type=2&query=${encodeURIComponent(accountName)}&ie=utf8`;
}

function parseConfig(source) {
  let config = source.config || {};
  if (typeof config === "string") {
    try {
      config = JSON.parse(config);
    } catch (err) {
      console.error("[wechat] Failed to parse source.config JSON string:", err.message);
      config = {};
    }
  }
  return config;
}

function extractTimestamp(sHtml) {
  const match = /timeConvert\('(\d+)'\)/.exec(sHtml);
  if (!match) return null;
  const seconds = parseInt(match[1], 10);
  return new Date(seconds * 1000).toISOString();
}

export function isAntiBotPage(html) {
  const lower = html.toLowerCase();
  const captchaMarkers = [
    "captcha",
    "antirobot",
    "请输入验证码",
    "验证码",
    "访问验证",
    "您的访问过于频繁",
  ];
  if (captchaMarkers.some((marker) => lower.includes(marker.toLowerCase()))) {
    return true;
  }

  const $ = cheerio.load(html);
  if ($("ul.news-list").length === 0) {
    const noResultsMarkers = ["找不到", "没有相关结果"];
    if (!noResultsMarkers.some((marker) => html.includes(marker))) {
      return true;
    }
  }

  return false;
}

export function parseArticleList(html, accountName = "") {
  const $ = cheerio.load(html);
  const articles = [];
  const targetName = accountName.trim().toLowerCase();

  $("ul.news-list > li[id^='sogou_vr_']").each((_i, el) => {
    try {
      const $el = $(el);
      const titleEl = $el.find(".txt-box h3 a").first();
      const title = titleEl.text().trim();
      const href = titleEl.attr("href");
      const summary = $el.find(".txt-box p.txt-info").first().text().trim();
      const publisher = $el.find(".s-p span.all-time-y2").first().text().trim();
      const publishDate = extractTimestamp($el.find(".s-p").html() || "") || new Date().toISOString();

      if (!title || !href) return;

      if (targetName && !publisher.toLowerCase().includes(targetName)) return;

      articles.push({
        title,
        summary,
        url: resolveUrl(BASE_URL, href),
        publishDate,
        rawContent: summary
      });
    } catch (err) {
      console.error("[wechat] Failed to parse article item:", err.message);
    }
  });

  return articles;
}

async function fetchArticles(source) {
  const config = parseConfig(source);
  const accountName = config.accountName || source.name || "";
  const limit = config.articleLimit || DEFAULT_ARTICLE_LIMIT;
  const lookbackHours = config.lookbackHours || DEFAULT_LOOKBACK_HOURS;

  const searchUrl = buildSearchUrl(accountName);
  const res = await fetchWithTimeout(searchUrl, {
    headers: { "User-Agent": randomUserAgent(), "Referer": BASE_URL }
  });
  if (!res.ok) throw new Error(`Sogou search failed: HTTP ${res.status}`);

  const html = await res.text();
  if (isAntiBotPage(html)) {
    throw new Error("Sogou anti-bot/captcha page detected");
  }

  let articles = parseArticleList(html, accountName).slice(0, limit);

  const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;
  articles = articles.filter(a => new Date(a.publishDate).getTime() >= cutoff);

  await sleep(500);
  return articles;
}

registerCrawler("wechat", { fetchArticles });
