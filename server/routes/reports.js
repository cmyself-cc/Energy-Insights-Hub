import { Router } from "express";
import db from "../db.js";
import {
  listTemplates, createTemplate, updateTemplate, deleteTemplate, duplicateTemplate
} from "../services/reportTemplateService.js";
import { screenCards, clarifyCards, generateManualPrompt } from "../services/reportScreening.js";
import { createReportJob, getJob, listJobs, retryJob, processQueue } from "../services/reportGenerator.js";

const router = Router();

function parseRow(row) {
  if (!row) return row;
  return {
    ...row,
    items: row.items ? JSON.parse(row.items) : []
  };
}

// 归属判定（Task 9 / M2）：不存在与非本人一律 404（不泄露存在性），admin 直通。
// 注意与 reportTemplateService.ownedTemplate 的口径保持一致 —— 路由层的 404 语义
// 和集合层的可见性语义是同一套规则的两种表达。
const owned = (table, id, user) => {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) return null;
  if (user?.role === "admin") return row;
  return row.owner_id === user?.id ? row : null;
};

// 模板可见性：admin 全量；user 看公共 + 自己的。供 screening/clarify/generate 的
// templateId 校验用 —— 不可见一律 404（不泄露存在性）。
function visibleTemplate(id, user) {
  return listTemplates(user).find((t) => t.id === Number(id)) || null;
}

router.get("/", (req, res) => {
  try {
    const all = req.query.scope === "all" && req.user?.role === "admin";
    const rows = all
      ? db.prepare(`SELECT r.*, u.nickname AS owner_nickname FROM reports r
                    LEFT JOIN users u ON u.id = r.owner_id ORDER BY r.created_at DESC`).all()
      : db.prepare("SELECT * FROM reports WHERE owner_id = ? ORDER BY created_at DESC").all(req.user.id);
    res.json({ data: rows.map(parseRow) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get("/:id(\\d+)", (req, res) => {
  try {
    const row = owned("reports", req.params.id, req.user);
    if (!row) return res.status(404).json({ error: "Report not found" });
    res.json({ data: parseRow(row) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
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
      "INSERT INTO reports (title, content, items, language, owner_id) VALUES (?, ?, ?, ?, ?)"
    ).run(title, content, itemsStr, language, req.user.id);
    const row = db.prepare("SELECT * FROM reports WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json({ data: parseRow(row) });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.put("/:id(\\d+)", (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: "title and content are required" });
    if (!owned("reports", req.params.id, req.user)) return res.status(404).json({ error: "Report not found" });
    db.prepare("UPDATE reports SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(String(title), String(content), req.params.id);
    const row = db.prepare("SELECT * FROM reports WHERE id = ?").get(req.params.id);
    res.json({ data: parseRow(row) });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.delete("/:id", (req, res) => {
  try {
    if (!owned("reports", req.params.id, req.user)) return res.status(404).json({ error: "Report not found" });
    db.prepare("DELETE FROM reports WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

// 模板管理
router.get("/templates", (req, res) => {
  try {
    const all = req.query.scope === "all" && req.user?.role === "admin";
    res.json({ data: listTemplates(all ? null : req.user) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
router.post("/templates", (req, res) => {
  try { const row = createTemplate(req.body, req.user); res.status(201).json({ data: row }); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
router.put("/templates/:id", (req, res) => {
  try { const row = updateTemplate(Number(req.params.id), req.body, req.user); res.json({ data: row }); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
router.delete("/templates/:id", (req, res) => {
  try { deleteTemplate(Number(req.params.id), req.user); res.json({ success: true }); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
// 另存为副本：源模板必须可见（公共/自己的/admin），新行强制私有 + 归属自己。
router.post("/templates/:id/duplicate", (req, res) => {
  try { const row = duplicateTemplate(Number(req.params.id), req.user); res.status(201).json({ data: row }); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

// 筛查
router.post("/screening", async (req, res) => {
  try {
    const { templateId, insightIds } = req.body;
    if (!templateId || !Array.isArray(insightIds) || insightIds.length === 0) {
      return res.status(400).json({ error: "templateId and insightIds are required" });
    }
    const template = visibleTemplate(templateId, req.user);
    if (!template) return res.status(404).json({ error: "Template not found" });
    const ids = insightIds.map(Number).filter(Boolean);
    const placeholders = ids.map(() => "?").join(",");
    const insights = db.prepare(`SELECT * FROM insights WHERE id IN (${placeholders}) AND hidden = 0`).all(...ids);
    const result = await screenCards({ template, insights });
    res.json({ data: result });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// 追问：携带用户回答，LLM 决定继续提问或完成澄清
router.post("/clarify", async (req, res) => {
  try {
    const { templateId, insightIds, answers } = req.body;
    if (!templateId || !Array.isArray(insightIds) || insightIds.length === 0) {
      return res.status(400).json({ error: "templateId and insightIds are required" });
    }
    const template = visibleTemplate(templateId, req.user);
    if (!template) return res.status(404).json({ error: "Template not found" });
    const ids = insightIds.map(Number).filter(Boolean);
    const placeholders = ids.map(() => "?").join(",");
    const insights = db.prepare(`SELECT * FROM insights WHERE id IN (${placeholders}) AND hidden = 0`).all(...ids);
    const result = await clarifyCards({ template, insights, answers: answers || [] });
    res.json({ data: result });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// 手动输入主题/框架/大纲/核心结论 → LLM 生成提示词模板
router.post("/generate-prompt", async (req, res) => {
  try {
    const { topic, framework, outline, conclusion, language } = req.body;
    if (!topic && !framework && !outline && !conclusion) {
      return res.status(400).json({ error: "at least one of topic/framework/outline/conclusion is required" });
    }
    const result = await generateManualPrompt({ topic, framework, outline, conclusion, language: language || "zh" });
    res.json({ data: result });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// 生成任务：模板必须可见；报告与任务都落 owner_id。
router.post("/generate", (req, res) => {
  try {
    const { templateId, insightIds, resolutions, purpose, audience, theme } = req.body;
    if (!templateId || !Array.isArray(insightIds) || insightIds.length === 0) {
      return res.status(400).json({ error: "templateId and insightIds are required" });
    }
    if (!visibleTemplate(templateId, req.user)) return res.status(404).json({ error: "Template not found" });
    const job = createReportJob({
      templateId: Number(templateId), insightIds,
      resolutions: resolutions || [], purpose: purpose || "", audience: audience || "", theme: theme || "",
      ownerId: req.user.id
    });
    processQueue().catch(err => console.error("[report] queue processing failed:", err));
    res.status(201).json({ data: job });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});
router.get("/jobs", (req, res) => {
  try { res.json({ data: listJobs(req.user) }); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
router.get("/jobs/:id", (req, res) => {
  try {
    const job = getJob(Number(req.params.id), req.user);
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json({ data: job });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
router.post("/jobs/:id/retry", (req, res) => {
  try {
    const job = retryJob(Number(req.params.id), req.user);
    processQueue().catch(err => console.error("[report] queue processing failed:", err));
    res.json({ data: job });
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

export default router;
