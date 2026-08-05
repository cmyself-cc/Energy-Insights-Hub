import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../crawlers/utils.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchWithTimeout: vi.fn() };
});

import { callLlm, callLlmJson } from "./llmClient.js";
import { fetchWithTimeout } from "../crawlers/utils.js";

describe("llmClient", () => {
  const originalApiKey = process.env.LLM_API_KEY;
  beforeEach(() => { process.env.LLM_API_KEY = "test-key"; fetchWithTimeout.mockReset(); });
  afterEach(() => { if (originalApiKey === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = originalApiKey; });

  it("sends thinking disabled on the openai-compatible path", async () => {
    fetchWithTimeout.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) });
    await callLlm([{ role: "user", content: "hi" }]);
    const body = JSON.parse(fetchWithTimeout.mock.calls[0][1].body);
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("returns trimmed content and strips markdown fences", async () => {
    fetchWithTimeout.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: "```json\n{\"a\":1}\n```" } }] }) });
    expect(await callLlm([{ role: "user", content: "x" }])).toBe('{"a":1}');
  });

  it("callLlmJson parses valid JSON", async () => {
    fetchWithTimeout.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '[{"x":1}]' } }] }) });
    expect(await callLlmJson([{ role: "user", content: "x" }])).toEqual([{ x: 1 }]);
  });

  it("callLlmJson throws a readable error on invalid JSON", async () => {
    fetchWithTimeout.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: "not json" } }] }) });
    await expect(callLlmJson([{ role: "user", content: "x" }])).rejects.toThrow(/invalid json/i);
  });

  it("throws a readable error when the API key is missing", async () => {
    delete process.env.LLM_API_KEY;
    await expect(callLlm([{ role: "user", content: "x" }])).rejects.toThrow(/api key/i);
  });
});
