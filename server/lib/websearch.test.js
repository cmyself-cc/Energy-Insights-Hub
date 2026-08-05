import { describe, it, expect, vi, afterEach } from "vitest";
import { webSearch } from "./websearch.js";

describe("webSearch", () => {
  const originalKey = process.env.TAVILY_API_KEY;
  const originalFetch = global.fetch;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = originalKey;
    global.fetch = originalFetch;
  });

  it("returns null when TAVILY_API_KEY is not configured", async () => {
    delete process.env.TAVILY_API_KEY;
    expect(await webSearch("氢能 政策")).toBeNull();
  });

  it("calls tavily and returns title/url/content results", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ title: "A", url: "https://a.com", content: "body" }] })
    });
    const results = await webSearch("氢能 政策");
    expect(results).toEqual([{ title: "A", url: "https://a.com", content: "body" }]);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.query).toBe("氢能 政策");
    expect(body.max_results).toBe(5);
  });

  it("throws when tavily returns an error", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    await expect(webSearch("氢能")).rejects.toThrow(/429/);
  });
});
