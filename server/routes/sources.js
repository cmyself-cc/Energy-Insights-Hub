import { Router } from "express";
import db from "../db.js";
import { loadSourcesFromMd } from "../lib/sourcesMdLoader.js";
import { parseConfigFile } from "../lib/configParser.js";
import { importSources, normalizeImportType } from "../services/sourceImporter.js";

const router = Router();

const ALLOWED_TYPES = ["rss", "website", "wechat", "api", "scrape"];

function parseConfig(config) {
  if (!config) return null;
  if (typeof config === "string") {
    try {
      return JSON.parse(config);
    } catch {
      return null;
    }
  }
  return config;
}

router.get("/", (_req, res) => {
  try {
    const sources = db.prepare("SELECT * FROM sources ORDER BY created_at DESC").all();
    res.json({ data: sources.map(s => ({ ...s, config: parseConfig(s.config) })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id", (req, res) => {
  try {
    const source = db.prepare("SELECT * FROM sources WHERE id = ?").get(req.params.id);
    if (!source) return res.status(404).json({ error: "Source not found" });
    res.json({ data: { ...source, config: parseConfig(source.config) } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", (req, res) => {
  try {
    const { name, url, type = "rss", active = 1, config } = req.body;
    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }
    if (type !== "wechat" && !url) {
      return res.status(400).json({ error: "url is required for this source type" });
    }
    if (!ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of ${ALLOWED_TYPES.join(", ")}` });
    }
    const configStr = config ? JSON.stringify(config) : null;
    const result = db.prepare(
      "INSERT INTO sources (name, url, type, active, config) VALUES (?, ?, ?, ?, ?)"
    ).run(name, url, type, active ? 1 : 0, configStr);
    const source = db.prepare("SELECT * FROM sources WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json({ data: { ...source, config: parseConfig(source.config) } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/import-md", (_req, res) => {
  try {
    const drafts = loadSourcesFromMd();
    let inserted = 0;
    let existed = 0;
    const failed = [];

    const checkExisting = db.prepare("SELECT id FROM sources WHERE name = ? AND url = ?");
    const insert = db.prepare(
      "INSERT INTO sources (name, url, type, active, config) VALUES (?, ?, ?, ?, ?)"
    );

    const importTx = db.transaction(() => {
      for (const draft of drafts) {
        try {
          if (!ALLOWED_TYPES.includes(draft.type)) {
            failed.push({ name: draft.name, reason: `invalid type: ${draft.type}` });
            continue;
          }
          const existing = checkExisting.get(draft.name, draft.url);
          if (existing) {
            existed++;
            continue;
          }
          insert.run(draft.name, draft.url, draft.type, draft.active, draft.config);
          inserted++;
        } catch (e) {
          failed.push({ name: draft.name, reason: e.message });
        }
      }
    });

    importTx();

    res.json({ data: { inserted, existed, failed } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/import", (req, res) => {
  try {
    if (!req.body || !req.body.file) {
      return res.status(400).json({ error: "Missing file" });
    }
    const buffer = Buffer.from(req.body.file, "base64");
    const parsed = parseConfigFile(buffer, req.body.filename || "config.json");
    const normalized = parsed.sources.map(normalizeImportType);
    const result = importSources(normalized, req.body.mode || "append");
    res.json({ data: result });
  } catch (e) {
    if (e.statusCode === 400) {
      return res.status(400).json({ error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id", (req, res) => {
  try {
    const { name, url, type, active, config } = req.body;
    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }
    if (type !== "wechat" && !url) {
      return res.status(400).json({ error: "url is required for this source type" });
    }
    if (!ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of ${ALLOWED_TYPES.join(", ")}` });
    }
    const configStr = config ? JSON.stringify(config) : null;
    db.prepare(
      "UPDATE sources SET name = ?, url = ?, type = ?, active = ?, config = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(name, url, type, active ? 1 : 0, configStr, req.params.id);
    const source = db.prepare("SELECT * FROM sources WHERE id = ?").get(req.params.id);
    if (!source) return res.status(404).json({ error: "Source not found" });
    res.json({ data: { ...source, config: parseConfig(source.config) } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", (req, res) => {
  try {
    db.prepare("DELETE FROM sources WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
