import { fetchWithTimeout, stripBoilerplate, truncateAtSentence } from "./utils.js";

const TAVILY_URL = "https://api.tavily.com/search";

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

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function fetchArticles(source) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is not configured");
  }

  const config = parseConfig(source);
  const domain = extractDomain(source.url);
  const baseQuery = config.searchQuery
    || `${config.topic || "energy"} news`;
  // All tracked content must be China-related; append China focus to Tavily query
  const query = baseQuery.toLowerCase().includes("china") || baseQuery.includes("中国")
    ? baseQuery
    : `${baseQuery} China 中国`;
  const includeDomains = config.includeDomains
    ? config.includeDomains.split(",").map(s => s.trim()).filter(Boolean)
    : (domain ? [domain] : []);
  const maxResults = Math.min(Math.max(parseInt(config.articleLimit, 10) || 10, 1), 20);
  const days = Math.min(Math.max(parseInt(config.days, 10) || 30, 1), 90);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const response = await fetchWithTimeout(
    TAVILY_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: config.searchDepth || "advanced",
        include_answer: false,
        include_images: false,
        include_domains: includeDomains,
        max_results: maxResults * 2
      })
    },
    60000
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Tavily API failed: HTTP ${response.status} ${text}`);
  }

  const data = await response.json();
  const results = Array.isArray(data.results) ? data.results : [];

  function isLikelyArticle(url) {
    if (!url) return false;
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.endsWith(".pdf")) return false;
    const path = new URL(url).pathname.toLowerCase();
    // Reject home/section pages and utility pages
    const badPatterns = [
      /^\/$/,
      /^\/(business|energy|commodities|news|climate|markets|politics|world|technology)\/?$/,
      /\/(about|contact|terms|privacy|subscribe|rss|feed|archive|category|tag|topics|section|page)\//,
      /\/(page|p)=\d+$/,
      /\/energy-general\/?$/
    ];
    return !badPatterns.some(p => p.test(path));
  }

  return results
    .filter(item => isLikelyArticle(item.url))
    .map(item => {
      const title = item.title || "";
      const url = item.url || "";
      const rawContent = stripBoilerplate(typeof item.content === "string" ? item.content : "");
      const summary = truncateAtSentence(rawContent, 200);
      let publishDate = item.published_date ? new Date(item.published_date).toISOString() : null;
      if (!publishDate || isNaN(new Date(publishDate).getTime())) {
        publishDate = new Date().toISOString();
      }
      return { title, summary, url, publishDate, rawContent };
    })
    .filter(item => item.title && item.url)
    .filter(item => new Date(item.publishDate).getTime() >= cutoff.getTime())
    .slice(0, maxResults);
}
