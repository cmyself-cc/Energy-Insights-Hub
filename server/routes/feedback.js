import { Router } from "express";
import db from "../db.js";
import { recordFeedback, getFeedbackStats } from "../services/feedbackService.js";
import { generateSuggestions } from "../services/feedbackSuggestionGenerator.js";

const router = Router();

router.post("/", (req, res) => {
  try {
    const { insightId, action, reason } = req.body;
    if (!insightId || !action) {
      return res.status(400).json({ error: "insightId and action are required" });
    }
    const feedback = recordFeedback({ insightId, action, reason });
    res.json({ data: feedback });
  } catch (e) {
    res.status(500).json({ error: e.message });
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

router.get("/suggestions", (_req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM feedback_rules_suggestions ORDER BY created_at DESC").all();
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/suggestions/:id/accept", (req, res) => {
  try {
    const suggestion = db.prepare("SELECT * FROM feedback_rules_suggestions WHERE id = ?").get(req.params.id);
    if (!suggestion) return res.status(404).json({ error: "Suggestion not found" });

    db.prepare(
      "INSERT INTO filter_rules (type, name, active, priority, purpose) VALUES (?, ?, 1, 0, ?)"
    ).run(suggestion.type, suggestion.name, suggestion.purpose || "");

    db.prepare(
      "UPDATE feedback_rules_suggestions SET status = 'accepted', decided_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(req.params.id);

    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/generate-suggestions", async (_req, res) => {
  try {
    const result = await generateSuggestions();
    res.json({ data: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/suggestions/:id/reject", (req, res) => {
  try {
    db.prepare(
      "UPDATE feedback_rules_suggestions SET status = 'rejected', decided_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(req.params.id);
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
