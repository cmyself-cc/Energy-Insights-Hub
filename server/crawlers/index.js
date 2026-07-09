import { fetchArticles as rssFetchArticles } from "./rssCrawler.js";
import { fetchArticles as websiteFetchArticles } from "./websiteCrawler.js";
import { fetchArticles as wechatFetchArticles } from "./wechatCrawler.js";
import "./apiCrawler.js";

export { sleep, fetchWithTimeout, resolveUrl, randomUserAgent } from "./utils.js";

const registry = new Map();

export function registerCrawler(type, crawler) {
  registry.set(type, crawler);
}

registerCrawler("rss", { fetchArticles: rssFetchArticles });
registerCrawler("website", { fetchArticles: websiteFetchArticles });
registerCrawler("wechat", { fetchArticles: wechatFetchArticles });

export async function fetchArticles(source) {
  const crawler = registry.get(source.type);
  if (!crawler) {
    throw new Error(`No crawler registered for type: ${source.type}`);
  }
  return crawler.fetchArticles(source);
}
