import { Router } from "express";
import db from "../db.js";
import { requireAdmin } from "../lib/authMiddleware.js";
import { recordFeedback, getFeedbackStats } from "../services/feedbackService.js";
import { generateSuggestions } from "../services/feedbackSuggestionGenerator.js";

const router = Router();

// Task 12 / M4 角色分流（FB-2/5）：
// - POST / 任何登录用户可反馈，行落 user_id；权重学习只由 admin 触发（feedbackService 内部门）。
// - POST /:insightId/submit 用户把一张卡片「提交给管理员审阅」：生成 pending 建议，不碰全局规则。
// - GET /suggestions 分流：admin 全量（带提交人昵称），user 只见自己提交的。
// - accept/reject 叠 requireAdmin —— 🔴 这是 Task 6 之前就已存在的越权写点（任何登录用户
//   accept 都会直接 INSERT 全局 filter_rules），Task 12 修复（对应 PLAN:1867/1892 的排期）。
router.post("/", (req, res) => {
  try {
    const { insightId, action, reason, fromPurpose, toPurpose } = req.body;
    if (!["bookmark", "hide", "reclassify"].includes(action)) {
      return res.status(400).json({ error: "action must be 'bookmark', 'hide' or 'reclassify'" });
    }
    if (!insightId || !action) {
      return res.status(400).json({ error: "insightId and action are required" });
    }
    if (action === "reclassify" && (!fromPurpose || !toPurpose)) {
      return res.status(400).json({ error: "fromPurpose and toPurpose are required for reclassify" });
    }
    const feedback = recordFeedback({
      insightId, action, reason, fromPurpose, toPurpose,
      userId: req.user.id, isAdmin: req.user.role === "admin"
    });
    res.json({ data: feedback });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 用户提交卡片给管理员审阅。推断规则建议：
//   type=exclude_keyword（隐藏类反馈的统一推断；reason 只作为说明保留在 reason/evidence 里），
//   name=卡片第一个关键词（无关键词则截取标题前 20 字），purpose=卡片第一个监测目的。
// 管理员在 Feedback 页 accept 后才会真正写 filter_rules。
router.post("/:insightId(\\d+)/submit", (req, res) => {
  try {
    const insight = db.prepare("SELECT * FROM insights WHERE id = ?").get(Number(req.params.insightId));
    if (!insight) return res.status(404).json({ error: "Insight not found" });

    const { reason, note } = req.body || {};
    let keywords = [];
    try { keywords = JSON.parse(insight.keywords || "[]"); } catch { keywords = []; }
    // 列名是 purpose（单数，JSON 数组串），不是 purposes —— snapshotInsight 也是这么映射的
    let purposes = [];
    try { purposes = JSON.parse(insight.purpose || "[]"); } catch { purposes = []; }
    const name = (keywords[0] || String(insight.title || "").slice(0, 20)).trim();
    if (!name) return res.status(400).json({ error: "cannot infer a rule name from this card" });
    const type = "exclude_keyword";
    const purpose = purposes[0] || "";

    // 与该卡片最近一条本人反馈关联：置 submit_state='submitted'（审批流状态机，024 列）。
    // 用 MAX(id) 而不是裸 UPDATE：一个用户可能对同一张卡反馈多次，只挂最近一条。
    db.prepare(
      `UPDATE user_feedback SET submit_state='submitted'
       WHERE id = (SELECT MAX(id) FROM user_feedback WHERE insight_id = ? AND user_id = ?)`
    ).run(insight.id, req.user.id);

    // 去重：同一 type+name+purpose 已有 pending/accepted 建议（任何人提交）就不再入队，
    // 与 feedbackSuggestionGenerator 的口径一致，避免审阅队列被重复提交刷爆。
    const dup = db.prepare(
      "SELECT id FROM feedback_rules_suggestions WHERE type=? AND name=? AND purpose=? AND status IN ('pending','accepted') LIMIT 1"
    ).get(type, name, purpose);
    if (dup) return res.json({ data: { suggestionId: dup.id, deduped: true } });

    const r = db.prepare(
      `INSERT INTO feedback_rules_suggestions (type, name, purpose, reason, evidence, status, submitter_id)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`
    ).run(type, name, purpose, reason || "", note ? String(note).slice(0, 500) : "", req.user.id);
    res.status(201).json({ data: { suggestionId: Number(r.lastInsertRowid), deduped: false } });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get("/stats", (_req, res) => {
  try {
    const stats = getFeedbackStats(30);
    res.json({ data: stats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 审阅队列：admin 全量 + 提交人昵称；user 只看自己提交的（M4 分流）。
router.get("/suggestions", (req, res) => {
  try {
    if (req.user.role === "admin") {
      const rows = db.prepare(
        `SELECT s.*, u.nickname AS submitter_nickname
         FROM feedback_rules_suggestions s LEFT JOIN users u ON u.id = s.submitter_id
         ORDER BY s.created_at DESC`
      ).all();
      return res.json({ data: rows });
    }
    const rows = db.prepare(
      "SELECT * FROM feedback_rules_suggestions WHERE submitter_id = ? ORDER BY created_at DESC"
    ).all(req.user.id);
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 🔴 requireAdmin：accept 直接 INSERT 全局 filter_rules —— 这是全局过滤规则的写入口，
// 任何普通用户都能走到的话等于人人可注入规则（Task 6 评审时登记的越权写点，本任务修复）。
router.post("/suggestions/:id/accept", requireAdmin, (req, res) => {
  try {
    const suggestion = db.prepare("SELECT * FROM feedback_rules_suggestions WHERE id = ?").get(req.params.id);
    if (!suggestion) return res.status(404).json({ error: "Suggestion not found" });

    db.prepare(
      "INSERT INTO filter_rules (type, name, active, priority, purpose) VALUES (?, ?, 1, 0, ?)"
    ).run(suggestion.type, suggestion.name, suggestion.purpose || "");

    db.prepare(
      "UPDATE feedback_rules_suggestions SET status = 'accepted', decided_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(req.params.id);

    // 尽力同步提交人的反馈状态机：建议行没有回指 user_feedback 的列（024 没加），
    // 只能按「该提交人最近一条 submitted」对齐 —— 够用，因为提交入口本身只挂最近一条。
    if (suggestion.submitter_id != null) {
      db.prepare(
        `UPDATE user_feedback SET submit_state='accepted'
         WHERE id = (SELECT MAX(id) FROM user_feedback WHERE user_id = ? AND submit_state = 'submitted')`
      ).run(suggestion.submitter_id);
    }

    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/generate-suggestions", requireAdmin, async (req, res) => {
  try {
    const result = await generateSuggestions();
    res.json({ data: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/suggestions/:id/reject", requireAdmin, (req, res) => {
  try {
    const r = db.prepare(
      "UPDATE feedback_rules_suggestions SET status = 'rejected', decided_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: "Suggestion not found" });
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
