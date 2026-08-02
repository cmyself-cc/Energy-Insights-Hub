import { Router } from "express";
import fs from "fs";
import path from "path";
import db from "../db.js";

const router = Router();

// 同步模型配置到服务器 .env（并更新运行中进程的 process.env）
function syncEnv(env) {
  const envPath = path.join(process.cwd(), ".env");
  let envContent = "";
  try { envContent = fs.readFileSync(envPath, "utf-8"); } catch (e) { /* may not exist */ }

  const keys = { LLM_BASE_URL: env.baseUrl, LLM_MODEL: env.modelId };
  if (env.apiKey) keys.LLM_API_KEY = env.apiKey;

  const lines = envContent.split("\n");
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

  // 更新运行中进程（无需重启）
  if (env.baseUrl) process.env.LLM_BASE_URL = env.baseUrl;
  if (env.modelId) process.env.LLM_MODEL = env.modelId;
  if (env.apiKey) process.env.LLM_API_KEY = env.apiKey;
}

// 设为唯一 active 并同步 .env
function setActive(id) {
  const row = db.prepare("SELECT * FROM model_configs WHERE id = ?").get(id);
  if (!row) return null;
  db.prepare("UPDATE model_configs SET is_active = 0").run();
  db.prepare("UPDATE model_configs SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  syncEnv({ baseUrl: row.base_url, modelId: row.model_id, apiKey: row.api_key });
  return row;
}

// 安全列表：不暴露 base_url / api_key
function safeList(rows) {
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    providerName: r.provider_name,
    modelId: r.model_id,
    isActive: !!r.is_active
  }));
}

// 列表（不含 baseUrl/apiKey）
router.get("/", (_req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM model_configs ORDER BY is_active DESC, id ASC").all();
    res.json({ data: safeList(rows) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 当前生效模型（不含 baseUrl/apiKey）
router.get("/current", (_req, res) => {
  try {
    const row = db.prepare("SELECT * FROM model_configs WHERE is_active = 1 LIMIT 1").get();
    if (row) return res.json({ data: safeList([row])[0] });
    // 没有 active 记录时，用 .env 兜底
    res.json({ data: { id: null, name: process.env.LLM_MODEL || "未配置", modelId: process.env.LLM_MODEL || "", isActive: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 添加模型（设为 active 并同步 .env）
router.post("/", (req, res) => {
  try {
    const { name, baseUrl, modelId, apiKey } = req.body;
    if (!baseUrl || !modelId) {
      return res.status(400).json({ error: "baseUrl and modelId are required" });
    }
    // 去重：同 baseUrl + modelId
    const dup = db.prepare("SELECT id FROM model_configs WHERE base_url = ? AND model_id = ?").get(baseUrl.trim(), modelId.trim());
    if (dup) return res.status(409).json({ error: "Model already exists" });

    const result = db.prepare(
      "INSERT INTO model_configs (name, base_url, model_id, api_key, is_active) VALUES (?, ?, ?, ?, 1)"
    ).run(name?.trim() || modelId.trim(), baseUrl.trim(), modelId.trim(), apiKey?.trim() || "");

    db.prepare("UPDATE model_configs SET is_active = 0 WHERE id != ?").run(result.lastInsertRowid);
    syncEnv({ baseUrl: baseUrl.trim(), modelId: modelId.trim(), apiKey: apiKey?.trim() || "" });

    const rows = db.prepare("SELECT * FROM model_configs ORDER BY is_active DESC, id ASC").all();
    res.status(201).json({ data: safeList(rows) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 切换生效模型
router.put("/:id/active", (req, res) => {
  try {
    const row = setActive(req.params.id);
    if (!row) return res.status(404).json({ error: "Model not found" });
    const rows = db.prepare("SELECT * FROM model_configs ORDER BY is_active DESC, id ASC").all();
    res.json({ data: safeList(rows) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除模型
router.delete("/:id", (req, res) => {
  try {
    const row = db.prepare("SELECT * FROM model_configs WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Model not found" });
    db.prepare("DELETE FROM model_configs WHERE id = ?").run(req.params.id);
    // 若删除的是 active，则把 .env 保留当前（不重置），列表可能无 active
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
