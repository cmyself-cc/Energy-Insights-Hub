import { describe, it, expect, beforeEach, afterAll } from "vitest";
import express from "express";
import { requireAuth, requireAdmin, SESSION_COOKIE } from "./authMiddleware.js";
import { createSession } from "./sessions.js";
import { insertTestUser, clearAuthTables, listen } from "../testUtils.js";

function buildApp() {
  const app = express();
  app.get("/api/open", (_req, res) => res.json({ data: "ok" }));
  app.get("/api/locked", requireAuth, (req, res) => res.json({ data: req.user.unionid }));
  app.post("/api/admin-only", requireAuth, requireAdmin, (_req, res) => res.json({ data: "done" }));
  return app;
}

async function call(port, path, cookie, method = "GET") {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: cookie ? { Cookie: `${SESSION_COOKIE}=${cookie}` } : {}
  });
  return { status: res.status, body: await res.json() };
}

describe("auth middleware", () => {
  beforeEach(() => { clearAuthTables(); });

  // 文件级清理（R2 规则：凡是写 auth 表的测试文件都要带这个钩子）。
  // beforeEach 管不到文件跑完之后：最后一个用例（requireAdmin 403）建了 u2 并给它铸了一条
  // session，两者都没清，所以本文件单跑会留 users=1 + sessions=1。实测过：加这个钩子之前
  // `npx vitest run server/lib/authMiddleware.test.js` 留下 users=1(u2) / sessions=1，之后全 0。
  // 残留的 session 行比残留的 user 行更糟：它是一个**仍然能解析的活会话**，
  // 后续任何直接读 sessions 表的断言都可能被它影响。
  // initDb() 的耦合顾虑在这里不成立：本文件的 beforeEach 早就在调 clearAuthTables() 了。
  afterAll(() => { clearAuthTables(); });

  it("401 without cookie, 200 with valid session", async () => {
    const { port, close } = await listen(buildApp());
    try {
      expect((await call(port, "/api/locked")).status).toBe(401);
      const u = insertTestUser({ unionid: "u1" });
      const token = createSession(u.id, "");
      const r = await call(port, "/api/locked", token);
      expect(r.status).toBe(200);
      expect(r.body.data).toBe("u1");
    } finally { await close(); }
  });

  it("malformed cookie value yields 401 JSON, never a 500", async () => {
    const { port, close } = await listen(buildApp());
    try {
      for (const bad of ["%", "%zz", "%E0%A4%A"]) {
        // call() would throw on Express's HTML error page; read the raw body so a
        // 500 shows up as an assertion failure instead of a JSON parse error.
        const res = await fetch(`http://127.0.0.1:${port}/api/locked`, {
          headers: { Cookie: `${SESSION_COOKIE}=${bad}` }
        });
        const text = await res.text();
        expect(res.status, `cookie="${bad}" body=${text.slice(0, 120)}`).toBe(401);
        expect(res.headers.get("content-type")).toContain("application/json");
        expect(JSON.parse(text)).toEqual({ error: "unauthorized" });
      }
    } finally { await close(); }
  });

  it("requireAdmin blocks user role with 403", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const u = insertTestUser({ unionid: "u2", role: "user" });
      const token = createSession(u.id, "");
      const r = await call(port, "/api/admin-only", token, "POST");
      expect(r.status).toBe(403);
    } finally { await close(); }
  });
});
