import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/llmClient.js", () => ({ callLlmJson: vi.fn() }));

import { screenCards, clarifyCards, generateManualPrompt } from "./reportScreening.js";
import { callLlmJson } from "../lib/llmClient.js";

const template = { id: 1, name: "T", purpose: "日报", max_cards: 2, prompt: "p", language: "zh" };
const insights = [
  { id: 11, title: "光伏装机创新高", summary: "2026年装机50GW", url: "https://a", keywords: "光伏", source_name: "北极星" },
  { id: 12, title: "光伏装机数据争议", summary: "装机40GW", url: "https://b", keywords: "光伏", source_name: "北极星" }
];

describe("reportScreening", () => {
  beforeEach(() => { callLlmJson.mockReset(); });

  it("parses screening output with quality issues, purpose/audience options", async () => {
    callLlmJson.mockResolvedValue({
      quality: [{ kind: "contradiction", issue: "装机数据冲突", cardIds: [11, 12], options: ["保留全部并标注", "优先最新"], suggested: "保留全部并标注" }],
      purposeOptions: ["每日要闻日报", "行业周报"],
      purpose: "每日要闻日报",
      audienceOptions: ["团队内部晨会", "管理层"],
      audience: "团队内部晨会",
      searchPlan: [{ cardId: 11, queries: ["光伏 装机 2026"] }],
      exceedsLimit: false
    });
    const result = await screenCards({ template, insights });
    expect(result.quality).toHaveLength(1);
    expect(result.quality[0].kind).toBe("contradiction");
    expect(result.purposeOptions).toEqual(["每日要闻日报", "行业周报"]);
    expect(result.audience).toBe("团队内部晨会");
    expect(result.searchPlan[0].queries).toEqual(["光伏 装机 2026"]);
    expect(result.exceedsLimit).toBe(false);
  });

  it("falls back when the LLM is unavailable", async () => {
    callLlmJson.mockRejectedValue(new Error("LLM API key not configured"));
    const result = await screenCards({ template, insights });
    expect(result.quality).toEqual([]);
    expect(result.purpose).toBe("日报");
    expect(result.audience).toBe("团队内部");
    expect(Array.isArray(result.purposeOptions)).toBe(true);
    expect(result.searchPlan[0].queries[0]).toContain("光伏");
  });

  it("reports when the card count exceeds the template limit", async () => {
    callLlmJson.mockResolvedValue({ quality: [], purposeOptions: [], purpose: "日报", audienceOptions: [], audience: "团队", searchPlan: [], exceedsLimit: true });
    const result = await screenCards({ template, insights });
    expect(result.exceedsLimit).toBe(true);
  });

  it("clarifyCards finishes with resolutions when resolved", async () => {
    callLlmJson.mockResolvedValue({ questions: [], resolutions: [{ key: "q1", issue: "装机数据冲突", choice: "保留全部并标注", cardIds: [11, 12] }], purpose: "日报", done: true });
    const result = await clarifyCards({ template, insights, answers: [] });
    expect(result.done).toBe(true);
    expect(result.resolutions).toHaveLength(1);
  });

  it("generateManualPrompt builds a prompt with the user's outline", async () => {
    callLlmJson.mockResolvedValue("你是报告撰写助手。请按以下框架输出：报告主题为储能行业");
    const result = await generateManualPrompt({ topic: "储能行业", framework: "现状/趋势/风险", outline: "1.市场规模 2.政策", conclusion: "关注钠离子电池", language: "zh" });
    expect(result.prompt).toContain("储能行业");
    expect(result.generated).toBe(true);
    expect(callLlmJson.mock.calls[0][0][0].content).toContain("现状/趋势/风险");
  });

  it("generateManualPrompt falls back without the LLM", async () => {
    callLlmJson.mockRejectedValue(new Error("boom"));
    const result = await generateManualPrompt({ topic: "氢能", language: "zh" });
    expect(result.prompt).toContain("氢能");
    expect(result.prompt).toContain("{{insights}}");
  });
});
