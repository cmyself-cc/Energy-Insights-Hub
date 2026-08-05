import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/llmClient.js", () => ({ callLlmJson: vi.fn() }));

import { screenCards } from "./reportScreening.js";
import { callLlmJson } from "../lib/llmClient.js";

const template = { id: 1, name: "T", purpose: "日报", max_cards: 2, prompt: "p", language: "zh" };
const insights = [
  { id: 11, title: "光伏装机创新高", summary: "2026年装机50GW", url: "https://a", keywords: "光伏", source_name: "北极星" },
  { id: 12, title: "光伏装机数据争议", summary: "装机40GW", url: "https://b", keywords: "光伏", source_name: "北极星" }
];

describe("reportScreening", () => {
  beforeEach(() => { callLlmJson.mockReset(); });

  it("parses LLM screening output", async () => {
    callLlmJson.mockResolvedValue({
      inconsistencies: [{ issue: "装机数据冲突", cardIds: [11, 12], options: ["保留全部并标注", "优先最新"], suggested: "保留全部并标注" }],
      searchPlan: [{ cardId: 11, queries: ["光伏 装机 2026"] }],
      purpose: "日报",
      exceedsLimit: false
    });
    const result = await screenCards({ template, insights });
    expect(result.inconsistencies).toHaveLength(1);
    expect(result.searchPlan[0].queries).toEqual(["光伏 装机 2026"]);
    expect(result.exceedsLimit).toBe(false);
  });

  it("falls back when the LLM is unavailable", async () => {
    callLlmJson.mockRejectedValue(new Error("LLM API key not configured"));
    const result = await screenCards({ template, insights });
    expect(result.inconsistencies).toEqual([]);
    expect(result.searchPlan).toHaveLength(2);
    expect(result.purpose).toBe("日报");
    expect(result.searchPlan[0].queries[0]).toContain("光伏");
  });

  it("reports when the card count exceeds the template limit", async () => {
    callLlmJson.mockResolvedValue({ inconsistencies: [], searchPlan: [], purpose: "日报", exceedsLimit: true });
    const result = await screenCards({ template, insights });
    expect(result.exceedsLimit).toBe(true);
  });
});
