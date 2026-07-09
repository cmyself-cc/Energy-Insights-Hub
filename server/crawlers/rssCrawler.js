import Parser from "rss-parser";

const parser = new Parser({
  timeout: 20000,
  headers: { "User-Agent": "EnergyInsightsHub/1.0" }
});

export async function fetchArticles(source) {
  let config = source.config || {};
  if (typeof config === "string") {
    try {
      config = JSON.parse(config);
    } catch {
      config = {};
    }
  }
  const limit = config.articleLimit || 20;
  const feed = await parser.parseURL(source.url);
  return (feed.items || [])
    .slice(0, limit)
    .map(item => {
      try {
        return {
          title: item.title || "",
          summary: item.contentSnippet || item.content || "",
          url: item.link || "",
          publishDate: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
          rawContent: item["content:encoded"] || item.content || ""
        };
      } catch (err) {
        console.error("RSS item normalization failed:", err.message, "item:", item);
        return null;
      }
    })
    .filter(item => item !== null);
}
