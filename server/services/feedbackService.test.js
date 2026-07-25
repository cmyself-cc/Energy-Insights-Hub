import { describe, it, expect, beforeEach, afterEach } from "vitest";
import db from "../db.js";
import { recordFeedback, getFeedbackStats } from "./feedbackService.js";

describe("feedbackService", () => {
  beforeEach(() => {
    db.prepare("DELETE FROM user_feedback").run();
    db.prepare("DELETE FROM feedback_semantic_weights").run();
    db.prepare("DELETE FROM insights").run();
    db.prepare("INSERT INTO insights (title, summary, keywords, purpose) VALUES (?, ?, ?, ?)")
      .run("Test Insight", "Summary", '["宁德时代", "储能"]','["competitor"]');
  });

  afterEach(() => {
    db.prepare("DELETE FROM user_feedback").run();
    db.prepare("DELETE FROM feedback_semantic_weights").run();
    db.prepare("DELETE FROM insights").run();
  });

  it("records bookmark and creates boost weights", () => {
    const insight = db.prepare("SELECT * FROM insights WHERE title = ?").get("Test Insight");
    const result = recordFeedback({ insightId: insight.id, action: "bookmark" });
    expect(result.id).toBeDefined();

    const weights = db.prepare("SELECT * FROM feedback_semantic_weights WHERE action = 'boost'").all();
    expect(weights.length).toBe(2);
    expect(weights.map(w => w.term)).toContain("宁德时代");
  });

  it("records hide with irrelevant reason and creates suppress weights", () => {
    const insight = db.prepare("SELECT * FROM insights WHERE title = ?").get("Test Insight");
    recordFeedback({ insightId: insight.id, action: "hide", reason: "irrelevant" });
    const weights = db.prepare("SELECT * FROM feedback_semantic_weights WHERE action = 'suppress'").all();
    expect(weights.length).toBe(2);
  });

  it("returns stats", () => {
    const insight = db.prepare("SELECT * FROM insights WHERE title = ?").get("Test Insight");
    recordFeedback({ insightId: insight.id, action: "bookmark" });
    recordFeedback({ insightId: insight.id, action: "hide", reason: "duplicate" });
    const stats = getFeedbackStats(7);
    expect(stats.total).toBe(2);
    expect(stats.bookmarks).toBe(1);
    expect(stats.hides).toBe(1);
    expect(stats.byReason.duplicate).toBe(1);
  });
});
