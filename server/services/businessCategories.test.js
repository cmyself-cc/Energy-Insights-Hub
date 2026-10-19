import { describe, it, expect } from "vitest";
import { matchesEnabledCategory, buildCategoryPrompt } from "./businessCategories.js";

describe("businessCategories", () => {
  it("matchesEnabledCategory returns true when insight category is enabled", () => {
    const categories = [{ name: "移动出行", active: 1 }];
    expect(matchesEnabledCategory({ categories: ["移动出行"] }, categories)).toBe(true);
  });

  it("matchesEnabledCategory returns false when no categories match", () => {
    const categories = [{ name: "移动出行", active: 1 }];
    expect(matchesEnabledCategory({ categories: ["化工"] }, categories)).toBe(false);
  });

  it("buildCategoryPrompt includes category names and prompts", () => {
    const categories = [{ name: "A", inclusion_prompt: "desc A" }];
    const prompt = buildCategoryPrompt(categories);
    expect(prompt.includes("A")).toBeTruthy();
    expect(prompt.includes("desc A")).toBeTruthy();
  });
});
