import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { processInsight } from "./llmProcessor.js";

describe("llmProcessor", () => {
  const originalApiKey = process.env.LLM_API_KEY;
  const originalFetch = global.fetch;

  beforeAll(() => {
    delete process.env.LLM_API_KEY;
  });

  afterAll(() => {
    process.env.LLM_API_KEY = originalApiKey;
    global.fetch = originalFetch;
  });

  it("returns fallback with empty categories when no API key is configured", async () => {
    const item = {
      title: "Test article",
      summary: "A short summary.",
      url: "https://example.com/1",
      publishDate: "2026-07-10"
    };
    const result = await processInsight(item, "en", {
      semanticPrompt: "exclude solar",
      categories: [{ name: "化工", inclusion_prompt: "Chemicals" }]
    });

    expect(result.title).toBe(item.title);
    expect(result.summary).toBe(item.summary);
    expect(result.categories).toEqual([]);
  });

  it("fills semantic and category placeholders from filterContext", async () => {
    process.env.LLM_API_KEY = "test-key";
    let capturedPrompt = "";

    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      capturedPrompt = body.messages[0].content;
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Filtered title",
                  summary: "Filtered summary.",
                  sourceType: "News",
                  businessDomain: "Energy",
                  enterpriseType: "SOE",
                  entities: ["Entity A"],
                  features: ["feature"],
                  categories: ["化工"],
                  publishDate: "2026-07-10"
                })
              }
            }
          ]
        })
      };
    };

    const item = {
      title: "Test article",
      summary: "A short summary.",
      url: "https://example.com/2",
      publishDate: "2026-07-10"
    };
    const filterContext = {
      semanticPrompt: "exclude solar",
      categories: [{ name: "化工", inclusion_prompt: "Chemicals" }]
    };

    const result = await processInsight(item, "en", filterContext);

    expect(capturedPrompt).toContain("附加语义要求: exclude solar");
    expect(capturedPrompt).toContain("- 化工: Chemicals");
    expect(result.categories).toEqual(["化工"]);
  });

  it("omits the semantic block when filterContext is empty", async () => {
    process.env.LLM_API_KEY = "test-key";
    let capturedPrompt = "";

    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      capturedPrompt = body.messages[0].content;
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ title: "T", summary: "S" }) } }]
        })
      };
    };

    const item = {
      title: "Test article",
      summary: "A short summary.",
      url: "https://example.com/3",
      publishDate: "2026-07-10"
    };

    await processInsight(item, "en");
    expect(capturedPrompt.length).toBeGreaterThan(0);
    expect(capturedPrompt).not.toContain("附加语义要求");
  });

  it("normalizes non-array categories to an empty array", async () => {
    process.env.LLM_API_KEY = "test-key";

    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "T",
                summary: "S",
                categories: "not-an-array"
              })
            }
          }
        ]
      })
    });

    const item = {
      title: "Test article",
      summary: "A short summary.",
      url: "https://example.com/4",
      publishDate: "2026-07-10"
    };

    const result = await processInsight(item, "en");
    expect(result.categories).toEqual([]);
  });
});
