import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { processInsight } from "./llmProcessor.js";

describe("llmProcessor", () => {
  const originalApiKey = process.env.LLM_API_KEY;
  const originalFetch = global.fetch;

  before(() => {
    delete process.env.LLM_API_KEY;
  });

  after(() => {
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

    assert.strictEqual(result.title, item.title);
    assert.strictEqual(result.summary, item.summary);
    assert.deepStrictEqual(result.categories, []);
  });

  it("includes filtering instructions when filterContext is provided", async () => {
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

    assert.ok(capturedPrompt.includes("--- Filtering instructions ---"));
    assert.ok(capturedPrompt.includes("Semantic exclusions"));
    assert.ok(capturedPrompt.includes("exclude solar"));
    assert.ok(capturedPrompt.includes("Business categories"));
    assert.ok(capturedPrompt.includes("化工"));
    assert.deepStrictEqual(result.categories, ["化工"]);
  });

  it("omits filtering instructions when filterContext is empty", async () => {
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
    assert.ok(!capturedPrompt.includes("--- Filtering instructions ---"));
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
    assert.deepStrictEqual(result.categories, []);
  });
});
