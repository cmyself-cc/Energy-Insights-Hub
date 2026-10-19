import crypto from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

// 真 fetch 必须在任何 vi.stubGlobal 之前捕获：桩只负责拦微信上游，测试客户端打到本地服务的
// 请求仍要放行给真 fetch，否则 api() 会被自己装的桩吃掉。
const realFetch = globalThis.fetch;

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

const isTokenCall = (url) => String(url).includes("/sns/oauth2/access_token");

// 微信 token 载荷由用例改写、fetch 桩在调用时读取：GET 回调没有携带 unionid 的入参，
// 「这次回跳带回的是谁」只能由桩决定。
let tokenBody = null;

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

// 本文件会按用例改写 AUTH_DEV_MODE / NODE_ENV / ADMIN_UNIONID / 微信凭证，所以必须成对快照-还原：
// 少了还原，上一个用例设的 ADMIN_UNIONID 会让下一个用例的「普通用户」静默变成 seed admin，
// 而泄漏的 WECHAT_APP_ID 会让本该走 mock 的用例走进真实微信分支。
const ENV_KEYS = ["AUTH_DEV_MODE", "NODE_ENV", "ADMIN_UNIONID", "WECHAT_APP_ID", "WECHAT_APP_SECRET"];
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
    // 即便本 describe 不装桩也要复位：fetch 桩一旦泄漏到后续用例，真 HTTP 请求会被静默吃掉
    vi.unstubAllGlobals();
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
      expect(out.body).toEqual({ data: { success: true } });
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

// GET /api/auth/wechat/callback 的三条 302 分支（handleIdentity 的 json:false 路径）在 mock
// 模式下不可达：mock 分支只认 devUnionid、忽略 code。所以这里走真实微信分支——只桩掉打向
// 微信上游的 fetch，HTTP 请求本身、SQLite、cookie 往返全是真的。
describe("wechat callback redirects (real wechat branch, stubbed upstream fetch)", () => {
  const APPID = "wx_appid_test";
  const SECRET = "super_secret_do_not_leak";
  // describe 作用域持有桩：用例要断言它打向微信上游的调用次数（token + userinfo 各一次）
  let fetchStub;

  beforeEach(() => {
    envSnapshot = ENV_KEYS.map((k) => [k, process.env[k]]);
    // 必须非 mock：否则 exchangeIdentity({code}) 会短路进 mock 分支，测到错的代码
    delete process.env.AUTH_DEV_MODE;
    process.env.NODE_ENV = "test";
    // 必须清掉：否则新身份可能撞上 ADMIN_UNIONID 被 seed 成 admin，测不到 need_invite 分支
    delete process.env.ADMIN_UNIONID;
    process.env.WECHAT_APP_ID = APPID;
    process.env.WECHAT_APP_SECRET = SECRET;
    __resetInviteLimiter();
    clearAuthTables();
    jar = makeCookieJar();
    tokenBody = null;
    fetchStub = vi.fn(async (url, init) => {
      const u = String(url);
      // 放行测试客户端自己打到本地服务的请求，只拦微信上游
      if (u.startsWith("http://127.0.0.1:")) return realFetch(url, init);
      return isTokenCall(u)
        ? jsonResponse(tokenBody)
        : jsonResponse({ nickname: "张三", headimgurl: "https://wx.example/a.png" });
    });
    vi.stubGlobal("fetch", fetchStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of envSnapshot) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it("already-registered active user is logged in and redirected to /", async () => {
    const { port, close } = await listen(buildApp());
    try {
      insertTestUser({ unionid: "wx-active" });
      tokenBody = { access_token: "at_1", openid: "op_1", unionid: "wx-active" };
      const r = await api(port, "/api/auth/wechat/callback?code=c1", { method: "GET" });
      expect(r.status).toBe(302);
      expect(r.location).toBe("/");
      // 302 之前必须已经写好 session cookie，否则浏览器跳回首页仍是未登录态
      const me = await api(port, "/api/auth/me", { method: "GET" });
      expect(me.status).toBe(200);
      expect(me.body.data.user.unionid).toBe("wx-active");
    } finally { await close(); }
  });

  it("unknown identity is redirected to /login#invite=<ticket> with a pending row", async () => {
    const { port, close } = await listen(buildApp());
    try {
      tokenBody = { access_token: "at_1", openid: "op_new", unionid: "wx-new" };
      const r = await api(port, "/api/auth/wechat/callback?code=c1", { method: "GET" });
      expect(r.status).toBe(302);
      // 票据是 crypto.randomBytes(32).toString("hex")，即 64 位十六进制
      expect(r.location).toMatch(/^\/login#invite=[0-9a-f]{64}$/);
      const ticket = r.location.slice("/login#invite=".length);
      const tokenHash = crypto.createHash("sha256").update(ticket).digest("hex");
      const pending = db.prepare("SELECT * FROM pending_identities WHERE token_hash = ?").get(tokenHash);
      // 库里只存 sha256：明文票据一旦入库，读到库就等于能劫持这个待开通身份
      expect(pending, "pending_identities 里找不到 sha256(ticket) 对应的行").toBeTruthy();
      expect(pending.unionid).toBe("wx-new");
      // 桩里的资料经 identityProvider 的 userinfo 分支流进 issuePending 的 INSERT，这一段别处
      // 没有任何断言：两个绑定参数写反了也不会有人发现，所以在这里钉死
      expect(pending.nickname).toBe("张三");
      expect(pending.avatar_url).toBe("https://wx.example/a.png");
      // 桩是全局 fetch，测试客户端自己打到 127.0.0.1 的请求也会经过它，所以只数打向微信上游的：
      // 一次 token + 一次 userinfo（后者证明资料分支确实被走过，nickname/avatar 不是兜底值）
      const wxCalls = fetchStub.mock.calls.map(([u]) => String(u)).filter((u) => !u.startsWith("http://127.0.0.1:"));
      expect(wxCalls).toHaveLength(2);
      expect(wxCalls.filter((u) => isTokenCall(u))).toHaveLength(1);
      // 未开通的身份拿不到可用会话：need_invite 分支只发票据，不得顺手把人登进去
      expect((await api(port, "/api/auth/me", { method: "GET" })).status).toBe(401);
    } finally { await close(); }
  });

  it("disabled user is redirected to /login#disabled", async () => {
    const { port, close } = await listen(buildApp());
    try {
      insertTestUser({ unionid: "wx-off", status: "disabled" });
      tokenBody = { access_token: "at_1", openid: "op_1", unionid: "wx-off" };
      const r = await api(port, "/api/auth/wechat/callback?code=c1", { method: "GET" });
      expect(r.status).toBe(302);
      expect(r.location).toBe("/login#disabled");
      // 禁用用户拿不到「可用」会话。这条钉的是 HTTP 边界：就算有人把 loginExisting 挪到 status
      // 检查之前真的发了 cookie，resolveSession 也会因 status!=='active' 拒绝解析、这里仍是 401，
      // 所以它抓不住「发了但不可用」的会话——那需要断言 sessions 表不得新增行。
      expect((await api(port, "/api/auth/me", { method: "GET" })).status).toBe(401);
    } finally { await close(); }
  });
});
