import { Router } from "express";
import db from "../db.js";

const router = Router();

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) return value.split(",").map(s => s.trim()).filter(Boolean);
  return [];
}

router.get("/rules", (_req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM filter_rules ORDER BY priority DESC, id ASC").all();
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/rules", (req, res) => {
  try {
    const { type, name, mustInclude, mustExclude, active, priority } = req.body;
    const result = db.prepare(
      "INSERT INTO filter_rules (type, name, must_include, must_exclude, active, priority) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(type, name || null, JSON.stringify(toArray(mustInclude)), JSON.stringify(toArray(mustExclude)), active ? 1 : 0, priority || 0);
    res.json({ data: { id: result.lastInsertRowid } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/rules/:id", (req, res) => {
  try {
    const { name, mustInclude, mustExclude, active, priority } = req.body;
    db.prepare(
      "UPDATE filter_rules SET name = ?, must_include = ?, must_exclude = ?, active = ?, priority = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(name || null, JSON.stringify(toArray(mustInclude)), JSON.stringify(toArray(mustExclude)), active ? 1 : 0, priority || 0, req.params.id);
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/rules/:id", (req, res) => {
  try {
    db.prepare("DELETE FROM filter_rules WHERE id = ?").run(req.params.id);
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/categories", (_req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM business_categories ORDER BY name ASC").all();
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/categories/:id", (req, res) => {
  try {
    const { description, inclusion_prompt, active } = req.body;
    db.prepare(
      "UPDATE business_categories SET description = ?, inclusion_prompt = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(description || "", inclusion_prompt || "", active ? 1 : 0, req.params.id);
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/config", (_req, res) => {
  try {
    const row = db.prepare("SELECT * FROM filter_config WHERE type = 'semantic' LIMIT 1").get();
    res.json({ data: row || { type: "semantic", content: "", active: 1 } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/config", (req, res) => {
  try {
    const { content, active } = req.body;
    const existing = db.prepare("SELECT id FROM filter_config WHERE type = 'semantic' LIMIT 1").get();
    if (existing) {
      db.prepare("UPDATE filter_config SET content = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(content || "", active ? 1 : 0, existing.id);
    } else {
      db.prepare("INSERT INTO filter_config (type, content, active) VALUES ('semantic', ?, ?)")
        .run(content || "", active ? 1 : 0);
    }
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
