import { Router } from "express";
import fs from "fs";
import path from "path";
import db from "../db.js";
import { loadSettings, toArray, SOURCE_TYPES } from "../lib/trackerSettings.js";
import { rescheduleScheduler } from "../services/tracker.js";

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
      wechatMcpPerFeedLimit,
      requiredIndustryKeywords,
      fuzzyDeduplicationThreshold,
      scheduleEnabled,
      scheduleFrequency,
      scheduleTime,
      scheduleWeekday,
      enabledSourceTypes
    } = req.body;

    if (typeof lookbackHours !== "number" || lookbackHours < 1 || lookbackHours > 168) {
      return res.status(400).json({ error: "lookbackHours must be between 1 and 168" });
    }
    if (typeof maxPerSource !== "number" || maxPerSource < 1 || maxPerSource > 50) {
      return res.status(400).json({ error: "maxPerSource must be between 1 and 50" });
    }
    const perFeed = Number(wechatMcpPerFeedLimit);
    if (wechatMcpPerFeedLimit !== undefined && (Number.isNaN(perFeed) || perFeed < 1 || perFeed > 50)) {
      return res.status(400).json({ error: "wechatMcpPerFeedLimit must be between 1 and 50" });
    }
    const threshold = Number(fuzzyDeduplicationThreshold);
    if (Number.isNaN(threshold) || threshold < 0 || threshold > 1) {
      return res.status(400).json({ error: "fuzzyDeduplicationThreshold must be between 0 and 1" });
    }

    // Optional schedule settings: 定时跟踪的开关、频次、时间点（每周时还需周几）
    const freq = scheduleFrequency === undefined ? "daily" : scheduleFrequency;
    if (freq !== "daily" && freq !== "weekly") {
      return res.status(400).json({ error: "scheduleFrequency must be 'daily' or 'weekly'" });
    }
    const time = scheduleTime === undefined ? "05:00" : scheduleTime;
    if (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      return res.status(400).json({ error: "scheduleTime must be HH:MM (24h format)" });
    }
    const weekday = scheduleWeekday === undefined ? 1 : Number(scheduleWeekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return res.status(400).json({ error: "scheduleWeekday must be an integer between 0 (Sunday) and 6" });
    }

    // Optional monitoring source types; empty = all source types enabled.
    let sourceTypes = enabledSourceTypes;
    if (sourceTypes !== undefined) {
      if (!Array.isArray(sourceTypes) || sourceTypes.some(t => !SOURCE_TYPES.includes(t))) {
        return res.status(400).json({ error: `enabledSourceTypes must be an array of ${SOURCE_TYPES.join(", ")}` });
      }
    }

    const values = {
      lookback_hours: String(lookbackHours),
      max_per_source: String(maxPerSource),
      required_industry_keywords: toArray(requiredIndustryKeywords).join(","),
      fuzzy_deduplication_threshold: String(threshold),
      schedule_enabled: scheduleEnabled === false ? "0" : "1",
      schedule_frequency: freq,
      schedule_time: time,
      schedule_weekday: String(weekday)
    };
    if (sourceTypes !== undefined) {
      values.enabled_source_types = sourceTypes.join(",");
    }
    if (wechatMcpPerFeedLimit !== undefined) {
      values.wechat_mcp_per_feed_limit = String(perFeed);
      // 同步到微信MCP 源的 config.perFeedLimit
      const src = db.prepare("SELECT * FROM sources WHERE type = 'wechat_mcp' LIMIT 1").get();
      if (src) {
        let cfg = {};
        try { cfg = JSON.parse(src.config || "{}"); } catch (e) { /* keep {} */ }
        cfg.perFeedLimit = perFeed;
        db.prepare("UPDATE sources SET config = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .run(JSON.stringify(cfg), src.id);
      }
    }

    const update = db.prepare(
      "INSERT INTO tracker_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP"
    );
    const tx = db.transaction((vals) => {
      for (const [key, value] of Object.entries(vals)) update.run(key, value);
    });
    tx(values);

    // Apply schedule changes to the running scheduler without a restart.
    rescheduleScheduler();

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
    try { envContent = fs.readFileSync(envPath, "utf-8"); } catch (e) { /* file may not exist yet */ }

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

    // 同时更新运行中进程的环境变量，使服务端 LLM 调用立即生效（无需重启）
    if (baseUrl) process.env.LLM_BASE_URL = baseUrl;
    if (modelId) process.env.LLM_MODEL = modelId;
    if (apiKey) process.env.LLM_API_KEY = apiKey;

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
