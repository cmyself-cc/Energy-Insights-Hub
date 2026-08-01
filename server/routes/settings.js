import { Router } from "express";
import fs from "fs";
import path from "path";
import db from "../db.js";
import { loadSettings, toArray } from "../lib/trackerSettings.js";

const router = Router();

router.get("/", (_req, res) => {
  try {
    res.json({ data: loadSettings() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/", (req, res) => {
  try {
    const {
      lookbackHours,
      maxPerSource,
      requiredIndustryKeywords,
      fuzzyDeduplicationThreshold
    } = req.body;

    if (typeof lookbackHours !== "number" || lookbackHours < 1 || lookbackHours > 168) {
      return res.status(400).json({ error: "lookbackHours must be between 1 and 168" });
    }
    if (typeof maxPerSource !== "number" || maxPerSource < 1 || maxPerSource > 50) {
      return res.status(400).json({ error: "maxPerSource must be between 1 and 50" });
    }
    const threshold = Number(fuzzyDeduplicationThreshold);
    if (Number.isNaN(threshold) || threshold < 0 || threshold > 1) {
      return res.status(400).json({ error: "fuzzyDeduplicationThreshold must be between 0 and 1" });
    }

    const values = {
      lookback_hours: String(lookbackHours),
      max_per_source: String(maxPerSource),
      required_industry_keywords: toArray(requiredIndustryKeywords).join(","),
      fuzzy_deduplication_threshold: String(threshold)
    };

    const update = db.prepare(
      "INSERT INTO tracker_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP"
    );
    const tx = db.transaction((vals) => {
      for (const [key, value] of Object.entries(vals)) update.run(key, value);
    });
    tx(values);

    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/save-llm-env", (req, res) => {
  try {
    const { baseUrl, apiKey, modelId } = req.body;
    const envPath = path.join(process.cwd(), ".env");

    let envContent = "";
    try { envContent = fs.readFileSync(envPath, "utf-8"); } catch (e) {}

    const lines = envContent.split("\n");
    const keys = { LLM_BASE_URL: baseUrl, LLM_MODEL: modelId };
    if (apiKey) keys.LLM_API_KEY = apiKey;
    const newLines = [];
    const found = new Set();
    for (const line of lines) {
      const trimmed = line.trim();
      let replaced = false;
      for (const [key, value] of Object.entries(keys)) {
        if (trimmed.startsWith(`${key}=`) && value) {
          newLines.push(`${key}=${value}`);
          found.add(key);
          replaced = true;
          break;
        }
      }
      if (!replaced && trimmed) newLines.push(line);
    }
    for (const [key, value] of Object.entries(keys)) {
      if (!found.has(key) && value) newLines.push(`${key}=${value}`);
    }

    fs.writeFileSync(envPath, newLines.join("\n") + "\n", "utf-8");
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/test-llm", async (req, res) => {
  try {
    const { modelId } = req.body;
    const config = {
      providerId: process.env.LLM_PROVIDER || "openai",
      baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
      modelId: modelId || process.env.LLM_MODEL || "gpt-4o-mini",
      apiKey: process.env.LLM_API_KEY
    };
    if (!config.apiKey) return res.status(400).json({ error: "Server API key not configured" });

    const resp = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.modelId, messages: [{ role: "user", content: "hi" }], max_tokens: 5 })
    });
    res.json({ data: { success: resp.ok, status: resp.status } });
  } catch (e) {
    res.json({ data: { success: false, error: e.message } });
  }
});

export { loadSettings };
export default router;
