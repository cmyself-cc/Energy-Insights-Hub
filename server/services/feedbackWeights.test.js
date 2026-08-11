import { describe, it, expect, beforeEach } from "vitest";
import db, { initDb } from "../db.js";
import { applyUserFeedbackScore, loadSemanticWeights } from "./feedbackWeights.js";

describe("feedbackWeights", () => {
  beforeEach(() => {
    initDb();
    db.prepare("DELETE FROM feedback_semantic_weights").run();
  });

  it("loads empty weights when none exist", () => {
    const weights = loadSemanticWeights();
    expect(weights.global.boost).toEqual([]);
    expect(weights.global.suppress).toEqual([]);
    expect(weights.byPurpose.competitor.suppress).toEqual([]);
  });

  it("drops item when suppress keywords match above threshold (legacy global weights)", () => {
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

  it("keeps item when no threshold crossed (legacy global weights)", () => {
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

  it("drops item when its purpose has suppress weight above threshold", () => {
    const weights = {
      byPurpose: {
        competitor: { boost: [], suppress: [{ term: "股价", score: 2 }] },
        policy: { boost: [], suppress: [] },
        tech: { boost: [], suppress: [] },
        industry: { boost: [], suppress: [] }
      },
      global: { boost: [], suppress: [] }
    };
    const items = [
      { title: "某公司股价大涨", summary: "", keywords: ["股价"], matchedPurposes: ["competitor"] }
    ];
    const result = applyUserFeedbackScore(items, { weights, suppressThreshold: 2 });
    expect(result.dropped.length).toBe(1);
    expect(result.dropped[0].purpose).toBe("competitor");
  });

  it("only applies purpose-specific suppress to items of that purpose", () => {
    const weights = {
      byPurpose: {
        competitor: { boost: [], suppress: [{ term: "股价", score: 2 }] },
        policy: { boost: [], suppress: [] },
        tech: { boost: [], suppress: [] },
        industry: { boost: [], suppress: [] }
      },
      global: { boost: [], suppress: [] }
    };
    const items = [
      { title: "某公司股价大涨", summary: "", keywords: ["股价"], matchedPurposes: ["tech"] }
    ];
    const result = applyUserFeedbackScore(items, { weights, suppressThreshold: 2 });
    expect(result.kept.length).toBe(1);
    expect(result.dropped.length).toBe(0);
  });

  it("combines purpose boost with global boost", () => {
    const weights = {
      byPurpose: {
        competitor: { boost: [{ term: "宁德时代", score: 2 }], suppress: [] },
        policy: { boost: [], suppress: [] },
        tech: { boost: [], suppress: [] },
        industry: { boost: [], suppress: [] }
      },
      global: { boost: [{ term: "储能", score: 1 }], suppress: [] }
    };
    const items = [
      { title: "宁德时代储能项目", summary: "", keywords: ["宁德时代", "储能"], matchedPurposes: ["competitor"] }
    ];
    const result = applyUserFeedbackScore(items, { weights, boostThreshold: 2 });
    expect(result.kept.length).toBe(1);
    expect(result.kept[0].boosted).toBe(true);
  });
});
