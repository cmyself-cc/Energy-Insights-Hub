import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import express from "express";
import db, { initDb } from "../db.js";
import reportRouter from "./reports.js";
import { requireAuth } from "../lib/authMiddleware.js";
import { createSession } from "../lib/sessions.js";
import { clearAuthTables, insertTestUser, listen, makeCookieJar } from "../testUtils.js";
import { listTemplates, seedReportTemplates } from "../services/reportTemplateService.js";
import { screenCards } from "../services/reportScreening.js";
import { createReportJob, getJob, retryJob } from "../services/reportGenerator.js";

vi.mock("../services/reportScreening.js", () => ({ screenCards: vi.fn(), clarifyCards: vi.fn(), generateManualPrompt: vi.fn() }));
vi.mock("../services/reportGenerator.js", () => ({
  createReportJob: vi.fn(), getJob: vi.fn(), listJobs: vi.fn(), retryJob: vi.fn(),
  startJobRunner: vi.fn(), processQueue: vi.fn(() => Promise.resolve())
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/reports", requireAuth, reportRouter);
  return app;
}

// 造一个已登录的 jar：库里只存 sha256，cookie 里带明文 token（views.test.js 同款模式）
function sessionJarFor(userId) {
  const j = makeCookieJar();
  j.absorb({ headers: new Headers({ "set-cookie": `eih_session=${createSession(userId, "vitest")}` }) });
  return j;
}

async function authedApi(port, path, { method = "GET", body, as } = {}) {
  const j = sessionJarFor(as.id);
  const res = await fetch(`http://127.0.0.1:${port}/api/reports${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(j.header() ? { Cookie: j.header() } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

let adm, ua, ub;

describe("reports routes", () => {
  beforeEach(() => {
    initDb();
    clearAuthTables();
    adm = insertTestUser({ unionid: "radm", role: "admin" });
    ua = insertTestUser({ unionid: "rstd-a" });
    ub = insertTestUser({ unionid: "rstd-b" });
    db.prepare("DELETE FROM report_templates").run();
    db.prepare("DELETE FROM report_jobs").run();
    db.prepare("DELETE FROM reports").run();
    seedReportTemplates();
    screenCards.mockReset();
    createReportJob.mockReset();
  });

  afterAll(() => {
    clearAuthTables();
  });

  it("lists seeded public templates", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const { status, body } = await authedApi(port, "/templates", { as: ua });
      expect(status).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(3);
      expect(body.data[0].is_public).toBe(true);
    } finally { await close(); }
  });

  it("forces a normal user's new template to be private and owned by them", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const { status, body } = await authedApi(port, "/templates", {
        method: "POST", as: ua, body: { name: "自定义", prompt: "写报告", is_public: 1 }
      });
      expect(status).toBe(201);
      expect(body.data.name).toBe("自定义");
      expect(body.data.is_public).toBe(false);   // user 即使传了 is_public:1 也被强制为 0
      expect(body.data.owner_id).toBe(ua.id);
    } finally { await close(); }
  });

  it("lets an admin create a public template", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const { status, body } = await authedApi(port, "/templates", {
        method: "POST", as: adm, body: { name: "团队公共", prompt: "写报告", is_public: 1 }
      });
      expect(status).toBe(201);
      expect(body.data.is_public).toBe(true);
      expect(body.data.owner_id).toBe(adm.id);
    } finally { await close(); }
  });

  it("rejects a normal user deleting a public template (403) but lets an admin (200)", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const first = listTemplates()[0];
      expect(first.is_public).toBe(true);
      expect((await authedApi(port, `/templates/${first.id}`, { method: "DELETE", as: ua })).status).toBe(403);
      expect((await authedApi(port, `/templates/${first.id}`, { method: "DELETE", as: adm })).status).toBe(200);
    } finally { await close(); }
  });

  it("runs screening and returns the plan", async () => {
    const { port, close } = await listen(buildApp());
    try {
      db.prepare("DELETE FROM insights WHERE id=11").run();
      db.prepare("INSERT INTO insights (id, title, summary, url, keywords) VALUES (11, 'T', 'S', 'https://a', 'k')").run();
      screenCards.mockResolvedValue({ questions: [], searchPlan: [], purpose: "日报", exceedsLimit: false });
      const { status, body } = await authedApi(port, "/screening", {
        method: "POST", as: ua, body: { templateId: listTemplates()[0].id, insightIds: [11] }
      });
      expect(status).toBe(200);
      expect(body.data.purpose).toBe("日报");
    } finally { await close(); }
  });

  it("404s screening with a template the user cannot see", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const priv = await authedApi(port, "/templates", {
        method: "POST", as: adm, body: { name: "私有", prompt: "p", is_public: 0 }
      });
      expect(priv.status).toBe(201);
      db.prepare("DELETE FROM insights WHERE id=11").run();
      db.prepare("INSERT INTO insights (id, title, summary, url, keywords) VALUES (11, 'T', 'S', 'https://a', 'k')").run();
      const res = await authedApi(port, "/screening", {
        method: "POST", as: ua, body: { templateId: priv.body.data.id, insightIds: [11] }
      });
      expect(res.status).toBe(404);
    } finally { await close(); }
  });

  it("runs clarify and returns resolutions", async () => {
    const { port, close } = await listen(buildApp());
    try {
      db.prepare("DELETE FROM insights WHERE id=11").run();
      db.prepare("INSERT INTO insights (id, title, summary, url, keywords) VALUES (11, 'T', 'S', 'https://a', 'k')").run();
      const { clarifyCards: mockClarify } = await import("../services/reportScreening.js");
      mockClarify.mockResolvedValue({ questions: [], resolutions: [{ key: "q1", issue: "x", choice: "y", cardIds: [11] }], purpose: "日报", done: true });
      const { status, body } = await authedApi(port, "/clarify", {
        method: "POST", as: ua, body: { templateId: listTemplates()[0].id, insightIds: [11], answers: [] }
      });
      expect(status).toBe(200);
      expect(body.data.done).toBe(true);
      expect(body.data.resolutions).toHaveLength(1);
    } finally { await close(); }
  });

  it("rejects screening without insightIds", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const { status } = await authedApi(port, "/screening", { method: "POST", as: ua, body: { templateId: 1, insightIds: [] } });
      expect(status).toBe(400);
    } finally { await close(); }
  });

  it("creates a generation job stamped with the caller's ownerId", async () => {
    const { port, close } = await listen(buildApp());
    try {
      createReportJob.mockReturnValue({ id: 99, status: "queued", report_id: 1 });
      const { status, body } = await authedApi(port, "/generate", {
        method: "POST", as: ua, body: { templateId: listTemplates()[0].id, insightIds: [11], resolutions: [] }
      });
      expect(status).toBe(201);
      expect(body.data.id).toBe(99);
      expect(createReportJob).toHaveBeenCalledWith(expect.objectContaining({ ownerId: ua.id }));
    } finally { await close(); }
  });

  it("404s generation with a template the user cannot see and never reaches the service", async () => {
    const { port, close } = await listen(buildApp());
    try {
      createReportJob.mockClear();
      const priv = await authedApi(port, "/templates", {
        method: "POST", as: adm, body: { name: "私有2", prompt: "p", is_public: 0 }
      });
      const res = await authedApi(port, "/generate", {
        method: "POST", as: ua, body: { templateId: priv.body.data.id, insightIds: [11] }
      });
      expect(res.status).toBe(404);
      expect(createReportJob).not.toHaveBeenCalled();
    } finally { await close(); }
  });

  it("returns job status and retries", async () => {
    const { port, close } = await listen(buildApp());
    try {
      getJob.mockReturnValue({ id: 1, status: "done" });
      retryJob.mockReturnValue({ id: 1, status: "queued" });
      expect((await authedApi(port, "/jobs/1", { as: ua })).body.data.status).toBe("done");
      expect((await authedApi(port, "/jobs/1/retry", { method: "POST", as: ua })).body.data.status).toBe("queued");
    } finally { await close(); }
  });

  it("edits a report title and content", async () => {
    const { port, close } = await listen(buildApp());
    try {
      db.prepare("DELETE FROM reports").run();
      const result = db.prepare("INSERT INTO reports (title, content, status, owner_id) VALUES ('旧标题', '旧内容', 'done', ?)").run(adm.id);
      const { status, body } = await authedApi(port, `/${result.lastInsertRowid}`, {
        method: "PUT", as: adm, body: { title: "新标题", content: "新内容" }
      });
      expect(status).toBe(200);
      expect(body.data.title).toBe("新标题");
      expect(body.data.content).toBe("新内容");
    } finally { await close(); }
  });

  it("generate-prompt returns a prompt", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const { generateManualPrompt: mockGp } = await import("../services/reportScreening.js");
      mockGp.mockResolvedValue({ prompt: "生成提示词", generated: true });
      const { status, body } = await authedApi(port, "/generate-prompt", {
        method: "POST", as: ua, body: { topic: "储能", language: "zh" }
      });
      expect(status).toBe(200);
      expect(body.data.prompt).toBe("生成提示词");
    } finally { await close(); }
  });
});

describe("reports ownership isolation (M2)", () => {
  beforeEach(() => {
    initDb();
    clearAuthTables();
    adm = insertTestUser({ unionid: "radm", role: "admin" });
    ua = insertTestUser({ unionid: "rstd-a" });
    ub = insertTestUser({ unionid: "rstd-b" });
    db.prepare("DELETE FROM report_templates").run();
    db.prepare("DELETE FROM report_jobs").run();
    db.prepare("DELETE FROM reports").run();
    seedReportTemplates();
    screenCards.mockReset();
    createReportJob.mockReset();
  });

  afterAll(() => {
    clearAuthTables();
  });

  it("owner-scoped list: A sees own, B does not, admin scope=all sees everything with owner_nickname", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const created = await authedApi(port, "/", { method: "POST", as: ua, body: { title: "A 的报告", content: "c" } });
      expect(created.status).toBe(201);
      expect(created.body.data.owner_id).toBe(ua.id);

      const aList = await authedApi(port, "/", { as: ua });
      expect(aList.body.data.map((r) => r.id)).toContain(created.body.data.id);

      const bList = await authedApi(port, "/", { as: ub });
      expect(bList.body.data.map((r) => r.id)).not.toContain(created.body.data.id);

      const all = await authedApi(port, "/?scope=all", { as: adm });
      const mine = all.body.data.find((r) => r.id === created.body.data.id);
      expect(mine).toBeTruthy();
      expect(mine.owner_nickname).toBe(ua.nickname);

      // 非 admin 传 scope=all 无效：仍只看自己的
      const bAll = await authedApi(port, "/?scope=all", { as: ub });
      expect(bAll.body.data.map((r) => r.id)).not.toContain(created.body.data.id);
    } finally { await close(); }
  });

  it("non-owner reads/writes/deletes another user's report as 404 (existence not leaked)", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const created = await authedApi(port, "/", { method: "POST", as: ua, body: { title: "A 的私有", content: "c" } });
      const id = created.body.data.id;

      expect((await authedApi(port, `/${id}`, { as: ub })).status).toBe(404);
      expect((await authedApi(port, `/${id}`, { method: "PUT", as: ub, body: { title: "抢", content: "抢" } })).status).toBe(404);
      expect((await authedApi(port, `/${id}`, { method: "DELETE", as: ub })).status).toBe(404);
      expect(db.prepare("SELECT COUNT(*) c FROM reports WHERE id=?").get(id).c).toBe(1);

      // owner 本人可读写删
      expect((await authedApi(port, `/${id}`, { as: ua })).status).toBe(200);
    } finally { await close(); }
  });

  it("private templates: invisible and unwritable to non-owners", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const priv = await authedApi(port, "/templates", { method: "POST", as: ua, body: { name: "A 私有", prompt: "p" } });
      const id = priv.body.data.id;

      // B 的列表里看不见
      const bList = await authedApi(port, "/templates", { as: ub });
      expect(bList.body.data.map((t) => t.id)).not.toContain(id);
      // A 的列表里看得见
      const aList = await authedApi(port, "/templates", { as: ua });
      expect(aList.body.data.map((t) => t.id)).toContain(id);

      expect((await authedApi(port, `/templates/${id}`, { method: "PUT", as: ub, body: { name: "抢" } })).status).toBe(404);
      expect((await authedApi(port, `/templates/${id}`, { method: "DELETE", as: ub })).status).toBe(404);
    } finally { await close(); }
  });

  it("duplicate: copy a public template into my own private one; invisible source 404s", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const pub = listTemplates().find((t) => t.is_public);
      const copy = await authedApi(port, `/templates/${pub.id}/duplicate`, { method: "POST", as: ub });
      expect(copy.status).toBe(201);
      expect(copy.body.data.owner_id).toBe(ub.id);
      expect(copy.body.data.is_public).toBe(false);
      expect(copy.body.data.name).toContain("副本");

      // 别人的私有模板不可见 → 404
      const priv = await authedApi(port, "/templates", { method: "POST", as: ua, body: { name: "A 私有", prompt: "p" } });
      expect((await authedApi(port, `/templates/${priv.body.data.id}/duplicate`, { method: "POST", as: ub })).status).toBe(404);
      // 不存在的 id 也是 404（同一语义）
      expect((await authedApi(port, "/templates/99999/duplicate", { method: "POST", as: ub })).status).toBe(404);
    } finally { await close(); }
  });
});
