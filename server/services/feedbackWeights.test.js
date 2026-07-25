import { describe, it, expect, beforeEach } from "vitest";
import db from "../db.js";
import { applyUserFeedbackScore, loadSemanticWeights } from "./feedbackWeights.js";

describe("feedbackWeights", () => {
  beforeEach(() => {
    db.prepare("DELETE FROM feedback_semantic_weights").run();
  });

  it("loads empty weights when none exist", () => {
    const weights = loadSemanticWeights();
    expect(weights.boost).toEqual([]);
    expect(weights.suppress).toEqual([]);
  });

  it("drops item when suppress keywords match above threshold", () => {
    const weights = {
      boost: [],
      suppress: [{ term: "股价", score: 2 }, { term: "涨停", score: 1 }]
    };
    const items = [
      { title: "某公司股价大涨", summary: "今日涨停", keywords: ["股价", "涨停"] }
    ];
    const result = applyUserFeedbackScore(items, { weights, suppressThreshold: 1.5 });
    expect(result.kept.length).toBe(0);
    expect(result.dropped.length).toBe(1);
  });

  it("keeps item when no threshold crossed", () => {
    const weights = {
      boost: [{ term: "宁德时代", score: 1 }],
      suppress: [{ term: "股价", score: 1 }]
    };
    const items = [
      { title: "宁德时代储能项目", summary: "", keywords: ["宁德时代", "储能"] }
    ];
    const result = applyUserFeedbackScore(items, { weights, suppressThreshold: 2, boostThreshold: 2 });
    expect(result.kept.length).toBe(1);
    expect(result.dropped.length).toBe(0);
  });
});
