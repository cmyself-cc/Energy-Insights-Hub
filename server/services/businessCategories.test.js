import { describe, it } from "node:test";
import assert from "node:assert";
import { matchesEnabledCategory, buildCategoryPrompt } from "./businessCategories.js";

describe("businessCategories", () => {
  it("matchesEnabledCategory returns true when insight category is enabled", () => {
    const categories = [{ name: "移动出行", active: 1 }];
    assert.strictEqual(matchesEnabledCategory({ categories: ["移动出行"] }, categories), true);
  });

  it("matchesEnabledCategory returns false when no categories match", () => {
    const categories = [{ name: "移动出行", active: 1 }];
    assert.strictEqual(matchesEnabledCategory({ categories: ["化工"] }, categories), false);
  });

  it("buildCategoryPrompt includes category names and prompts", () => {
    const categories = [{ name: "A", inclusion_prompt: "desc A" }];
    const prompt = buildCategoryPrompt(categories);
    assert.ok(prompt.includes("A"));
    assert.ok(prompt.includes("desc A"));
  });
});
