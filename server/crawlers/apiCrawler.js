import { registerCrawler } from "./index.js";

async function fetchArticles(_source) {
  return [];
}

registerCrawler("api", { fetchArticles });
