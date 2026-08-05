import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../crawlers/utils.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchWithTimeout: vi.fn() };
});

import { generateSuggestions } from "./feedbackSuggestionGenerator.js";
import { fetchWithTimeout } from "../crawlers/utils.js";
import db, { initDb } from "../db.js";

function mockLlmResponse({ content, finishReason = "stop", reasoningContent = "" }) {
  fetchWithTimeout.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      choices: [{
        finish_reason: finishReason,
        message: { content, reasoning_content: reasoningContent }
      }],
      usage: { completion_tokens: 2000, completion_tokens_details: { reasoning_tokens: 2000 } }
    })
  });
}

describe("feedbackSuggestionGenerator", () => {
  const originalApiKey = process.env.LLM_API_KEY;

  beforeEach(() => {
    initDb();
    db.prepare("DELETE FROM user_feedback").run();
    db.prepare("DELETE FROM feedback_rules_suggestions").run();
    process.env.LLM_API_KEY = "test-key";
    fetchWithTimeout.mockReset();
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = originalApiKey;
  });

  function seedFeedback() {
    db.prepare(
      "INSERT INTO user_feedback (action, reason, title, summary) VALUES (?, ?, ?, ?)"
    ).run("hide", "irrelevant", "某光伏企业动态", "一篇测试文章摘要");
  }

  it("returns generated:0 without calling the LLM when there is no feedback", async () => {
    const result = await generateSuggestions();
    expect(result).toEqual({ generated: 0 });
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("inserts suggestions from a valid LLM JSON array", async () => {
    seedFeedback();
    mockLlmResponse({
      content: JSON.stringify([{
        type: "exclude_keyword",
        name: "测试关键词",
        purpose: "tech",
        reason: "多次因不相关被隐藏",
        evidence: ["某光伏企业动态"]
      }])
    });

    const result = await generateSuggestions();

    expect(result).toEqual({ generated: 1 });
    const rows = db.prepare("SELECT * FROM feedback_rules_suggestions").all();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("测试关键词");
  });

  it("throws a meaningful error when the LLM content is empty because reasoning consumed the token budget", async () => {
    seedFeedback();
    mockLlmResponse({ content: "", finishReason: "length", reasoningContent: "很长很长的思考…" });

    await expect(generateSuggestions()).rejects.toThrow(/empty|truncat/i);
    await expect(async () => { seedFeedback(); mockLlmResponse({ content: "", finishReason: "length" }); await generateSuggestions(); })
      .rejects.not.toThrow("Unexpected end of JSON input");
  });

  it("throws a meaningful error when the LLM returns truncated JSON", async () => {
    seedFeedback();
    mockLlmResponse({ content: '[{"type": "exclude_keyword", "name": "截断', finishReason: "length" });

    let threw = null;
    try {
      await generateSuggestions();
    } catch (e) {
      threw = e;
    }
    expect(threw).not.toBeNull();
    expect(threw.message).not.toBe("Unexpected end of JSON input");
    expect(threw.message).toMatch(/truncat|invalid json/i);
  });

  it("requests a token budget large enough for reasoning models", async () => {
    seedFeedback();
    mockLlmResponse({ content: "[]" });

    await generateSuggestions();

    const body = JSON.parse(fetchWithTimeout.mock.calls[0][1].body);
    expect(body.max_tokens).toBeGreaterThanOrEqual(8000);
  });
});
