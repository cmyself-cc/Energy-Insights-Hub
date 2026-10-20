import crypto from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
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

// 微信回跳的 state 与浏览器绑定（一次性 HttpOnly cookie，见 server/routes/auth.js）。
// 直接打 /wechat/callback 而不先走 /config，等于在模拟「攻击者伪造链接」——那一形态已由
// 下面的 oauth state binding 那一组专门覆盖，所以这里的正常流程用例要先握手拿到自己的 state。
// 测试客户端不是浏览器，HttpOnly 对它无效，因此能从 Set-Cookie 里把 state 读出来再回传。
const OAUTH_STATE_COOKIE = "eih_oauth_state";

async function oauthState(port) {
  const res = await fetch(`http://127.0.0.1:${port}/api/auth/config`, {
    headers: jar.header() ? { Cookie: jar.header() } : {}
  });
  await res.json().catch(() => null);
  jar.absorb(res);
  return jar.cookies[OAUTH_STATE_COOKIE];
}

// 本文件会按用例改写 AUTH_DEV_MODE / NODE_ENV / ADMIN_UNIONID / 微信凭证，所以必须成对快照-还原：
// 少了还原，上一个用例设的 ADMIN_UNIONID 会让下一个用例的「普通用户」静默变成 seed admin，
// 而泄漏的 WECHAT_APP_ID 会让本该走 mock 的用例走进真实微信分支。
// WECHAT_REDIRECT_URI 也在列：它决定 getAuthorizeUrl 返回 null 还是真 URL，泄漏出去会让
// 「未配置」分支的用例假绿。
const ENV_KEYS = ["AUTH_DEV_MODE", "NODE_ENV", "ADMIN_UNIONID", "WECHAT_APP_ID", "WECHAT_APP_SECRET", "WECHAT_REDIRECT_URI"];
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
      const state = await oauthState(port);
      const r = await api(port, `/api/auth/wechat/callback?code=c1&state=${state}`, { method: "GET" });
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
      const state = await oauthState(port);
      const r = await api(port, `/api/auth/wechat/callback?code=c1&state=${state}`, { method: "GET" });
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
      // need_invite 分支只发票据，一行会话都不许写：待开通的人此刻还没通过邀请码校验，
      // 给它建 session 等于让「持有票据」和「已登录」两件事混为一谈。
      // 这条同时钉住了 state cookie 的一次性：握手时 jar 里有过 eih_oauth_state，
      // 回跳之后必须被清干净，所以「一个 cookie 都不许留」是比「没有 session cookie」更强的断言。
      expect(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n).toBe(0);
      expect(jar.cookies).toEqual({});
      expect((await api(port, "/api/auth/me", { method: "GET" })).status).toBe(401);
    } finally { await close(); }
  });

  it("disabled user is redirected to /login#disabled", async () => {
    const { port, close } = await listen(buildApp());
    try {
      insertTestUser({ unionid: "wx-off", status: "disabled" });
      tokenBody = { access_token: "at_1", openid: "op_1", unionid: "wx-off" };
      const state = await oauthState(port);
      const r = await api(port, `/api/auth/wechat/callback?code=c1&state=${state}`, { method: "GET" });
      expect(r.status).toBe(302);
      expect(r.location).toBe("/login#disabled");
      // 禁用用户「不得被发出会话」，而不只是「发出的会话不可用」。两者不等价：
      // resolveSession（server/lib/sessions.js:23）会因 status!=='active' 拒绝解析，所以就算有人把
      // loginExisting 挪到 status 检查之前真的发了 cookie，下面那条 /me 401 依然通过（控制器已亲手
      // 变异验证：该变异下 8/8 全绿，而 sessions 表确实多了一行、响应确实带 Set-Cookie）。
      // 残留行不会因 disabled 被删（只有 expired 才删），所以一旦管理员把用户改回 active，这张在
      // 禁用期间发出的 cookie 立刻生效——免登录静默复活。必须钉死源头：一行都不许写。
      expect(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n).toBe(0);
      expect(jar.cookies).toEqual({});
      expect((await api(port, "/api/auth/me", { method: "GET" })).status).toBe(401);
    } finally { await close(); }
  });
});

// —— D1：微信 OAuth 的 state 必须与「将要收到回跳的那个浏览器」绑定 ——
//
// 修复前的缺陷：/config 铸出的 state 只写进 authorizeUrl，GET /wechat/callback 从不读
// req.query.state。攻击者用自己的微信账号取得合法 code，诱使受害者访问
// /api/auth/wechat/callback?code=<攻击者的code> —— 受害者浏览器被写下**攻击者账号**的
// session cookie，此后保存的视角/反馈全部落进攻击者可读的账号（login CSRF / 会话固定）。
//
// 无状态 HMAC 修不了它：/config 匿名可达，攻击者随时能给自己领一个签名合法的 state，
// 塞进伪造链接照样通过校验。真正的防御要求 state 与浏览器绑定 —— 一次性 HttpOnly cookie
// （双提交 cookie 模式），服务端只比对「URL 带回来的」和「这个浏览器自己存的」。
//
// 这些用例走真实微信分支（只桩掉打向微信上游的 fetch）：mock 分支只认 devUnionid、忽略
// code，回跳在 mock 下本就不可达。HTTP、SQLite、cookie 往返全是真的。
describe("oauth state binding (login CSRF) + /config idempotency", () => {
  const APPID = "wx_appid_test";
  const SECRET = "super_secret_do_not_leak";
  const REDIRECT = "https://eih.cmyself.cc/api/auth/wechat/callback";
  const STATE_COOKIE = OAUTH_STATE_COOKIE;
  const HEX16 = /^[0-9a-f]{16}$/;
  const REJECT_TO = "/login#state_expired";

  // 测试客户端不是浏览器，HttpOnly 对它无效 —— 这正是用例能读到 state 再回传的原因，
  // 也是「state 校验不设 mock 豁免」依然可测的原因（见 auth.js 里的设计说明）。
  // 必须用 getSetCookie()：headers.get("set-cookie") 在 undici 下只返回第一条，
  // 而回跳成功那一发同时下发 session cookie 和 state 清除指令两条。
  const rawStateCookie = (res) => res.headers.getSetCookie().find((c) => c.startsWith(`${STATE_COOKIE}=`));
  const stateOf = (res) => {
    const raw = rawStateCookie(res);
    if (!raw) return undefined;
    const pair = raw.split(";")[0];
    return pair.slice(pair.indexOf("=") + 1);
  };
  // authorizeUrl 里的 state：它与 cookie 里的必须是**同一个值**，否则双提交无从比对
  const stateInUrl = (url) => {
    const m = /[?&]state=([^&#]+)/.exec(url || "");
    return m ? decodeURIComponent(m[1]) : undefined;
  };

  // 打 /config 并把 Set-Cookie 吸收进指定 jar（攻击者/受害者各用一个，模拟两个浏览器）
  async function getConfig(port, useJar) {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/config`, {
      headers: useJar.header() ? { Cookie: useJar.header() } : {}
    });
    const body = await res.json();
    const out = { status: res.status, body, raw: rawStateCookie(res), state: stateOf(res) };
    useJar.absorb(res);
    return out;
  }

  // 带指定 jar 的原始请求：回跳既会 302 又会下发多条 Set-Cookie，api() 的返回值不够用
  async function raw(port, path, useJar, { method = "GET", body } = {}) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(useJar.header() ? { Cookie: useJar.header() } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual"
    });
    const out = {
      status: res.status,
      location: res.headers.get("location"),
      setCookie: res.headers.getSetCookie(),
      body: await res.json().catch(() => null)
    };
    useJar.absorb(res);
    return out;
  }

  beforeEach(() => {
    envSnapshot = ENV_KEYS.map((k) => [k, process.env[k]]);
    // 必须非 mock：否则 exchangeIdentity({code}) 短路进 mock 分支，测到错的代码
    delete process.env.AUTH_DEV_MODE;
    process.env.NODE_ENV = "test";
    delete process.env.ADMIN_UNIONID;
    process.env.WECHAT_APP_ID = APPID;
    process.env.WECHAT_APP_SECRET = SECRET;
    process.env.WECHAT_REDIRECT_URI = REDIRECT;
    __resetInviteLimiter();
    clearAuthTables();
    jar = makeCookieJar();
    tokenBody = null;
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      const u = String(url);
      // 放行测试客户端自己打到本地服务的请求，只拦微信上游
      if (u.startsWith("http://127.0.0.1:")) return realFetch(url, init);
      return isTokenCall(u)
        ? jsonResponse(tokenBody)
        : jsonResponse({ nickname: "张三", headimgurl: "https://wx.example/a.png" });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of envSnapshot) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it("a callback whose state query matches the browser's own state cookie logs the user in", async () => {
    const { port, close } = await listen(buildApp());
    try {
      insertTestUser({ unionid: "wx-active" });
      tokenBody = { access_token: "at_1", openid: "op_1", unionid: "wx-active" };

      const cfg = await getConfig(port, jar);
      expect(cfg.status).toBe(200);
      expect(cfg.state, "state cookie 必须是 crypto.randomBytes(8).toString('hex') 的形状").toMatch(HEX16);
      expect(stateInUrl(cfg.body.data.authorizeUrl), "URL 里的 state 必须与 cookie 里的是同一个值").toBe(cfg.state);

      const r = await raw(port, `/api/auth/wechat/callback?code=c1&state=${cfg.state}`, jar);
      expect(r.status).toBe(302);
      expect(r.location).toBe("/");
      const me = await api(port, "/api/auth/me", { method: "GET" });
      expect(me.status).toBe(200);
      expect(me.body.data.user.unionid).toBe("wx-active");
    } finally { await close(); }
  });

  it("rejects a well-formed state when the browser presents no state cookie at all", async () => {
    const { port, close } = await listen(buildApp());
    try {
      // 攻击者的账号；code 也是攻击者的。受害者从没打开过登录页，浏览器里没有 state cookie。
      insertTestUser({ unionid: "attacker-wx" });
      tokenBody = { access_token: "at_a", openid: "op_a", unionid: "attacker-wx" };

      const r = await raw(port, `/api/auth/wechat/callback?code=stolen&state=${"a".repeat(16)}`, jar);
      // 修复前这里回的是 302 "/" 并且**已经写好攻击者账号的 session cookie**
      expect(r.status).toBe(302);
      expect(r.location, "没有 state cookie 的回跳必须被拒回登录页，不能发会话").toBe(REJECT_TO);
      expect(jar.cookies.eih_session, "受害者浏览器绝不能拿到攻击者账号的会话").toBeUndefined();
      expect((await api(port, "/api/auth/me", { method: "GET" })).status).toBe(401);
    } finally { await close(); }
  });

  it("rejects when the state cookie is present but the state query differs", async () => {
    const { port, close } = await listen(buildApp());
    try {
      insertTestUser({ unionid: "attacker-wx" });
      tokenBody = { access_token: "at_a", openid: "op_a", unionid: "attacker-wx" };

      const cfg = await getConfig(port, jar);          // 受害者自己的 state 进了 cookie
      const forged = "0123456789abcdef";
      expect(forged, "用例前提：伪造值必须真的不同于受害者自己的 state").not.toBe(cfg.state);

      const r = await raw(port, `/api/auth/wechat/callback?code=stolen&state=${forged}`, jar);
      expect(r.status).toBe(302);
      expect(r.location).toBe(REJECT_TO);
      expect(jar.cookies.eih_session).toBeUndefined();
      expect((await api(port, "/api/auth/me", { method: "GET" })).status).toBe(401);
    } finally { await close(); }
  });

  // M-2：钉住「数组形状的 state 必须被拒」。⚠️ **归属订正**：这里早先写的是「钉住 stateFrom 的
  // typeof 守卫」，记错了承重墙。这条链上有两层 typeof 检查 —— stateFrom 自己那层，和 validState
  // 里那层（`typeof v === "string" && OAUTH_STATE_RE.test(v)`）。评审的 G10 变异把 stateFrom 的
  // `if (typeof q === "string")` 换成 `if (q !== undefined)`（其余控制流不变），**全量套件 SURVIVED**
  // → stateFrom 那层是纵深冗余，数组最终是被 **validState** 拒掉的。
  // 那本用例到底钉住了什么？钉住的是「**不许把数组摊平**」：换成 `Array.isArray(q) ? q[0] : q`
  // 这种看起来完全合理的兼容写法时，摊平之后 validState 看到的就是合法字符串了，于是这条用例会红
  // （19 条用例的时代全绿，所以此前确实零观察者）。注意摊平后的行为并不构成新洞（cookie 绑定仍然
  // 生效），所以那是 Minor；但「注释声称防了某个形状、而该形状无人观察」本身就是缺陷。
  // 用**与自己 cookie 相同**的值做阳性对照形状：只有拒绝真的发生才会走到 REJECT_TO。
  it("rejects an array-shaped state (?state=a&state=b) even when both values match the browser's own cookie", async () => {
    const { port, close } = await listen(buildApp());
    try {
      insertTestUser({ unionid: "wx-active" });
      tokenBody = { access_token: "at_1", openid: "op_1", unionid: "wx-active" };

      const cfg = await getConfig(port, jar);
      const get = await raw(port, `/api/auth/wechat/callback?code=c1&state=${cfg.state}&state=${cfg.state}`, jar);
      expect(get.status).toBe(302);
      expect(get.location, "重复的 state query 会被 express 解析成数组，必须拒绝而不是取首元素").toBe(REJECT_TO);
      expect(jar.cookies.eih_session, "数组形状的 state 绝不能换到会话").toBeUndefined();

      // body 侧同一个守卫（stateFrom 的 body 兜底分支）：JSON 数组同样必须被拒
      const post = await raw(port, "/api/auth/wechat/callback", jar, {
        method: "POST",
        body: { code: "c1", state: [cfg.state, cfg.state] }
      });
      expect(post.status, "body 里的数组 state 必须 400").toBe(400);
      expect(post.body).toEqual({ error: "invalid state" });
      expect(jar.cookies.eih_session).toBeUndefined();
      expect((await api(port, "/api/auth/me", { method: "GET" })).status).toBe(401);
    } finally { await close(); }
  });

  it("an attacker-minted state from a separate client cannot be replayed into the victim's callback", async () => {
    const { port, close } = await listen(buildApp());
    try {
      insertTestUser({ unionid: "attacker-wx" });
      tokenBody = { access_token: "at_a", openid: "op_a", unionid: "attacker-wx" };

      // 攻击者用**自己的浏览器**领一个完全合法的 state —— 这正是无状态 HMAC 方案挡不住的形态：
      // 签名有效、由我们签发、格式正确，唯一不对的是它属于另一个浏览器。
      const attackerJar = makeCookieJar();
      const attackerCfg = await getConfig(port, attackerJar);
      expect(attackerCfg.state).toMatch(HEX16);

      // 阳性对照：这个 state 对攻击者自己的浏览器确实有效。少了这一步，
      // 下面的「拒绝」可能只是 state 校验把所有回跳都挡了，证明不了绑定关系。
      const attackerOwn = await raw(port, `/api/auth/wechat/callback?code=own&state=${attackerCfg.state}`, attackerJar);
      expect(attackerOwn.location, "攻击者自己的回跳本该成功").toBe("/");
      expect(attackerJar.cookies.eih_session, "攻击者自己确实登录进了自己的账号").toBeTruthy();

      // 受害者是另一个浏览器（独立 jar、自己的 state），攻击者把链接丢给他
      const victimCfg = await getConfig(port, jar);
      expect(victimCfg.state, "两个客户端的 state 必须不同，否则本用例没有区分力").not.toBe(attackerCfg.state);
      const replay = await raw(port, `/api/auth/wechat/callback?code=own&state=${attackerCfg.state}`, jar);
      expect(replay.status).toBe(302);
      expect(replay.location, "受害者带着攻击者的 state 回跳必须被拒").toBe(REJECT_TO);
      expect(jar.cookies.eih_session, "受害者绝不能被登进攻击者的账号").toBeUndefined();
      expect((await api(port, "/api/auth/me", { method: "GET" })).status).toBe(401);
      // 攻击者的账号确实存在且可登录（否则「受害者没登进去」可能是因为账号本身有问题）
      expect(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n).toBe(1);
    } finally { await close(); }
  });

  it("the state cookie is one-time: cleared on success, and the same state cannot be replayed", async () => {
    const { port, close } = await listen(buildApp());
    try {
      insertTestUser({ unionid: "wx-active" });
      tokenBody = { access_token: "at_1", openid: "op_1", unionid: "wx-active" };

      const cfg = await getConfig(port, jar);
      const ok = await raw(port, `/api/auth/wechat/callback?code=c1&state=${cfg.state}`, jar);
      expect(ok.location).toBe("/");
      expect(ok.setCookie.some((c) => c.startsWith(`${STATE_COOKIE}=`) && /;\s*Max-Age=0/i.test(c)),
        "成功那一发必须显式下发 state cookie 的清除指令（一次性）").toBe(true);
      expect(jar.cookies[STATE_COOKIE], "清除之后 jar 里不该还留着 state").toBeUndefined();

      // 同一个 state 再来一次（攻击者截获链接后重放）必须被拒：cookie 已经没了
      const replay = await raw(port, `/api/auth/wechat/callback?code=c1&state=${cfg.state}`, jar);
      expect(replay.location).toBe(REJECT_TO);
    } finally { await close(); }
  });

  it("a rejected callback also clears the state cookie, so the next /config mints a fresh one", async () => {
    const { port, close } = await listen(buildApp());
    try {
      tokenBody = { access_token: "at_1", openid: "op_x", unionid: "wx-x" };
      const first = await getConfig(port, jar);
      const bad = await raw(port, `/api/auth/wechat/callback?code=c1&state=${"f".repeat(16)}`, jar);
      expect(bad.location).toBe(REJECT_TO);
      expect(jar.cookies[STATE_COOKIE], "被拒之后也必须清掉（一次性，不给重放窗口）").toBeUndefined();
      const second = await getConfig(port, jar);
      expect(second.state, "cookie 已清，/config 必须重新铸一个而不是复用被拒的那个").not.toBe(first.state);
    } finally { await close(); }
  });

  it("the state cookie is HttpOnly + SameSite=Lax, scoped to /api/auth, and short-lived", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const cfg = await getConfig(port, jar);
      const cookie = cfg.raw;
      expect(cookie, "/config 必须下发 state cookie").toBeTruthy();
      expect(cookie, "必须 HttpOnly：JS 读得到，XSS 就能替攻击者对齐 state，绑定形同虚设").toMatch(/;\s*HttpOnly/i);
      expect(cookie, "必须 SameSite=Lax").toMatch(/;\s*SameSite=Lax/i);
      expect(cookie, "Path 必须收窄到 /api/auth，不要让它跟着每个请求跑").toMatch(/;\s*Path=\/api\/auth/i);
      const maxAge = Number(/;\s*Max-Age=(\d+)/i.exec(cookie)?.[1]);
      expect(maxAge, "一次性 state 必须短命，不能跟着会话活 7 天").toBeGreaterThan(0);
      expect(maxAge).toBeLessThanOrEqual(600);
      // Secure 位不断言：auth.js 顶部的 PROD 在**模块加载时**固化，测试里恒为 false，
      // 断言它只会钉住一个测试环境的假象（那条注释解释了这个陷阱）。
    } finally { await close(); }
  });

  it("D2: /config is idempotent — presenting the first call's cookie reuses the same state", async () => {
    const { port, close } = await listen(buildApp());
    try {
      // src/main.jsx 是 <React.StrictMode>，dev 下 effect 跑两次 → LoginGate 并发打两次 /config。
      // 每次都新铸 state 的话，浏览器留下的是最后到达的 Set-Cookie、React 留下的是最后 resolve
      // 的 promise，两者可能不是同一个 state，于是合法登录被自己拒掉——交互式偶发、极难查。
      const first = await getConfig(port, jar);
      const second = await getConfig(port, jar);          // 带上第一次的 cookie
      expect(second.state, "带着未过期的 state cookie 再打 /config 必须复用同一个 state").toBe(first.state);
      expect(stateInUrl(second.body.data.authorizeUrl), "复用也必须体现在 authorizeUrl 上").toBe(first.state);
    } finally { await close(); }
  });

  it("/config mints a fresh state for a new client and never echoes a malformed cookie value", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const a = await getConfig(port, jar);
      const other = makeCookieJar();
      const b = await getConfig(port, other);
      expect(b.state, "没有 cookie 的新客户端必须拿到新 state").toMatch(HEX16);
      expect(b.state).not.toBe(a.state);

      // 畸形/攻击者可控的 cookie 值不得被复用、更不得被回显进 authorizeUrl
      const bad = makeCookieJar();
      bad.cookies[STATE_COOKIE] = '"><script>alert(1)</script>';
      const c = await getConfig(port, bad);
      expect(c.state, "非法形状的 cookie 必须被丢弃、重新铸一个").toMatch(HEX16);
      expect(c.body.data.authorizeUrl).not.toContain("script");
      expect(stateInUrl(c.body.data.authorizeUrl)).toBe(c.state);
    } finally { await close(); }
  });

  it("POST /wechat/callback enforces the same binding, taking state from the query or the body", async () => {
    const { port, close } = await listen(buildApp());
    try {
      tokenBody = { access_token: "at_p", openid: "op_p", unionid: "wx-post" };

      // 错 state：修复前这一发会 200 并发票据
      const bad = await raw(port, `/api/auth/wechat/callback?state=${"0".repeat(16)}`, jar,
        { method: "POST", body: { code: "c1" } });
      expect(bad.status).toBe(400);
      expect(bad.body).toEqual({ error: "invalid state" });
      expect(jar.cookies.eih_session).toBeUndefined();

      // state 放 query（微信回跳的形状）
      const q = await getConfig(port, jar);
      const okQuery = await raw(port, `/api/auth/wechat/callback?state=${q.state}`, jar,
        { method: "POST", body: { code: "c1" } });
      expect(okQuery.status).toBe(200);
      expect(okQuery.body.data.status).toBe("need_invite");

      // state 放 body（程序化调用的形状）
      const b = await getConfig(port, jar);
      const okBody = await raw(port, "/api/auth/wechat/callback", jar,
        { method: "POST", body: { code: "c1", state: b.state } });
      expect(okBody.status).toBe(200);
      expect(okBody.body.data.status).toBe("need_invite");
    } finally { await close(); }
  });

  it("dev-login needs no state cookie: it is a POST with no OAuth round-trip", async () => {
    const { port, close } = await listen(buildApp());
    try {
      // 钉住设计决定，免得将来有人（a）把 state 校验顺手加到 dev-login 上把本地联调打死，
      // 或（b）拿 dev-login 的豁免当先例去放宽回跳的校验。
      // 豁免的理由：dev-login 没有浏览器跳转、没有 code 可重放，login CSRF 需要的
      // 「驱动受害者浏览器去打回跳 URL」这一步在这里不存在；而它本身已被 isMockMode() 门禁
      // （生产 404）。
      process.env.AUTH_DEV_MODE = "wechat-mock";
      const r = await api(port, "/api/auth/dev-login", { body: { devUnionid: "dev-no-state" } });
      expect(r.status).toBe(200);
      expect(r.body.data.status).toBe("need_invite");
      expect(r.body.data.ticket).toMatch(/^[0-9a-f]{64}$/);
    } finally { await close(); }
  });
});

// 测试库跨进程持久：本文件每个用例都在 users / sessions / pending_identities / invite_codes 里
// 留行，不清就会让后续套件（views / admin / apiRoutes）的 FK 与计数假设踩到别人的数据。
afterAll(() => { clearAuthTables(); });

describe("pair login 用户名+邀请码体系（产品负责人 2026-10-21）", () => {
  beforeEach(() => {
    __resetInviteLimiter();
    clearAuthTables();
    jar = makeCookieJar();
  });

  afterAll(() => {
    clearAuthTables();
  });

  const seedCode = (code, extra = "") =>
    db.prepare(`INSERT INTO invite_codes (code, label, role) VALUES (?, 'pair', 'user') ${extra}`).run(code);

  it("register-pair：码+用户名建号 → 201、used_count+1、直接带会话，可用 /me 验证", async () => {
    const { port, close } = await listen(buildApp());
    try {
      seedCode("PAIR01");
      const r = await api(port, "/api/auth/register-pair", { body: { code: "pair01", username: "Alice" } });
      expect(r.status).toBe(201);
      expect(r.body.data.user.nickname).toBe("Alice");
      expect(r.body.data.user.role).toBe("user");
      expect(db.prepare("SELECT used_count FROM invite_codes WHERE code='PAIR01'").get().used_count).toBe(1);
      const me = await api(port, "/api/auth/me", { method: "GET" });
      expect(me.body.data.user.nickname).toBe("Alice");
    } finally { await close(); }
  });

  it("register-pair：大小写不敏感（码大写存储，输入小写也能命中）", async () => {
    const { port, close } = await listen(buildApp());
    try {
      seedCode("PAIR02");
      const r = await api(port, "/api/auth/register-pair", { body: { code: "Pair02", username: "Bob" } });
      expect(r.status).toBe(201);
    } finally { await close(); }
  });

  it("register-pair：同码同用户名重复注册 → 409", async () => {
    const { port, close } = await listen(buildApp());
    try {
      seedCode("PAIR03");
      await api(port, "/api/auth/register-pair", { body: { code: "PAIR03", username: "Carol" } });
      const r = await api(port, "/api/auth/register-pair", { body: { code: "PAIR03", username: "Carol" } });
      expect(r.status).toBe(409);
      expect(db.prepare("SELECT used_count FROM invite_codes WHERE code='PAIR03'").get().used_count).toBe(1);
    } finally { await close(); }
  });

  it("register-pair：不同码同名不冲突（合成 unionid 天然隔离）", async () => {
    const { port, close } = await listen(buildApp());
    try {
      seedCode("PAIR04A");
      seedCode("PAIR04B");
      expect((await api(port, "/api/auth/register-pair", { body: { code: "PAIR04A", username: "Dave" } })).status).toBe(201);
      expect((await api(port, "/api/auth/register-pair", { body: { code: "PAIR04B", username: "Dave" } })).status).toBe(201);
    } finally { await close(); }
  });

  it("register-pair：码过期 / 达上限 / 停用 → 400 且全仓统一文案", async () => {
    const { port, close } = await listen(buildApp());
    try {
      db.prepare(`INSERT INTO invite_codes (code, label, role, expires_at) VALUES ('EXPIRED', 'x', 'user', '2020-01-01 00:00:00')`).run();
      db.prepare(`INSERT INTO invite_codes (code, label, role, max_uses, used_count) VALUES ('FULL', 'x', 'user', 1, 1)`).run();
      db.prepare(`INSERT INTO invite_codes (code, label, role, active) VALUES ('OFF', 'x', 'user', 0)`).run();
      expect((await api(port, "/api/auth/register-pair", { body: { code: "EXPIRED", username: "E" } })).body.error).toBe("invite code expired");
      expect((await api(port, "/api/auth/register-pair", { body: { code: "FULL", username: "F" } })).body.error).toBe("invite code exhausted");
      expect((await api(port, "/api/auth/register-pair", { body: { code: "OFF", username: "O" } })).body.error).toBe("invalid invite code");
      expect((await api(port, "/api/auth/register-pair", { body: { code: "NOPE", username: "N" } })).body.error).toBe("invalid invite code");
    } finally { await close(); }
  });

  it("register-pair：用户名为空或超长 → 400", async () => {
    const { port, close } = await listen(buildApp());
    try {
      seedCode("PAIR05");
      expect((await api(port, "/api/auth/register-pair", { body: { code: "PAIR05", username: "  " } })).status).toBe(400);
      expect((await api(port, "/api/auth/register-pair", { body: { code: "PAIR05", username: "x".repeat(31) } })).status).toBe(400);
    } finally { await close(); }
  });

  it("login-pair：配对成功 → 200 + 会话；码输入大小写不敏感", async () => {
    const { port, close } = await listen(buildApp());
    try {
      seedCode("PAIR06");
      await api(port, "/api/auth/register-pair", { body: { code: "PAIR06", username: "Eve" } });
      jar = makeCookieJar();  // 换「浏览器」
      const r = await api(port, "/api/auth/login-pair", { body: { code: "pair06", username: "Eve" } });
      expect(r.status).toBe(200);
      const me = await api(port, "/api/auth/me", { method: "GET" });
      expect(me.body.data.user.nickname).toBe("Eve");
    } finally { await close(); }
  });

  it("login-pair：pair 对不上 → 401 统一文案（不泄露哪一半错）", async () => {
    const { port, close } = await listen(buildApp());
    try {
      seedCode("PAIR07");
      await api(port, "/api/auth/register-pair", { body: { code: "PAIR07", username: "Frank" } });
      const wrongCode = await api(port, "/api/auth/login-pair", { body: { code: "OTHER99", username: "Frank" } });
      const wrongName = await api(port, "/api/auth/login-pair", { body: { code: "PAIR07", username: "Grace" } });
      expect(wrongCode.status).toBe(401);
      expect(wrongName.status).toBe(401);
      expect(wrongCode.body.error).toBe(wrongName.body.error);
    } finally { await close(); }
  });

  it("🔴 码过期后**存量用户仍可登录**（过期只挡新注册，产品负责人原话）", async () => {
    const { port, close } = await listen(buildApp());
    try {
      seedCode("PAIR08");
      await api(port, "/api/auth/register-pair", { body: { code: "PAIR08", username: "Hank" } });
      db.prepare(`UPDATE invite_codes SET expires_at = '2020-01-01 00:00:00' WHERE code = 'PAIR08'`).run();
      // 新注册被挡
      expect((await api(port, "/api/auth/register-pair", { body: { code: "PAIR08", username: "Ivy" } })).status).toBe(400);
      // 存量登录放行
      jar = makeCookieJar();
      const r = await api(port, "/api/auth/login-pair", { body: { code: "PAIR08", username: "Hank" } });
      expect(r.status).toBe(200);
    } finally { await close(); }
  });

  it("login-pair：被禁用的存量用户 → 403", async () => {
    const { port, close } = await listen(buildApp());
    try {
      seedCode("PAIR09");
      await api(port, "/api/auth/register-pair", { body: { code: "PAIR09", username: "Iris" } });
      db.prepare(`UPDATE users SET status = 'disabled' WHERE nickname = 'Iris'`).run();
      const r = await api(port, "/api/auth/login-pair", { body: { code: "PAIR09", username: "Iris" } });
      expect(r.status).toBe(403);
      expect(r.body.error).toBe("account disabled");
    } finally { await close(); }
  });

  it("限速：同一 IP 连打 6 次 login-pair → 第 6 次 429（复用 register 的 5/分闸门）", async () => {
    const { port, close } = await listen(buildApp());
    try {
      for (let i = 0; i < 5; i++) {
        await api(port, "/api/auth/login-pair", { body: { code: "X", username: `u${i}` } });
      }
      const r = await api(port, "/api/auth/login-pair", { body: { code: "X", username: "u5" } });
      expect(r.status).toBe(429);
    } finally { await close(); }
  });
});
