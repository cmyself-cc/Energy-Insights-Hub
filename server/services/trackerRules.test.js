import { describe, it } from "node:test";
import assert from "node:assert";
import { isWithinLookback, matchesExclusions, limitPerSource, matchesInclusions } from "./trackerRules.js";

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
});
