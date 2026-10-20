import { describe, it, expect, beforeEach, afterAll } from "vitest";
import express from "express";
import db, { initDb } from "../db.js";
import modelsRouter from "./models.js";
import { requireAuth, requireAdmin } from "../lib/authMiddleware.js";
import { createSession } from "../lib/sessions.js";
import { clearAuthTables, insertTestUser, listen, makeCookieJar } from "../testUtils.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  // 与 server/apiRoutes.js 的真实挂载一致（requireAuth + requireAdmin 双门）
  app.use("/api/models", requireAuth, requireAdmin, modelsRouter);
  return app;
}

function sessionJarFor(userId) {
  const j = makeCookieJar();
  j.absorb({ headers: new Headers({ "set-cookie": `eih_session=${createSession(userId, "vitest")}` }) });
  return j;
}

async function authedApi(port, path, { method = "GET", body, as } = {}) {
  const j = sessionJarFor(as.id);
  const res = await fetch(`http://127.0.0.1:${port}/api/models${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(j.header() ? { Cookie: j.header() } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

let adm, std;

describe("GET /api/models/current —— 空态语义（2026-10-21 修复）", () => {
  beforeEach(() => {
    initDb();
    clearAuthTables();
    adm = insertTestUser({ unionid: "m-adm", role: "admin" });
    std = insertTestUser({ unionid: "m-std" });
    db.prepare("DELETE FROM model_configs").run();
    delete process.env.LLM_MODEL;
  });

  afterAll(() => {
    clearAuthTables();
    delete process.env.LLM_MODEL;
  });

  it("有 active 记录 → 返回该记录（不含 baseUrl/apiKey）", async () => {
    const { port, close } = await listen(buildApp());
    try {
      db.prepare(
        "INSERT INTO model_configs (name, base_url, model_id, api_key, is_active) VALUES ('主模型', 'https://x', 'gpt-x', 'secret', 1)"
      ).run();
      const res = await authedApi(port, "/current", { as: adm });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("主模型");
      expect(res.body.data.isActive).toBe(true);
      expect(res.body.data).not.toHaveProperty("baseUrl");
      expect(res.body.data).not.toHaveProperty("apiKey");
    } finally { await close(); }
  });

  it("无 active 记录但配了 LLM_MODEL 环境变量 → env 兜底对象（name=modelId，不再硬编码中文）", async () => {
    const { port, close } = await listen(buildApp());
    try {
      process.env.LLM_MODEL = "deepseek-v3";
      const res = await authedApi(port, "/current", { as: adm });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: null, name: "deepseek-v3", modelId: "deepseek-v3", isActive: true });
      expect(JSON.stringify(res.body.data)).not.toContain("未配置");
    } finally { await close(); }
  });

  it("🔴 无 active 记录且无 LLM_MODEL → data: null（Header 空态分支的死代码因此复活）", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const res = await authedApi(port, "/current", { as: adm });
      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    } finally { await close(); }
  });

  it("普通用户 → 403（requireAdmin 挂载不变）", async () => {
    const { port, close } = await listen(buildApp());
    try {
      expect((await authedApi(port, "/current", { as: std })).status).toBe(403);
    } finally { await close(); }
  });
});
