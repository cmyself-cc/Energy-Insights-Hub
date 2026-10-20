import { describe, it, expect, beforeEach, afterEach } from "vitest";
import db, { initDb } from "../db.js";
import { recordFeedback, getFeedbackStats } from "./feedbackService.js";

describe("feedbackService", () => {
  beforeEach(() => {
    initDb();
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
    const result = recordFeedback({ insightId: insight.id, action: "bookmark", isAdmin: true });
    expect(result.id).toBeDefined();

    const weights = db.prepare("SELECT * FROM feedback_semantic_weights WHERE action = 'boost'").all();
    expect(weights.length).toBe(2);
    expect(weights.map(w => w.term)).toContain("宁德时代");
  });

  it("records hide with irrelevant reason and creates suppress weights", () => {
    const insight = db.prepare("SELECT * FROM insights WHERE title = ?").get("Test Insight");
    recordFeedback({ insightId: insight.id, action: "hide", reason: "irrelevant", isAdmin: true });
    const weights = db.prepare("SELECT * FROM feedback_semantic_weights WHERE action = 'suppress'").all();
    expect(weights.length).toBe(2);
  });

  it("returns stats", () => {
    const insight = db.prepare("SELECT * FROM insights WHERE title = ?").get("Test Insight");
    recordFeedback({ insightId: insight.id, action: "bookmark", isAdmin: true });
    recordFeedback({ insightId: insight.id, action: "hide", reason: "duplicate" });
    const stats = getFeedbackStats(7);
    expect(stats.total).toBe(2);
    expect(stats.bookmarks).toBe(1);
    expect(stats.hides).toBe(1);
    expect(stats.byReason.duplicate).toBe(1);
  });

  it("records reclassify with from/to purpose and purpose-scoped weights", () => {

    const insight = db.prepare("SELECT * FROM insights WHERE title = ?").get("Test Insight");
    const result = recordFeedback({
      insightId: insight.id,
      action: "reclassify",
      fromPurpose: "competitor",
      toPurpose: "tech",
      isAdmin: true
    });
    expect(result.id).toBeDefined();

    const row = db.prepare("SELECT * FROM user_feedback WHERE id = ?").get(result.id);
    expect(row.action).toBe("reclassify");
    expect(row.from_purpose).toBe("competitor");
    expect(row.to_purpose).toBe("tech");

    // keywords: ["宁德时代", "储能"] → tech boost + competitor suppress
    const boosts = db.prepare("SELECT * FROM feedback_semantic_weights WHERE action = 'boost'").all();
    const suppresses = db.prepare("SELECT * FROM feedback_semantic_weights WHERE action = 'suppress'").all();
    expect(boosts.length).toBe(2);
    expect(boosts.every(w => w.purpose === "tech")).toBe(true);
    expect(suppresses.length).toBe(2);
    expect(suppresses.every(w => w.purpose === "competitor")).toBe(true);
  });

  it("Task 12 门：非 admin 反馈记录 user_id 但不动全局权重（FB-2/5）", () => {
    const insight = db.prepare("SELECT * FROM insights WHERE title = ?").get("Test Insight");
    const before = db.prepare("SELECT COUNT(*) c FROM feedback_semantic_weights").get().c;
    const result = recordFeedback({ insightId: insight.id, action: "hide", reason: "irrelevant", userId: 7 });
    expect(result.id).toBeDefined();
    const row = db.prepare("SELECT * FROM user_feedback WHERE id = ?").get(result.id);
    expect(row.user_id).toBe(7);
    expect(row.submit_state).toBe("none");
    const after = db.prepare("SELECT COUNT(*) c FROM feedback_semantic_weights").get().c;
    expect(after).toBe(before);   // 个人口味不许污染全局权重
  });

  it("stats counts reclassify", () => {
    const insight = db.prepare("SELECT * FROM insights WHERE title = ?").get("Test Insight");
    recordFeedback({ insightId: insight.id, action: "reclassify", fromPurpose: "competitor", toPurpose: "policy" });
    const stats = getFeedbackStats(7);
    expect(stats.reclassifies).toBe(1);
  });
});
