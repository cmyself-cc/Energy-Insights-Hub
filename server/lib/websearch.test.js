import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import db, { initDb } from "../db.js";
import { webSearch } from "./websearch.js";
import { createSearchProvider, activateSearchProvider } from "../services/searchProviderService.js";

describe("webSearch", () => {
  const originalKey = process.env.TAVILY_API_KEY;
  const originalBocha = process.env.BOCHA_API_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    initDb();
    db.prepare("DELETE FROM search_providers").run();
    delete process.env.TAVILY_API_KEY;
    delete process.env.BOCHA_API_KEY;
    global.fetch = vi.fn();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = originalKey;
    if (originalBocha === undefined) delete process.env.BOCHA_API_KEY; else process.env.BOCHA_API_KEY = originalBocha;
    global.fetch = originalFetch;
  });

  function mockResponse(data) {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => data });
  }

  it("returns null when no provider and no env key are configured", async () => {
    expect(await webSearch("氢能")).toBeNull();
  });

  it("calls the active bocha provider with Bearer auth and parses webPages", async () => {
    const p = createSearchProvider({ name: "博查", providerType: "bocha", apiKey: "bocha-key" });
    activateSearchProvider(p.id);
    mockResponse({ code: 200, data: { webPages: { value: [{ name: "A", url: "https://a.com", snippet: "s1", summary: "sum1" }] } } });

    const results = await webSearch("氢能 政策", { maxResults: 3, days: 7 });
    expect(results).toEqual([{ title: "A", url: "https://a.com", content: "sum1" }]);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.bochaai.com/v1/web-search");
    expect(opts.headers.Authorization).toBe("Bearer bocha-key");
    const body = JSON.parse(opts.body);
    expect(body.query).toBe("氢能 政策");
    expect(body.freshness).toBe("oneWeek");
    expect(body.summary).toBe(true);
    expect(body.count).toBe(3);
  });

  it("calls the active tavily provider", async () => {
    const p = createSearchProvider({ name: "Tavily", providerType: "tavily", apiKey: "tvly-x" });
    activateSearchProvider(p.id);
    mockResponse({ results: [{ title: "B", url: "https://b.com", content: "body" }] });
    const results = await webSearch("氢能", { maxResults: 5 });
    expect(results).toEqual([{ title: "B", url: "https://b.com", content: "body" }]);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.api_key).toBe("tvly-x");
  });

  it("falls back to the legacy TAVILY_API_KEY env when no provider exists", async () => {
    process.env.TAVILY_API_KEY = "env-tvly";
    mockResponse({ results: [{ title: "C", url: "https://c.com", content: "body" }] });
    const results = await webSearch("氢能");
    expect(results).toEqual([{ title: "C", url: "https://c.com", content: "body" }]);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.api_key).toBe("env-tvly");
  });
});
