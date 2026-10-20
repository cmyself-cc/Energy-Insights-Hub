import { describe, it, expect, beforeEach, afterAll } from "vitest";
import express from "express";
import db, { initDb } from "../db.js";
import feedbackRouter from "./feedback.js";
import { requireAuth } from "../lib/authMiddleware.js";
import { createSession } from "../lib/sessions.js";
import { clearAuthTables, insertTestUser, listen, makeCookieJar } from "../testUtils.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/feedback", requireAuth, feedbackRouter);
  return app;
}

function sessionJarFor(userId) {
  const j = makeCookieJar();
  j.absorb({ headers: new Headers({ "set-cookie": `eih_session=${createSession(userId, "vitest")}` }) });
  return j;
}

async function authedApi(port, path, { method = "GET", body, as } = {}) {
  const j = sessionJarFor(as.id);
  const res = await fetch(`http://127.0.0.1:${port}/api/feedback${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(j.header() ? { Cookie: j.header() } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

let adm, ua, ub;

function seedInsight(id = 101) {
  db.prepare("DELETE FROM insights WHERE id = ?").run(id);
  db.prepare(
    "INSERT INTO insights (id, title, summary, url, keywords, purpose, source_type) VALUES (?, '储能招标', 'S', 'https://a', '[\"储能\"]', '[\"tech\"]', 'rss')"
  ).run(id);
  return id;
}

const weightCount = () => db.prepare("SELECT COUNT(*) c FROM feedback_semantic_weights").get().c;

describe("/api/feedback — Task 12 角色分流", () => {
  beforeEach(() => {
    initDb();
    clearAuthTables();
    adm = insertTestUser({ unionid: "fadm", role: "admin" });
    ua = insertTestUser({ unionid: "fua" });
    ub = insertTestUser({ unionid: "fub" });
    db.prepare("DELETE FROM user_feedback").run();
    db.prepare("DELETE FROM feedback_rules_suggestions").run();
    db.prepare("DELETE FROM feedback_semantic_weights").run();
    db.prepare("DELETE FROM filter_rules WHERE name = '储能'").run();
  });

  afterAll(() => {
    clearAuthTables();
  });

  it("普通用户反馈：落 user_id、submit_state=none，且全局权重计数不变（FB-2/5）", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const id = seedInsight();
      const before = weightCount();
      const res = await authedApi(port, "/", { method: "POST", as: ua, body: { insightId: id, action: "hide", reason: "irrelevant" } });
      expect(res.status).toBe(200);
      const row = db.prepare("SELECT * FROM user_feedback WHERE id = ?").get(res.body.data.id);
      expect(row.user_id).toBe(ua.id);
      expect(row.submit_state).toBe("none");
      expect(weightCount()).toBe(before);
    } finally { await close(); }
  });

  it("管理员反馈：权重照旧更新（既有行为不回归）", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const id = seedInsight();
      const res = await authedApi(port, "/", { method: "POST", as: adm, body: { insightId: id, action: "hide", reason: "irrelevant" } });
      expect(res.status).toBe(200);
      expect(db.prepare("SELECT * FROM feedback_semantic_weights WHERE term='储能' AND action='suppress'").get()).toBeTruthy();
    } finally { await close(); }
  });

  it("提交审阅：生成 pending 建议（submitter_id 正确），admin 队列见昵称，user 只见自己的", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const id = seedInsight();
      // ua 先有一条反馈（提交入口会把最近一条置为 submitted）
      await authedApi(port, "/", { method: "POST", as: ua, body: { insightId: id, action: "hide", reason: "not_now" } });
      const res = await authedApi(port, `/${id}/submit`, { method: "POST", as: ua, body: { reason: "not_now", note: "重复招标" } });
      expect(res.status).toBe(201);
      expect(res.body.data.deduped).toBe(false);

      const sug = db.prepare("SELECT * FROM feedback_rules_suggestions WHERE id = ?").get(res.body.data.suggestionId);
      expect(sug.status).toBe("pending");
      expect(sug.submitter_id).toBe(ua.id);
      expect(sug.type).toBe("exclude_keyword");
      expect(sug.name).toBe("储能");
      expect(sug.purpose).toBe("tech");
      expect(sug.evidence).toBe("重复招标");
      const fb = db.prepare("SELECT submit_state FROM user_feedback WHERE insight_id=? AND user_id=?").get(id, ua.id);
      expect(fb.submit_state).toBe("submitted");

      // admin 全量 + 昵称
      const adminList = await authedApi(port, "/suggestions", { as: adm });
      const mine = adminList.body.data.find((s) => s.id === sug.id);
      expect(mine.submitter_nickname).toBe(ua.nickname);

      // ub 看不到 ua 提交的
      const bList = await authedApi(port, "/suggestions", { as: ub });
      expect(bList.body.data.map((s) => s.id)).not.toContain(sug.id);
      // ua 看得到自己的（无昵称列也行）
      const aList = await authedApi(port, "/suggestions", { as: ua });
      expect(aList.body.data.map((s) => s.id)).toContain(sug.id);
    } finally { await close(); }
  });

  it("去重：同 type+name+purpose 已有 pending 建议时不再入队", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const id = seedInsight();
      const r1 = await authedApi(port, `/${id}/submit`, { method: "POST", as: ua, body: { reason: "duplicate" } });
      const r2 = await authedApi(port, `/${id}/submit`, { method: "POST", as: ub, body: { reason: "irrelevant" } });
      expect(r1.body.data.deduped).toBe(false);
      expect(r2.body.data.deduped).toBe(true);
      expect(r2.body.data.suggestionId).toBe(r1.body.data.suggestionId);
      expect(db.prepare("SELECT COUNT(*) c FROM feedback_rules_suggestions").get().c).toBe(1);
    } finally { await close(); }
  });

  it("🔴 安全修复：普通用户 accept/reject/generate → 403，admin accept → 200 且 filter_rules 生效、状态机闭环", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const id = seedInsight();
      await authedApi(port, "/", { method: "POST", as: ua, body: { insightId: id, action: "hide", reason: "not_now" } });
      const sub = await authedApi(port, `/${id}/submit`, { method: "POST", as: ua, body: { reason: "not_now" } });
      const sid = sub.body.data.suggestionId;

      expect((await authedApi(port, `/suggestions/${sid}/accept`, { method: "POST", as: ua })).status).toBe(403);
      expect((await authedApi(port, `/suggestions/${sid}/reject`, { method: "POST", as: ua })).status).toBe(403);
      expect((await authedApi(port, "/generate-suggestions", { method: "POST", as: ua })).status).toBe(403);
      // 403 后全局规则里什么都没有（修复前这里会被注入）
      expect(db.prepare("SELECT COUNT(*) c FROM filter_rules WHERE name='储能'").get().c).toBe(0);

      const ok = await authedApi(port, `/suggestions/${sid}/accept`, { method: "POST", as: adm });
      expect(ok.status).toBe(200);
      expect(db.prepare("SELECT COUNT(*) c FROM filter_rules WHERE name='储能' AND type='exclude_keyword'").get().c).toBe(1);
      expect(db.prepare("SELECT status FROM feedback_rules_suggestions WHERE id=?").get(sid).status).toBe("accepted");
      const fb = db.prepare("SELECT submit_state FROM user_feedback WHERE insight_id=? AND user_id=?").get(id, ua.id);
      expect(fb.submit_state).toBe("accepted");
    } finally { await close(); }
  });

  it("submit 对不存在的卡片 → 404；reject 不存在的建议 → 404", async () => {
    const { port, close } = await listen(buildApp());
    try {
      expect((await authedApi(port, "/99999/submit", { method: "POST", as: ua, body: {} })).status).toBe(404);
      expect((await authedApi(port, "/suggestions/99999/reject", { method: "POST", as: adm })).status).toBe(404);
    } finally { await close(); }
  });
});
