import * as cheerio from "cheerio";

const DEFAULT_SELECTORS = {
  title: "title",
  content: "article, .article, .post-content, .entry-content, main, body",
  link: "a"
};

export async function fetchScrape(source) {
  const config = source.config || {};
  const response = await fetch(source.url, {
    headers: {
      "User-Agent": "EnergyInsightsHub/1.0",
      ...(config.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const selectors = config.selectors || DEFAULT_SELECTORS;
  const title = $(selectors.title).first().text().trim();
  const content = $(selectors.content).first().text().trim().slice(0, 5000);

  return [{
    title,
    summary: content.slice(0, 500),
    url: source.url,
    publishDate: new Date().toISOString(),
    rawContent: content
  }];
}
