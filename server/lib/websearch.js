import { getActiveSearchProvider, DEFAULT_BASE_URLS } from "../services/searchProviderService.js";

const TAVILY_URL = "https://api.tavily.com/search";

function freshnessFromDays(days) {
  if (days <= 1) return "oneDay";
  if (days <= 7) return "oneWeek";
  if (days <= 30) return "oneMonth";
  if (days <= 365) return "oneYear";
  return "noLimit";
}

async function bochaSearch(provider, query, { maxResults, days }) {
  const url = provider.base_url || DEFAULT_BASE_URLS.bocha;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.api_key}` },
    body: JSON.stringify({
      query: String(query),
      freshness: freshnessFromDays(days),
      summary: true,
      count: Math.min(Math.max(maxResults, 1), 10)
    })
  });
  if (!response.ok) throw new Error(`Bocha search failed: ${response.status}`);
  const data = await response.json();
  const pages = data?.data?.webPages?.value || [];
  return pages.map(r => ({
    title: r.name || "",
    url: r.url || "",
    content: r.summary || r.snippet || ""
  }));
}

async function tavilySearch(provider, query, { maxResults }) {
  const url = provider.base_url || TAVILY_URL;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: provider.api_key,
      query: String(query),
      search_depth: "advanced",
      include_answer: false,
      include_domains: [],
      max_results: maxResults
    })
  });
  if (!response.ok) throw new Error(`Tavily search failed: ${response.status}`);
  const data = await response.json();
  return (data.results || []).map(r => ({
    title: r.title || "",
    url: r.url || "",
    content: r.content || ""
  }));
}

export async function webSearch(query, { maxResults = 5, days = 14 } = {}) {
  const provider = getActiveSearchProvider();
  if (provider) {
    if (provider.provider_type === "bocha") return bochaSearch(provider, query, { maxResults, days });
    if (provider.provider_type === "tavily") return tavilySearch(provider, query, { maxResults });
  }
  // 兜底：未配置任何 provider 时使用旧环境变量
  if (process.env.TAVILY_API_KEY) {
    return tavilySearch({ api_key: process.env.TAVILY_API_KEY, base_url: TAVILY_URL }, query, { maxResults });
  }
  return null;
}
