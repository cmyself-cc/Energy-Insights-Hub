import { describe, it, expect, afterEach } from "vitest";
import { processInsight } from "./llmProcessor.js";

function mockLlmResponse(summary) {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            title: "测试标题",
            summary,
            keywords: ["储能", "并网", "电站"],
            purposes: ["tech"],
            categories: ["储能"],
            china_relevance: true
          })
        }
      }]
    })
  });
}

describe("processInsight summary enforcement", () => {
  const originalApiKey = process.env.LLM_API_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = originalApiKey;
    global.fetch = originalFetch;
  });

  it("cleans and caps the fallback summary when no API key is configured", async () => {
    delete process.env.LLM_API_KEY;
    const body = "储能项目顺利并网发电。".repeat(30); // >200 chars of real content
    const item = {
      title: "测试文章",
      summary: `分享 订阅 投稿 我要投稿 ${body} 阅读下一章… 查看更多>`,
      url: "https://example.com/1",
      publishDate: "2026-08-01"
    };
    const result = await processInsight(item);
    expect(result.summary.length).toBeLessThanOrEqual(200);
    expect(result.summary).not.toContain("分享");
    expect(result.summary).not.toContain("查看更多");
    expect(result.summary.startsWith("储能项目顺利并网发电。")).toBe(true);
  });

  it("falls back to cleaned rawContent when summary is empty and no API key is set", async () => {
    delete process.env.LLM_API_KEY;
    const item = {
      title: "测试文章",
      summary: "",
      rawContent: "首页 > 新闻中心 > 储能 > " + "正文内容句子。".repeat(50),
      url: "https://example.com/2",
      publishDate: "2026-08-01"
    };
    const result = await processInsight(item);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.summary.length).toBeLessThanOrEqual(200);
    expect(result.summary).not.toContain("首页");
    expect(result.summary.startsWith("正文内容句子。")).toBe(true);
  });

  it("caps an over-long LLM summary at a sentence boundary", async () => {
    process.env.LLM_API_KEY = "test-key";
    mockLlmResponse("这是摘要第一句。" + "这是补充说明的句子。".repeat(40));
    const item = {
      title: "测试文章",
      summary: "占位摘要",
      rawContent: "正文内容",
      url: "https://example.com/3",
      publishDate: "2026-08-01"
    };
    const result = await processInsight(item);
    expect(result.summary.length).toBeLessThanOrEqual(200);
    expect(result.summary.endsWith("。")).toBe(true);
    expect(result.summary.startsWith("这是摘要第一句。")).toBe(true);
  });

  it("falls back to cleaned rawContent when the LLM omits the summary field", async () => {
    process.env.LLM_API_KEY = "test-key";
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              title: "测试标题",
              keywords: ["储能", "并网", "电站"],
              purposes: ["tech"],
              categories: ["储能"],
              china_relevance: true
            })
          }
        }]
      })
    });
    const item = {
      title: "测试文章",
      summary: "分享 订阅 投稿 占位噪音摘要",
      rawContent: "真实正文第一句。" + "后续正文内容。".repeat(40),
      url: "https://example.com/4",
      publishDate: "2026-08-01"
    };
    const result = await processInsight(item);
    expect(result.summary.length).toBeLessThanOrEqual(200);
    expect(result.summary).not.toContain("占位噪音");
    expect(result.summary.startsWith("真实正文第一句。")).toBe(true);
  });

  it("cleans the summary on the LLM failure path as well", async () => {
    process.env.LLM_API_KEY = "test-key";
    global.fetch = async () => { throw new Error("network down"); };
    const body = "正文句子内容。".repeat(40);
    const item = {
      title: "测试文章",
      summary: `分享 订阅 投稿 ${body} 扫码手机查看`,
      url: "https://example.com/5",
      publishDate: "2026-08-01"
    };
    const result = await processInsight(item);
    expect(result.llmFailed).toBe(true);
    expect(result.summary.length).toBeLessThanOrEqual(200);
    expect(result.summary).not.toContain("分享");
    expect(result.summary).not.toContain("扫码");
  });
});
