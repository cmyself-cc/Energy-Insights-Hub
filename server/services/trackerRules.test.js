import { describe, it } from "node:test";
import assert from "node:assert";
import { isWithinLookback, matchesExclusions, limitPerSource, matchesInclusions, applyPreFilter, applyPostFilter } from "./trackerRules.js";

describe("trackerRules", () => {
  it("isWithinLookback returns true for recent item", () => {
    const item = { publishDate: new Date().toISOString() };
    assert.strictEqual(isWithinLookback(item, 24), true);
  });

  it("matchesExclusions rejects items containing exclude keywords", () => {
    const item = { title: "今日股市行情大涨", summary: "", rawContent: "" };
    assert.strictEqual(matchesExclusions(item, ["股票", "证券", "行情"]), true);
  });

  it("limitPerSource keeps only the most recent N items", () => {
    const items = [
      { title: "a", publishDate: "2026-07-08T10:00:00Z" },
      { title: "b", publishDate: "2026-07-08T09:00:00Z" },
      { title: "c", publishDate: "2026-07-08T11:00:00Z" },
      { title: "d", publishDate: "2026-07-08T08:00:00Z" }
    ];
    const result = limitPerSource(items, 2);
    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(result.map(i => i.title), ["c", "a"]);
  });

  it("matchesInclusions requires business domain or category match", () => {
    const insight = {
      title: "政策",
      businessDomain: "能源转型",
      enterpriseType: "国有企业",
      features: ["政策", "投资"]
    };
    assert.strictEqual(matchesInclusions(insight, {
      includeBusinessDomains: ["能源转型"],
      includeEnterpriseTypes: [],
      includeCategories: []
    }), true);
    assert.strictEqual(matchesInclusions(insight, {
      includeBusinessDomains: ["化工"],
      includeEnterpriseTypes: [],
      includeCategories: ["市场"]
    }), false);
  });

  it("limitPerSource caps items per source", () => {
    const items = [
      { source: "A", title: "a1", publishDate: "2026-07-08T12:00:00Z" },
      { source: "A", title: "a2", publishDate: "2026-07-08T11:00:00Z" },
      { source: "A", title: "a3", publishDate: "2026-07-08T10:00:00Z" },
      { source: "B", title: "b1", publishDate: "2026-07-08T12:00:00Z" },
      { source: "B", title: "b2", publishDate: "2026-07-08T11:00:00Z" },
      { source: "B", title: "b3", publishDate: "2026-07-08T10:00:00Z" }
    ];
    const result = limitPerSource(items, 2);
    assert.strictEqual(result.length, 4);

    const bySource = result.reduce((acc, item) => {
      acc[item.source] = (acc[item.source] || 0) + 1;
      return acc;
    }, {});
    assert.deepStrictEqual(bySource, { A: 2, B: 2 });

    assert.ok(result.some(i => i.source === "A" && i.title === "a1"));
    assert.ok(result.some(i => i.source === "A" && i.title === "a2"));
    assert.ok(!result.some(i => i.title === "a3"));
    assert.ok(!result.some(i => i.title === "b3"));
  });

  it("applyPreFilter deduplicates by URL or normalized title and still respects lookback, exclusions, and per-source limits", () => {
    const now = Date.now();
    const recent = offset => new Date(now - offset * 60 * 60 * 1000).toISOString();

    const items = [
      { source: "A", title: "  Energy Deal  ", url: "https://example.com/a1", publishDate: recent(1) },
      { source: "A", title: "energy deal", url: "https://example.com/a2", publishDate: recent(2) },
      { source: "A", title: "Market Update", url: "https://example.com/a3", publishDate: recent(3) },
      { source: "A", title: "Stock Move", url: "https://example.com/a4", publishDate: recent(4) },
      { source: "B", title: "energy deal", url: "https://example.com/b1", publishDate: recent(1) },
      { source: "B", title: "Oil Report", url: "https://example.com/b2", publishDate: recent(2) },
      { source: "B", title: "Oil Report", url: "https://example.com/b3", publishDate: recent(3) },
      { source: "B", title: "Gas News", url: "https://example.com/b4", publishDate: recent(4) },
      { source: "C", title: "C1", url: "https://example.com/c1", publishDate: recent(1) },
      { source: "C", title: "C2", url: "https://example.com/c2", publishDate: recent(2) },
      { source: "C", title: "C3", url: "https://example.com/c3", publishDate: recent(3) },
      { source: "D", title: "Old News", url: "https://example.com/d1", publishDate: recent(25) }
    ];

    const settings = {
      lookbackHours: 24,
      excludeKeywords: ["股票", "stock"],
      maxPerSource: 2
    };

    const result = applyPreFilter(items, settings);

    assert.strictEqual(result.length, 6);

    const keptUrls = result.map(i => i.url);
    assert.ok(keptUrls.includes("https://example.com/a1"));
    assert.ok(keptUrls.includes("https://example.com/a3"));
    assert.ok(keptUrls.includes("https://example.com/b2"));
    assert.ok(keptUrls.includes("https://example.com/b4"));
    assert.ok(keptUrls.includes("https://example.com/c1"));
    assert.ok(keptUrls.includes("https://example.com/c2"));

    assert.ok(!keptUrls.includes("https://example.com/a2"));
    assert.ok(!keptUrls.includes("https://example.com/a4"));
    assert.ok(!keptUrls.includes("https://example.com/b1"));
    assert.ok(!keptUrls.includes("https://example.com/b3"));
    assert.ok(!keptUrls.includes("https://example.com/c3"));
    assert.ok(!keptUrls.includes("https://example.com/d1"));

    const bySource = result.reduce((acc, item) => {
      acc[item.source] = (acc[item.source] || 0) + 1;
      return acc;
    }, {});
    assert.deepStrictEqual(bySource, { A: 2, B: 2, C: 2 });
  });

  it("applyPostFilter passes all non-empty-title insights when inclusion lists are empty", () => {
    const insights = [
      { title: "Energy News", businessDomain: "石油", features: ["市场"] },
      { title: "Another Insight", businessDomain: "化工", features: ["政策"] }
    ];
    const result = applyPostFilter(insights, {});
    assert.strictEqual(result.length, 2);
  });

  it("applyPostFilter keeps only insights matching includeBusinessDomains", () => {
    const insights = [
      { title: "Energy News", businessDomain: "能源转型", features: [] },
      { title: "Chemical Update", businessDomain: "化工", features: [] }
    ];
    const result = applyPostFilter(insights, { includeBusinessDomains: ["能源"] });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].title, "Energy News");
  });

  it("applyPostFilter keeps insights with matching features when includeCategories is set", () => {
    const insights = [
      { title: "Policy News", businessDomain: "", features: ["政策"] },
      { title: "Market News", businessDomain: "", features: ["市场"] }
    ];
    const result = applyPostFilter(insights, { includeCategories: ["政策"] });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].title, "Policy News");
  });

  it("applyPostFilter removes insights with empty titles regardless of inclusions", () => {
    const insights = [
      { title: "Valid Title", businessDomain: "能源转型", features: [] },
      { title: "", businessDomain: "能源转型", features: [] },
      { title: "   ", businessDomain: "能源转型", features: [] }
    ];
    const result = applyPostFilter(insights, { includeBusinessDomains: ["能源转型"] });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].title, "Valid Title");
  });

  it("applyPostFilter removes insights containing exclude keywords", () => {
    const insights = [
      { title: "Clean Energy", businessDomain: "", features: [] },
      { title: "Stock Market", businessDomain: "", features: [] }
    ];
    const result = applyPostFilter(insights, { excludeKeywords: ["stock"] });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].title, "Clean Energy");
  });
});
