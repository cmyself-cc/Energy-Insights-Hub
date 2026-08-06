import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/llmClient.js", () => ({ callLlmJson: vi.fn() }));

import { screenCards, clarifyCards } from "./reportScreening.js";
import { callLlmJson } from "../lib/llmClient.js";

const template = { id: 1, name: "T", purpose: "日报", max_cards: 2, prompt: "p", language: "zh" };
const insights = [
  { id: 11, title: "光伏装机创新高", summary: "2026年装机50GW", url: "https://a", keywords: "光伏", source_name: "北极星" },
  { id: 12, title: "光伏装机数据争议", summary: "装机40GW", url: "https://b", keywords: "光伏", source_name: "北极星" }
];

describe("reportScreening", () => {
  beforeEach(() => { callLlmJson.mockReset(); });

  it("parses LLM screening questions with dynamic options", async () => {
    callLlmJson.mockResolvedValue({
      questions: [{ key: "q1", issue: "装机数据冲突", cardIds: [11, 12], options: ["保留全部并标注", "优先最新"], suggested: "保留全部并标注" }],
      searchPlan: [{ cardId: 11, queries: ["光伏 装机 2026"] }],
      purpose: "日报",
      exceedsLimit: false
    });
    const result = await screenCards({ template, insights });
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].options).toEqual(["保留全部并标注", "优先最新"]);
    expect(result.searchPlan[0].queries).toEqual(["光伏 装机 2026"]);
    expect(result.exceedsLimit).toBe(false);
  });

  it("falls back when the LLM is unavailable (no questions, straight to generation)", async () => {
    callLlmJson.mockRejectedValue(new Error("LLM API key not configured"));
    const result = await screenCards({ template, insights });
    expect(result.questions).toEqual([]);
    expect(result.searchPlan).toHaveLength(2);
    expect(result.purpose).toBe("日报");
    expect(result.searchPlan[0].queries[0]).toContain("光伏");
  });

  it("reports when the card count exceeds the template limit", async () => {
    callLlmJson.mockResolvedValue({ questions: [], searchPlan: [], purpose: "日报", exceedsLimit: true });
    const result = await screenCards({ template, insights });
    expect(result.exceedsLimit).toBe(true);
  });

  it("clarifyCards finishes with resolutions when the LLM considers questions resolved", async () => {
    callLlmJson.mockResolvedValue({ questions: [], resolutions: [{ key: "q1", issue: "装机数据冲突", choice: "保留全部并标注", cardIds: [11, 12] }], purpose: "日报", done: true });
    const result = await clarifyCards({
      template, insights,
      answers: [{ key: "q1", issue: "装机数据冲突", choice: "保留全部并标注", cardIds: [11, 12] }]
    });
    expect(result.done).toBe(true);
    expect(result.resolutions).toHaveLength(1);
    expect(result.resolutions[0].choice).toBe("保留全部并标注");
  });

  it("clarifyCards returns follow-up questions when needed", async () => {
    callLlmJson.mockResolvedValue({
      questions: [{ key: "q2", issue: "请确认报告时间范围", cardIds: [11], options: ["近一周", "近一个月"], suggested: "近一周" }],
      resolutions: [{ key: "q1", issue: "装机数据冲突", choice: "保留全部并标注", cardIds: [11, 12] }],
      purpose: "日报",
      done: false
    });
    const result = await clarifyCards({ template, insights, answers: [] });
    expect(result.done).toBe(false);
    expect(result.questions).toHaveLength(1);
    expect(result.resolutions).toHaveLength(1);
  });

  it("clarifyCards falls back to done when the LLM is unavailable", async () => {
    callLlmJson.mockRejectedValue(new Error("boom"));
    const answers = [{ key: "q1", issue: "装机数据冲突", choice: "优先最新", cardIds: [11, 12] }];
    const result = await clarifyCards({ template, insights, answers });
    expect(result.done).toBe(true);
    expect(result.resolutions).toEqual(answers);
    expect(result.purpose).toBe("日报");
  });
});
