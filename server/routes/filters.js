import { Router } from "express";
import db from "../db.js";
import { generateAliases } from "../lib/llmAlias.js";

const router = Router();

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) return value.split(",").map(s => s.trim()).filter(Boolean);
  return [];
}

router.get("/rules", (_req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM filter_rules ORDER BY priority DESC, id ASC").all();
    // Parse aliases JSON for frontend consumption
    res.json({ data: rows.map(r => ({ ...r, aliases: parseAliasesJson(r.aliases) })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function parseAliasesJson(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

router.post("/rules", async (req, res) => {
  try {
    const { type, name, mustInclude, mustExclude, active, priority, purpose = "", aliases: aliasesOverride } = req.body;
    const cleanName = (name || "").trim();
    // Use caller-provided aliases (e.g. from the add-dialog preview) when given,
    // otherwise generate via LLM (best-effort).
    const aliases = Array.isArray(aliasesOverride) ? aliasesOverride.filter(Boolean) : await generateAliases(cleanName);
    const result = db.prepare(
      "INSERT INTO filter_rules (type, name, must_include, must_exclude, active, priority, purpose, aliases) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(type, cleanName || null, JSON.stringify(toArray(mustInclude)), JSON.stringify(toArray(mustExclude)), active ? 1 : 0, priority || 0, purpose, JSON.stringify(aliases));
    res.json({ data: { id: result.lastInsertRowid, aliases } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/rules/:id", async (req, res) => {
  try {
    const { name, mustInclude, mustExclude, active, priority, purpose, aliases: aliasesOverride } = req.body;
    const cleanName = (name || "").trim();

    let aliases;
    if (Array.isArray(aliasesOverride)) {
      aliases = aliasesOverride.filter(Boolean);
    } else {
      const existing = db.prepare("SELECT name, aliases FROM filter_rules WHERE id = ?").get(req.params.id);
      if (existing && existing.name === cleanName) {
        // Name unchanged → keep existing aliases
        aliases = parseAliasesJson(existing.aliases);
      } else {
        // Name changed → regenerate
        aliases = cleanName ? await generateAliases(cleanName) : [];
      }
    }

    db.prepare(
      "UPDATE filter_rules SET name = ?, must_include = ?, must_exclude = ?, active = ?, priority = ?, purpose = ?, aliases = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(cleanName || null, JSON.stringify(toArray(mustInclude)), JSON.stringify(toArray(mustExclude)), active ? 1 : 0, priority || 0, purpose || "", JSON.stringify(aliases), req.params.id);
    res.json({ data: { success: true, aliases } });
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

// Regenerate LLM synonyms for a single filter rule (best-effort).
// body.persist=false → generate only, do not write to DB (edit-dialog preview).
// body.keyword → use this keyword instead of the stored rule name (e.g. after editing).
router.post("/rules/:id/regenerate-aliases", async (req, res) => {
  try {
    const rule = db.prepare("SELECT id, name FROM filter_rules WHERE id = ?").get(req.params.id);
    if (!rule) return res.status(404).json({ error: "Rule not found" });
    const keyword = (req.body?.keyword || "").trim() || rule.name;
    const aliases = await generateAliases(keyword);
    if (req.body?.persist !== false) {
      db.prepare("UPDATE filter_rules SET aliases = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(JSON.stringify(aliases), req.params.id);
    }
    res.json({ data: { aliases } });
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

router.get("/config", (req, res) => {
  try {
    const purpose = req.query.purpose || "";
    let row;
    if (purpose) {
      row = db.prepare("SELECT * FROM filter_config WHERE type = 'semantic' AND purpose = ? LIMIT 1").get(purpose);
    } else {
      row = db.prepare("SELECT * FROM filter_config WHERE type = 'semantic' AND (purpose = '' OR purpose IS NULL) LIMIT 1").get();
    }
    res.json({ data: row || { type: "semantic", content: "", active: 1, purpose: purpose || "" } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/config", (req, res) => {
  try {
    const { content, active } = req.body;
    const purpose = req.query.purpose || "";
    let existing;
    if (purpose) {
      existing = db.prepare("SELECT id FROM filter_config WHERE type = 'semantic' AND purpose = ? LIMIT 1").get(purpose);
    } else {
      existing = db.prepare("SELECT id FROM filter_config WHERE type = 'semantic' AND (purpose = '' OR purpose IS NULL) LIMIT 1").get();
    }
    if (existing) {
      db.prepare("UPDATE filter_config SET content = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(content || "", active ? 1 : 0, existing.id);
    } else {
      db.prepare("INSERT INTO filter_config (type, content, active, purpose) VALUES ('semantic', ?, ?, ?)")
        .run(content || "", active ? 1 : 0, purpose);
    }
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// AI presets
router.get("/ai-presets", (_req, res) => {
  try {
    const row = db.prepare("SELECT content FROM filter_config WHERE type = 'ai_presets' LIMIT 1").get();
    res.json({ data: row ? JSON.parse(row.content) : [] });
  } catch (e) {
    res.json({ data: [] });
  }
});

router.put("/ai-presets", (req, res) => {
  try {
    const content = JSON.stringify(req.body.presets || []);
    const existing = db.prepare("SELECT id FROM filter_config WHERE type = 'ai_presets' LIMIT 1").get();
    if (existing) {
      db.prepare("UPDATE filter_config SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(content, existing.id);
    } else {
      db.prepare("INSERT INTO filter_config (type, content, active) VALUES ('ai_presets', ?, 1)").run(content);
    }
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
