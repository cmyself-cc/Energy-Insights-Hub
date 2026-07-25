import db from "../db.js";

function safeJson(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function snapshotInsight(insightId) {
  const row = db.prepare("SELECT * FROM insights WHERE id = ?").get(insightId);
  if (!row) return null;
  return {
    title: row.title,
    summary: row.summary,
    keywords: safeJson(row.keywords),
    purposes: safeJson(row.purpose),
    categories: safeJson(row.categories),
    sourceType: row.source_type
  };
}

const updateWeight = db.transaction((term, action, reasonCategory) => {
  const existing = db.prepare("SELECT * FROM feedback_semantic_weights WHERE term = ? AND action = ?").get(term, action);
  if (existing) {
    db.prepare(
      "UPDATE feedback_semantic_weights SET score = score + 1, feedback_count = feedback_count + 1, last_feedback_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(existing.id);
  } else {
    db.prepare(
      "INSERT INTO feedback_semantic_weights (term, term_type, action, reason_category, score) VALUES (?, 'keyword', ?, ?, 1)"
    ).run(term, action, reasonCategory || null);
  }
});

function updateWeightsFromFeedback(feedback) {
  const terms = feedback.keywords || [];
  if (feedback.action === "bookmark") {
    for (const term of terms) updateWeight(term, "boost", null);
    return;
  }
  if (feedback.action === "hide" && ["irrelevant", "low_quality"].includes(feedback.reason)) {
    for (const term of terms) updateWeight(term, "suppress", feedback.reason);
  }
}

export function recordFeedback({ insightId, action, reason }) {
  const insight = snapshotInsight(insightId);
  if (!insight) throw new Error("Insight not found");

  const result = db.prepare(
    "INSERT INTO user_feedback (insight_id, action, reason, title, summary, keywords, purposes, categories, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    insightId,
    action,
    reason || null,
    insight.title,
    insight.summary,
    JSON.stringify(insight.keywords),
    JSON.stringify(insight.purposes),
    JSON.stringify(insight.categories),
    insight.sourceType
  );

  const feedback = {
    id: result.lastInsertRowid,
    insightId,
    action,
    reason: reason || null,
    keywords: insight.keywords
  };
  updateWeightsFromFeedback(feedback);
  return feedback;
}

export function getFeedbackStats(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare("SELECT action, reason FROM user_feedback WHERE created_at >= ?").all(cutoff);
  const stats = { total: rows.length, bookmarks: 0, hides: 0, byReason: {} };
  for (const row of rows) {
    if (row.action === "bookmark") stats.bookmarks++;
    if (row.action === "hide") {
      stats.hides++;
      const reason = row.reason || "unknown";
      stats.byReason[reason] = (stats.byReason[reason] || 0) + 1;
    }
  }
  return stats;
}

export function getRecentFeedback(limit = 50) {
  return db.prepare("SELECT * FROM user_feedback ORDER BY created_at DESC LIMIT ?").all(limit);
}
