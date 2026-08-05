const TAVILY_URL = "https://api.tavily.com/search";

export async function webSearch(query, { maxResults = 5, days = 14 } = {}) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;
  const response = await fetch(TAVILY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
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
