import { Router } from "express";
import db from "../db.js";
import { listTemplates, createTemplate, updateTemplate, deleteTemplate } from "../services/reportTemplateService.js";
import { screenCards } from "../services/reportScreening.js";
import { createReportJob, getJob, listJobs, retryJob, processQueue } from "../services/reportGenerator.js";

const router = Router();

function parseRow(row) {
  if (!row) return row;
  return {
    ...row,
    items: row.items ? JSON.parse(row.items) : []
  };
}

router.get("/", (_req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM reports ORDER BY created_at DESC").all();
    res.json({ data: rows.map(parseRow) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id(\\d+)", (req, res) => {
  try {
    const row = db.prepare("SELECT * FROM reports WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Report not found" });
    res.json({ data: parseRow(row) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", (req, res) => {
  try {
    const { title, content, items, language = "en" } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: "title and content are required" });
    }
    const itemsStr = items ? JSON.stringify(items) : null;
    const result = db.prepare(
      "INSERT INTO reports (title, content, items, language) VALUES (?, ?, ?, ?)"
    ).run(title, content, itemsStr, language);
    const row = db.prepare("SELECT * FROM reports WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json({ data: parseRow(row) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", (req, res) => {
  try {
    db.prepare("DELETE FROM reports WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 模板管理
router.get("/templates", (_req, res) => {
  try { res.json({ data: listTemplates() }); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/templates", (req, res) => {
  try { const row = createTemplate(req.body); res.status(201).json({ data: row }); } catch (e) { res.status(400).json({ error: e.message }); }
});
router.put("/templates/:id", (req, res) => {
  try { const row = updateTemplate(Number(req.params.id), req.body); res.json({ data: row }); } catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete("/templates/:id", (req, res) => {
  try { deleteTemplate(Number(req.params.id)); res.json({ success: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});

// 筛查
router.post("/screening", async (req, res) => {
  try {
    const { templateId, insightIds } = req.body;
    if (!templateId || !Array.isArray(insightIds) || insightIds.length === 0) {
      return res.status(400).json({ error: "templateId and insightIds are required" });
    }
    const template = listTemplates().find(t => t.id === Number(templateId));
    if (!template) return res.status(404).json({ error: "Template not found" });
    const ids = insightIds.map(Number).filter(Boolean);
    const placeholders = ids.map(() => "?").join(",");
    const insights = db.prepare(`SELECT * FROM insights WHERE id IN (${placeholders}) AND hidden = 0`).all(...ids);
    const result = await screenCards({ template, insights });
    res.json({ data: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 生成任务
router.post("/generate", (req, res) => {
  try {
    const { templateId, insightIds, resolutions } = req.body;
    if (!templateId || !Array.isArray(insightIds) || insightIds.length === 0) {
      return res.status(400).json({ error: "templateId and insightIds are required" });
    }
    const job = createReportJob({ templateId: Number(templateId), insightIds, resolutions: resolutions || [] });
    processQueue().catch(err => console.error("[report] queue processing failed:", err));
    res.status(201).json({ data: job });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
router.get("/jobs", (_req, res) => {
  try { res.json({ data: listJobs() }); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get("/jobs/:id", (req, res) => {
  try {
    const job = getJob(Number(req.params.id));
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json({ data: job });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/jobs/:id/retry", (req, res) => {
  try {
    const job = retryJob(Number(req.params.id));
    processQueue().catch(err => console.error("[report] queue processing failed:", err));
    res.json({ data: job });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

export default router;
