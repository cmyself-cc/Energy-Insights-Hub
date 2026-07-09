import * as cheerio from "cheerio";
import { registerCrawler, fetchWithTimeout, sleep, randomUserAgent } from "./index.js";

function buildSearchUrl(accountName) {
  return `https://weixin.sogou.com/weixin?type=1&query=${encodeURIComponent(accountName)}&ie=utf8`;
}

export function parseArticleList(html) {
  const $ = cheerio.load(html);
  const articles = [];

  $("li[id^='sogou_vr_']").each((_i, el) => {
    const $el = $(el);
    const titleEl = $el.find(".txt-box h3 a").first();
    const title = titleEl.text().trim();
    const href = titleEl.attr("href");
    const summary = $el.find(".txt-box p").first().text().trim();
    const timeText = $el.find(".s-p").attr("t") || "";
    const publishDate = timeText ? new Date(parseInt(timeText, 10) * 1000).toISOString() : new Date().toISOString();

    if (title && href) {
      articles.push({ title, summary, url: href, publishDate, rawContent: summary });
    }
  });

  return articles;
}

export async function fetchArticles(source) {
  const config = source.config || {};
  const accountName = config.accountName || source.name;
  const limit = config.articleLimit || 3;
  const lookbackHours = config.lookbackHours || 24;

  const searchUrl = buildSearchUrl(accountName);
  const res = await fetchWithTimeout(searchUrl, {
    headers: { "User-Agent": randomUserAgent(), "Referer": "https://weixin.sogou.com/" }
  });
  if (!res.ok) throw new Error(`Sogou search failed: HTTP ${res.status}`);

  const html = await res.text();
  let articles = parseArticleList(html).slice(0, limit);

  const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;
  articles = articles.filter(a => new Date(a.publishDate).getTime() >= cutoff);

  await sleep(500);
  return articles;
}

registerCrawler("wechat", { fetchArticles });
