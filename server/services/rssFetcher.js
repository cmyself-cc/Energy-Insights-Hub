import Parser from "rss-parser";

const parser = new Parser({
  timeout: 20000,
  headers: {
    "User-Agent": "EnergyInsightsHub/1.0"
  }
});

export async function fetchRss(source) {
  const feed = await parser.parseURL(source.url);
  return feed.items.slice(0, 20).map(item => ({
    title: item.title || "",
    summary: item.contentSnippet || item.content || "",
    url: item.link || "",
    publishDate: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
    rawContent: item["content:encoded"] || item.content || ""
  }));
}
