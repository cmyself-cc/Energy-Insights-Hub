import { Router } from "express";
import db from "../db.js";
import { runTracker } from "../services/tracker.js";
import { parseConfigFile } from "../lib/configParser.js";
import { importSources, normalizeImportType } from "../services/sourceImporter.js";

const router = Router();

router.post("/run", async (_req, res) => {
  try {
    // 在后台运行，立即返回运行 ID
    const insert = db.prepare(
      "INSERT INTO tracker_runs (status, started_at) VALUES ('running', CURRENT_TIMESTAMP)"
    );
    const result = insert.run();
    const runId = result.lastInsertRowid;

    runTracker(runId).catch(err => {
      console.error("Tracker run failed:", err);
    });

    res.json({ data: { runId, status: "running" } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/runs", (_req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM tracker_runs ORDER BY started_at DESC LIMIT 20").all();
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/runs/:id", (req, res) => {
  try {
    const row = db.prepare("SELECT * FROM tracker_runs WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Run not found" });
    res.json({ data: row });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/import-config", (req, res) => {
  try {
    if (!req.body || !req.body.file) {
      return res.status(400).json({ error: "Missing file" });
    }
    const buffer = Buffer.from(req.body.file, "base64");
    const parsed = parseConfigFile(buffer, req.body.filename || "config.json");
    const mode = req.body.mode || "append";
    const normalizedSources = parsed.sources.map(normalizeImportType);

    const insertRule = db.prepare(
      "INSERT INTO filter_rules (type, name, must_include, must_exclude, active, priority) VALUES (?, ?, ?, ?, 1, 0)"
    );
    const insertCategory = db.prepare(
      "INSERT INTO business_categories (name, description, inclusion_prompt, active) VALUES (?, ?, ?, 1)"
    );
    const updateCategory = db.prepare(
      "UPDATE business_categories SET description = ?, inclusion_prompt = ?, active = 1, updated_at = CURRENT_TIMESTAMP WHERE name = ?"
    );

    const existingCategoryNames =
      mode === "append"
        ? new Set(db.prepare("SELECT name FROM business_categories").all().map(r => r.name))
        : new Set();
    const existingExcludeRules =
      mode === "append"
        ? new Set(
            db.prepare("SELECT must_exclude FROM filter_rules WHERE type = 'exclude_keyword'")
              .all()
              .map(r => r.must_exclude)
          )
        : new Set();
    const existingCompositeRules =
      mode === "append"
        ? new Set(
            db.prepare("SELECT must_include, must_exclude FROM filter_rules WHERE type = 'composite' AND active = 1")
              .all()
              .map(r => `${r.must_include}||${r.must_exclude}`)
          )
        : new Set();

    let categoriesImported = 0;

    let rulesImported = 0;

    const tx = db.transaction(() => {
      if (mode === "replace") {
        db.prepare("DELETE FROM filter_rules").run();
        db.prepare("DELETE FROM business_categories").run();
      }

      for (const k of parsed.excludeKeywords) {
        const mustExclude = JSON.stringify([k]);
        if (mode === "append" && existingExcludeRules.has(mustExclude)) continue;
        insertRule.run("exclude_keyword", k, "[]", mustExclude);
        rulesImported++;
      }
      for (const r of parsed.compositeRules) {
        const compositeKey = `${r.must_include}||${r.must_exclude}`;
        if (mode === "append" && existingCompositeRules.has(compositeKey)) continue;
        insertRule.run(r.type, r.name, r.must_include, r.must_exclude);
        rulesImported++;
      }
      for (const c of parsed.categories) {
        if (mode === "append" && existingCategoryNames.has(c.name)) {
          updateCategory.run(c.description, c.inclusion_prompt, c.name);
          continue;
        }
        insertCategory.run(c.name, c.description, c.inclusion_prompt);
        categoriesImported++;
      }
      if (parsed.semanticPrompt) {
        const existing = db.prepare("SELECT id FROM filter_config WHERE type = 'semantic' LIMIT 1").get();
        if (existing) {
          db.prepare("UPDATE filter_config SET content = ?, active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run(parsed.semanticPrompt, existing.id);
        } else {
          db.prepare("INSERT INTO filter_config (type, content, active) VALUES ('semantic', ?, 1)")
            .run(parsed.semanticPrompt);
        }
      }
    });
    tx();

    const sourceResult = importSources(normalizedSources, mode);

    res.json({ data: {
      rulesImported,
      categoriesImported,
      sourcesImported: sourceResult.imported
    }});
  } catch (e) {
    if (e.statusCode === 400) {
      return res.status(400).json({ error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
});

export default router;
