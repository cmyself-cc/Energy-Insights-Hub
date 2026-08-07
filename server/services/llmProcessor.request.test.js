import { describe, it, expect, afterEach } from "vitest";
import { processInsight } from "./llmProcessor.js";

// deepseek-v4-flash 这类推理模型会把整个 max_tokens 预算烧在 reasoning_content
// 上而返回空 content（feedbackSuggestionGenerator 已踩过同样的坑）；
// 非 anthropic 请求必须显式禁用 thinking。
describe("processInsight request body", () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.LLM_API_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = originalApiKey;
  });

  it("disables thinking for non-anthropic providers", async () => {
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_PROVIDER = "openai";
    let captured;
    global.fetch = async (_url, opts) => {
      captured = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            title: "t", summary: "s", keywords: ["a", "b", "c"],
            purposes: [], categories: ["储能"], china_relevance: true
          }) } }],
          usage: { total_tokens: 10 }
        })
      };
    };

    await processInsight({ title: "测试", url: "https://x", rawContent: "内容" }, "zh", null);

    expect(captured.thinking).toEqual({ type: "disabled" });
  });
});
