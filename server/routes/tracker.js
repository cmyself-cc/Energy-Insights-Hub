import { Router } from "express";
import db from "../db.js";
import { runTracker } from "../services/tracker.js";
import { parseConfigFile } from "../lib/configParser.js";
import { importSources, normalizeImportType } from "../services/sourceImporter.js";

const router = Router();

router.post("/stop", (_req, res) => {
  try {
    db.prepare("UPDATE tracker_runs SET stop_requested = 1 WHERE status = 'running'").run();
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

    // Aggregate multiple WeChat MCP accounts into a single MCP source to avoid duplication.
    const mcpUrlNames = new Map();
    const nonMcpSources = [];
    for (const s of parsed.sources) {
      if (s.type === "wechat_mcp") {
        if (!mcpUrlNames.has(s.url)) {
          mcpUrlNames.set(s.url, []);
        }
        mcpUrlNames.get(s.url).push(s.name);
      } else {
        nonMcpSources.push(s);
      }
    }
    const aggregatedMcpSources = Array.from(mcpUrlNames.entries()).map(([url, names]) => ({
      name: `微信公众号聚合 (${names.length}个账号)`,
      type: "wechat_mcp",
      url,
      config: JSON.stringify({ articleLimit: 20 })
    }));
    const normalizedSources = [...nonMcpSources, ...aggregatedMcpSources].map(normalizeImportType);

    const insertRule = db.prepare(
      "INSERT INTO filter_rules (type, name, must_include, must_exclude, active, priority) VALUES (?, ?, ?, ?, 1, 0)"
    );
    const insertCategory = db.prepare(
      "INSERT INTO business_categories (name, description, inclusion_prompt, active) VALUES (?, ?, ?, 1)"
    );
    const updateCategory = db.prepare(
      "UPDATE business_categories SET description = ?, inclusion_prompt = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?"
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
    const existingEnterpriseRules =
      mode === "append"
        ? new Set(db.prepare("SELECT name FROM filter_rules WHERE type = 'enterprise'").all().map(r => r.name))
        : new Set();
    const existingIncludeRules =
      mode === "append"
        ? new Set(db.prepare("SELECT name FROM filter_rules WHERE type = 'include_keyword'").all().map(r => r.name))
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
      for (const k of parsed.enterpriseKeywords || []) {
        if (mode === "append" && existingEnterpriseRules.has(k)) continue;
        insertRule.run("enterprise", k, "[]", "[]");
        rulesImported++;
      }
      for (const k of parsed.includeKeywords || []) {
        if (mode === "append" && existingIncludeRules.has(k)) continue;
        insertRule.run("include_keyword", k, "[]", "[]");
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

router.get("/status", (_req, res) => {
  try {
    const running = db.prepare(
      "SELECT id, sources_total, sources_success, sources_failed, insights_created, phase, phase_progress, status, started_at FROM tracker_runs WHERE status = 'running' AND started_at >= datetime('now', '-1 hour') ORDER BY id DESC LIMIT 1"
    ).get();
    if (!running) {
      const last = db.prepare(
        "SELECT id, status FROM tracker_runs ORDER BY id DESC LIMIT 1"
      ).get();
      return res.json({ data: { active: false, lastRun: last || null } });
    }
    res.json({ data: { active: true, ...running } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/export-config", (_req, res) => {
  try {
    const sources = db.prepare("SELECT * FROM sources").all();
    const filterRules = db.prepare("SELECT * FROM filter_rules").all();
    const businessCategories = db.prepare("SELECT * FROM business_categories").all();
    const filterConfig = db.prepare("SELECT * FROM filter_config").all();
    const industryCategories = db.prepare("SELECT * FROM industry_categories").all();
    const trackerSettings = db.prepare("SELECT key, value FROM tracker_settings").all();

    res.json({
      data: {
        version: 1,
        exportedAt: new Date().toISOString(),
        sources,
        filterRules,
        businessCategories,
        filterConfig,
        industryCategories,
        trackerSettings
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/import-config-full", (req, res) => {
  try {
    const data = req.body;
    if (!data.sources || !data.filterRules) {
      return res.status(400).json({ error: "Invalid config format" });
    }

    const tx = db.transaction(() => {
      db.prepare("DELETE FROM sources").run();
      db.prepare("DELETE FROM filter_rules").run();
      db.prepare("DELETE FROM business_categories").run();
      db.prepare("DELETE FROM filter_config").run();
      db.prepare("DELETE FROM industry_categories").run();
      db.prepare("DELETE FROM tracker_settings").run();

      const insertSource = db.prepare("INSERT INTO sources (name, url, type, active, config, purpose) VALUES (?,?,?,?,?,?)");
      for (const s of data.sources) {
        insertSource.run(s.name, s.url, s.type, s.active ?? 1, s.config || null, s.purpose || '');
      }

      const insertRule = db.prepare("INSERT INTO filter_rules (type, name, must_include, must_exclude, active, priority, purpose) VALUES (?,?,?,?,?,?,?)");
      for (const r of data.filterRules) {
        insertRule.run(r.type, r.name, r.must_include || '[]', r.must_exclude || '[]', r.active ?? 1, r.priority ?? 0, r.purpose || '');
      }

      const insertCat = db.prepare("INSERT INTO business_categories (name, description, inclusion_prompt, active) VALUES (?,?,?,?)");
      for (const c of data.businessCategories) {
        insertCat.run(c.name, c.description, c.inclusion_prompt, c.active ?? 1);
      }

      const insertFc = db.prepare("INSERT INTO filter_config (type, content, active, purpose) VALUES (?,?,?,?)");
      for (const fc of data.filterConfig) {
        insertFc.run(fc.type, fc.content, fc.active ?? 1, fc.purpose || '');
      }

      const insertIc = db.prepare("INSERT INTO industry_categories (name, keywords, active) VALUES (?,?,?)");
      for (const ic of data.industryCategories || []) {
        insertIc.run(ic.name, ic.keywords || '[]', ic.active ?? 1);
      }

      const insertTs = db.prepare("INSERT INTO tracker_settings (key, value) VALUES (?,?)");
      for (const ts of data.trackerSettings || []) {
        insertTs.run(ts.key, ts.value);
      }
    });
    tx();

    res.json({ data: { success: true, message: "Config imported" } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
