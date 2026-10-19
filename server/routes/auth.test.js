import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import db from "../db.js";
import authRouter, { __resetInviteLimiter } from "./auth.js";
import { clearAuthTables, insertTestUser, listen, makeCookieJar } from "../testUtils.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  return app;
}

// 模块级 cookie jar：同一用例的所有请求共享（模拟浏览器），全程携带并吸收 Set-Cookie
let jar;

async function api(port, path, { method = "POST", body } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(jar.header() ? { Cookie: jar.header() } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual"
  });
  jar.absorb(res); // 关键：register/登录写入的 session cookie 必须被捕获，否则 /me 会假失败
  return { status: res.status, location: res.headers.get("location"), body: await res.json().catch(() => null) };
}

// 本文件会按用例改写 AUTH_DEV_MODE / NODE_ENV / ADMIN_UNIONID，所以必须成对快照-还原：
// 少了还原，上一个用例设的 ADMIN_UNIONID 会让下一个用例的「普通用户」静默变成 seed admin。
const ENV_KEYS = ["AUTH_DEV_MODE", "NODE_ENV", "ADMIN_UNIONID"];
let envSnapshot = [];

describe("auth flow (mock mode)", () => {
  beforeEach(() => {
    envSnapshot = ENV_KEYS.map((k) => [k, process.env[k]]);
    process.env.AUTH_DEV_MODE = "wechat-mock";
    process.env.NODE_ENV = "test";
    delete process.env.ADMIN_UNIONID;
    // 限速桶是模块级内存状态，不清就会跨用例累积，让后面的用例撞上假 429
    __resetInviteLimiter();
    clearAuthTables();
    jar = makeCookieJar();
  });

  afterEach(() => {
    for (const [k, v] of envSnapshot) {
      // 未设置的键必须 delete：process.env[k] = undefined 会写入字面量字符串 "undefined"
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it("new identity -> dev-login returns need_invite ticket; register with valid code creates user + session", async () => {
    const { port, close } = await listen(buildApp());
    try {
      db.prepare(`INSERT INTO invite_codes (code, label, role) VALUES ('TEAM01', 'team', 'user')`).run();
      const r1 = await api(port, "/api/auth/dev-login", { body: { devUnionid: "u-new" } });
      expect(r1.body.data.status).toBe("need_invite");
      const ticket = r1.body.data.ticket;
      const r2 = await api(port, "/api/auth/register", { body: { ticket, code: "TEAM01" } });
      expect(r2.status).toBe(200);
      expect(r2.body.data.user.role).toBe("user");
      const me = await api(port, "/api/auth/me", { method: "GET" });
      expect(me.body.data.user.unionid).toBe("u-new");
      // 二次登录免邀请码（AUTH-4）
      const r3 = await api(port, "/api/auth/dev-login", { body: { devUnionid: "u-new" } });
      expect(r3.body.data.status).toBe("active");
      // 邀请码计数 +1
      expect(db.prepare("SELECT used_count FROM invite_codes WHERE code='TEAM01'").get().used_count).toBe(1);
    } finally { await close(); }
  });

  it("register rejects wrong/expired/exhausted codes with 400 and leaves the ticket reusable", async () => {
    const { port, close } = await listen(buildApp());
    try {
      db.prepare(`INSERT INTO invite_codes (code, role, max_uses, used_count) VALUES ('FULL01','user',1,1)`).run();
      // expires_at 的比较与写入都走 SQL 侧 datetime()：JS 的 ISO 串带 T/Z，
      // 与 CURRENT_TIMESTAMP 的 'YYYY-MM-DD HH:MM:SS' 做 TEXT 比较会跨日静默出错
      db.prepare(`INSERT INTO invite_codes (code, role, expires_at) VALUES ('OLD01','user', datetime('now','-1 day'))`).run();
      db.prepare(`INSERT INTO invite_codes (code, role) VALUES ('TEAM02','user')`).run();

      const r1 = await api(port, "/api/auth/dev-login", { body: { devUnionid: "u2" } });
      const ticket = r1.body.data.ticket;

      const wrong = await api(port, "/api/auth/register", { body: { ticket, code: "NOPE" } });
      expect(wrong.status).toBe(400);
      expect(wrong.body.error).toMatch(/invite/i);

      const expired = await api(port, "/api/auth/register", { body: { ticket, code: "OLD01" } });
      expect(expired.status).toBe(400);
      expect(expired.body.error).toMatch(/expired/i);

      const full = await api(port, "/api/auth/register", { body: { ticket, code: "FULL01" } });
      expect(full.status).toBe(400);
      expect(full.body.error).toMatch(/invite/i);

      // 失败的开通尝试不烧票据：只是敲错邀请码的用户不该被迫重新扫码登录。
      // 暴力枚举的防线是 5 次/分钟限速 + 票据自身 10 分钟过期。
      const ok = await api(port, "/api/auth/register", { body: { ticket, code: "TEAM02" } });
      expect(ok.status).toBe(200);
      expect(ok.body.data.user.unionid).toBe("u2");
    } finally { await close(); }
  });

  it("ADMIN_UNIONID seeds admin without invite code; disabled user blocked", async () => {
    const { port, close } = await listen(buildApp());
    try {
      process.env.ADMIN_UNIONID = "boss-001";
      const r = await api(port, "/api/auth/dev-login", { body: { devUnionid: "boss-001" } });
      expect(r.body.data.status).toBe("active");
      expect(db.prepare("SELECT role FROM users WHERE unionid='boss-001'").get().role).toBe("admin");
      insertTestUser({ unionid: "u-off", status: "disabled" });
      const r2 = await api(port, "/api/auth/dev-login", { body: { devUnionid: "u-off" } });
      expect(r2.body.data.status).toBe("disabled");
    } finally { await close(); }
  });

  it("logout clears session; me 401 afterwards", async () => {
    const { port, close } = await listen(buildApp());
    try {
      process.env.ADMIN_UNIONID = "u3"; // seed admin → 直接进系统（免邀请码）
      const login = await api(port, "/api/auth/dev-login", { body: { devUnionid: "u3" } });
      expect(login.body.data.status).toBe("active");
      expect((await api(port, "/api/auth/me", { method: "GET" })).status).toBe(200);
      const out = await api(port, "/api/auth/logout", {});
      expect(out.status).toBe(200);
      expect(out.body).toEqual({ success: true });
      expect((await api(port, "/api/auth/me", { method: "GET" })).status).toBe(401);
    } finally { await close(); }
  });

  it("invite limiter allows 5 register attempts per minute and 429s the 6th", async () => {
    const { port, close } = await listen(buildApp());
    try {
      for (let i = 1; i <= 5; i += 1) {
        const r = await api(port, "/api/auth/register", { body: { ticket: "nope", code: "nope" } });
        expect(r.status, `第 ${i} 次应当走到票据校验而不是被限速`).not.toBe(429);
        expect(r.status).toBe(400);
        expect(r.body.error).toBe("invalid or expired ticket");
      }
      const sixth = await api(port, "/api/auth/register", { body: { ticket: "nope", code: "nope" } });
      expect(sixth.status).toBe(429);
      expect(sixth.body.error).toMatch(/too many/i);
    } finally { await close(); }
  });
});
