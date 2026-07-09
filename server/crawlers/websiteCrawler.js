import * as cheerio from "cheerio";
import { registerCrawler, fetchWithTimeout, resolveUrl, sleep, randomUserAgent } from "./index.js";

const DEFAULT_LIST_SELECTORS = [
  "article h2 a",
  "article h3 a",
  ".post-title a",
  ".entry-title a",
  ".news-list a",
  ".list-item a"
];

const DEFAULT_DETAIL_SELECTORS = {
  title: "h1, .article-title, .post-title, title",
  content: "article, .article, .post-content, .entry-content, main"
};

export function extractArticleLinks(html, baseUrl, limit = 10) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const results = [];

  for (const selector of DEFAULT_LIST_SELECTORS) {
    $(selector).each((_i, el) => {
      if (results.length >= limit) return false;
      const $el = $(el);
      const href = $el.attr("href");
      const title = $el.text().trim();
      const url = resolveUrl(baseUrl, href);
      if (!url || !title || seen.has(url)) return;
      seen.add(url);
      results.push({ url, title });
    });
  }

  return results;
}

async function fetchArticlePage(url, selectors = {}) {
  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": randomUserAgent() }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const title = $(selectors.title || DEFAULT_DETAIL_SELECTORS.title).first().text().trim();
  const content = $(selectors.content || DEFAULT_DETAIL_SELECTORS.content).first().text().trim();
  return {
    title,
    summary: content.slice(0, 500),
    url,
    publishDate: new Date().toISOString(),
    rawContent: content.slice(0, 5000)
  };
}

export async function fetchArticles(source) {
  let config = source.config || {};
  if (typeof config === "string") {
    try {
      config = JSON.parse(config);
    } catch {
      config = {};
    }
  }
  const limit = config.articleLimit || 5;
  const selectors = config.selectors || {};

  const res = await fetchWithTimeout(source.url, {
    headers: { "User-Agent": randomUserAgent() }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const links = extractArticleLinks(html, source.url, limit);

  const articles = [];
  const failures = [];
  for (const link of links) {
    try {
      const article = await fetchArticlePage(link.url, selectors);
      if (!article.title) article.title = link.title;
      articles.push(article);
    } catch (e) {
      console.error(`[website] Failed to fetch ${link.url}:`, e.message);
      failures.push(`${link.url}: ${e.message}`);
    }
    await sleep(500);
  }

  if (articles.length === 0 && failures.length > 0) {
    throw new Error(`Article fetch failures: ${failures.join("; ")}`);
  }

  return articles;
}

registerCrawler("website", { fetchArticles });
