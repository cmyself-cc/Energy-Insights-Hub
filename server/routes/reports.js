import { Router } from "express";
import db from "../db.js";

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

router.get("/:id", (req, res) => {
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

export default router;
