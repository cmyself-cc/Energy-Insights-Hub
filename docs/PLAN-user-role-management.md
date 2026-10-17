# 分用户分角色管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Energy Insights Hub 增加微信登录 + 邀请码开通的 admin/user 双角色体系，实现报告/模板按 owner 隔离、insights 池用户自定义视角、反馈提交-审批流（对应 `docs/PRD.md` 第 3 章，M1-M4）。

**Architecture:** 单容器 Express + SQLite 内自管会话（node:crypto 随机 token + sha256 哈希入库 + HttpOnly cookie），微信身份经服务端 code 换 UnionID（本地开发用 mock 身份提供器隔离外部依赖）；鉴权/角色两个中间件在 `server/index.js` 路由挂载点收紧；资源归属用 `owner_id` 列 + SQL WHERE 过滤，不引入 ORM 或会话库新依赖。

**Tech Stack:** Express 4、better-sqlite3（WAL、编号 SQL 迁移）、node:crypto、React 18 函数组件 + hooks、Vitest（colocated `*.test.js`，`fileParallelism:false`，NODE_ENV=test 自动用 `data/test-energy_insights.db`）。

## Global Constraints（逐字取自 PRD/AGENTS.md，每个任务默认遵守）

- 不新增重量级依赖：会话、密码学只用 `node:crypto`；不引入 express-session/passport/jwt 库。
- 迁移文件放 `server/migrations/`，编号顺延 **023–026**，建表用 `CREATE TABLE IF NOT EXISTS`；runner 按文件名排序执行且已记录在 `_migrations`，不会重放。
- API 响应一律 `{ data: ... }` / `{ error: "..." }`；越权 403，非本人资源 404（不泄露存在性）。
- session cookie：`HttpOnly` + `SameSite=Lax` + 生产 `Secure`；token `crypto.randomBytes(32).hex`，库中只存 sha256；有效期 7 天滑动。
- 邀请码：默认可复用；`max_uses NULL=不限`、`expires_at NULL=长期`；校验限速 5 次/分钟/IP；只携带**角色 + 默认视角配置**。
- 每用户视角上限 **10**；禁用用户 = 仅挡登录，数据全保留；未经产品负责人批准不得删除任何数据库数据。
- 初始管理员：`ADMIN_UNIONID` 环境变量 seed——该 UnionID 首次登录直接成为 admin，免邀请码。
- 前端新文案一律进 `src/constants/i18n.js` zh/en 双语；组件样式用 `src/constants/theme.js` 的 COLORS 等 token（inline styles 惯例）。
- 测试只在本地库（NODE_ENV=test）跑；联调用测试环境 `npm run dev`（:3001 + ./data/energy_insights.db）；**禁止**对生产容器（localhost:3006）或 `eih_data` 做写验证。
- 后端路由文件模式参照现有 `server/routes/settings.js`；测试模式参照 `server/routes/settings.test.js`（buildApp + `app.listen(0)` + fetch + beforeEach `initDb()`/清理）。

**文件总览（新增/修改）**

```
新增  server/migrations/023_users_auth.sql        024_resource_ownership.sql
      server/migrations/025_user_views.sql        026_feedback_user.sql
      server/lib/sessions.js                      server/lib/authMiddleware.js
      server/services/identityProvider.js         server/routes/auth.js
      server/routes/admin.js                      server/routes/views.js
      server/testUtils.js
      src/components/LoginGate.jsx                src/components/ViewsBar.jsx
      src/components/admin/UsersPage.jsx          src/components/admin/InviteCodesPage.jsx
修改  server/index.js  server/routes/{reports,feedback,insights,sources,filters,
      industries,settings,models,searchProviders,tracker,ai}.js
      src/App.jsx  src/utils/backendApi.js  src/components/{Header,Sidebar,
      ConfigurationPage,ReportsPage,ReportGeneratorModal,IntelligencePage,
      ContentFiltersPage,FeedbackPage,CardActions}.jsx  src/constants/i18n.js
      .env.example  README.md(角色一节)
```

---

## Phase M1 — 身份与角色

### Task 1: 身份相关迁移 023

**Files:**
- Create: `server/migrations/023_users_auth.sql`
- Test: `server/migrations/023_users_auth.test.js`（放 migrations 目录会被 vitest `**/*.test.js` 收集；若项目 vitest include 只扫 server/**，此路径满足）

**Interfaces:**
- Produces: 表 `users(id, unionid UNIQUE, openid_web, openid_mp, nickname, avatar_url, role, status, invited_by_code_id, created_at, last_login_at)`、`invite_codes`、`sessions(id, user_id, token_hash UNIQUE, user_agent, created_at, expires_at)`、`pending_identities(id, token_hash UNIQUE, unionid, openid, nickname, avatar_url, created_at, expires_at)`

- [ ] **Step 1: 写失败测试**

```js
// server/migrations/023_users_auth.test.js
import { describe, it, expect, beforeEach } from "vitest";
import db, { initDb } from "../db.js";

describe("migration 023 users auth", () => {
  beforeEach(() => { initDb(); });

  it("creates users table with role check constraint", () => {
    db.prepare(`INSERT INTO users (unionid, nickname, role) VALUES ('u1', 'N1', 'admin')`).run();
    expect(db.prepare("SELECT role FROM users WHERE unionid='u1'").get().role).toBe("admin");
    expect(() =>
      db.prepare(`INSERT INTO users (unionid, nickname, role) VALUES ('u2', 'N2', 'root')`).run()
    ).toThrow();
  });

  it("creates invite_codes with nullable limits (reusable by default)", () => {
    db.prepare(`INSERT INTO invite_codes (code, label, role) VALUES ('ABC123', 'team', 'user')`).run();
    const row = db.prepare("SELECT * FROM invite_codes WHERE code='ABC123'").get();
    expect(row.max_uses).toBeNull();
    expect(row.expires_at).toBeNull();
    expect(row.used_count).toBe(0);
    expect(row.active).toBe(1);
  });

  it("creates sessions and pending_identities tables", () => {
    db.prepare(`INSERT INTO sessions (user_id, token_hash) VALUES (1, 'h1')`).run();
    db.prepare(`INSERT INTO pending_identities (token_hash, unionid) VALUES ('p1', 'u9')`).run();
    expect(db.prepare("SELECT 1 FROM sessions WHERE token_hash='h1'").get()).toBeTruthy();
    expect(db.prepare("SELECT 1 FROM pending_identities WHERE token_hash='p1'").get()).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run server/migrations/023_users_auth.test.js`
Expected: FAIL（no such table: users）

- [ ] **Step 3: 写迁移**

```sql
-- server/migrations/023_users_auth.sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unionid TEXT NOT NULL UNIQUE,
  openid_web TEXT,
  openid_mp TEXT,
  nickname TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  invited_by_code_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME
);

CREATE TABLE IF NOT EXISTS invite_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  label TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
  default_view TEXT,                     -- JSON: {name, filters} 开通时落为首个视角
  max_uses INTEGER,                      -- NULL = 不限
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at DATETIME,                   -- NULL = 长期
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT DEFAULT '',
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,       -- 一次性票据 sha256，用于「已授权但未开通」窗口
  unionid TEXT NOT NULL,
  openid TEXT,
  nickname TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL           -- 10 分钟
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_expiry ON pending_identities(expires_at);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run server/migrations/023_users_auth.test.js`
Expected: PASS ×3

- [ ] **Step 5: Commit**

```bash
git add server/migrations/023_users_auth.sql server/migrations/023_users_auth.test.js
git commit -m "feat(auth): 023 用户/邀请码/会话/待开通身份迁移"
```

---

### Task 2: 会话与鉴权中间件（sessions + requireAuth/requireAdmin）

**Files:**
- Create: `server/lib/sessions.js`、`server/lib/authMiddleware.js`、`server/testUtils.js`
- Test: `server/lib/sessions.test.js`、`server/lib/authMiddleware.test.js`

**Interfaces:**
- Consumes: `users` / `sessions` 表（Task 1）
- Produces:
  - `createSession(userId, userAgent) -> rawToken`（string, 64 hex）
  - `resolveSession(rawToken) -> { user } | null`（滑动续期 7d；过期/disabled 返回 null 并删除过期行）
  - `destroySession(rawToken) -> void`
  - `requireAuth(req,res,next)`：注入 `req.user = {id, unionid, nickname, avatar_url, role, status}`；无/无效 cookie → 401 `{error:"unauthorized"}`
  - `requireAdmin(req,res,next)`：`req.user.role !== 'admin'` → 403 `{error:"forbidden"}`
  - `parseCookieValue(req, "eih_session") -> string|undefined`
  - `SESSION_COOKIE = "eih_session"`；SESSION_TTL_DAYS = 7
- testUtils: `listen(app) -> {port, close}`、`makeCookieJar()`（fetch 携带 Set-Cookie 的简易 jar）、`insertTestUser({unionid, role, status}) -> user row`、`clearAuthTables()`

- [ ] **Step 1: 写 testUtils（供 M1-M4 全部路由测试复用）**

```js
// server/testUtils.js
import db, { initDb } from "./db.js";

export async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  const { port } = server.address();
  return { port, close: () => new Promise(r => server.close(r)) };
}

export function makeCookieJar() {
  const jar = {};
  return {
    header: () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "),
    absorb: (res) => {
      const raw = res.headers.get("set-cookie");
      if (!raw) return;
      for (const c of raw.split(/,(?=\s*[A-Za-z0-9_.-]+=)/)) {
        const [pair] = c.split(";");
        const [k, v] = pair.trim().split("=");
        if (v === "" || v === "invalid") delete jar[k]; else jar[k] = v;
      }
    },
    cookies: jar
  };
}

export function insertTestUser({ unionid, role = "user", status = "active", nickname = `T-${unionid}` }) {
  initDb();
  db.prepare(
    "INSERT OR IGNORE INTO users (unionid, nickname, role, status) VALUES (?, ?, ?, ?)"
  ).run(unionid, nickname, role, status);
  return db.prepare("SELECT * FROM users WHERE unionid = ?").get(unionid);
}

export function clearAuthTables() {
  for (const t of ["sessions", "pending_identities", "invite_codes", "user_views", "users"]) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
}
```

- [ ] **Step 2: 写失败测试**

```js
// server/lib/sessions.test.js
import { describe, it, expect, beforeEach } from "vitest";
import db from "../db.js";
import { createSession, resolveSession, destroySession } from "./sessions.js";
import { insertTestUser, clearAuthTables } from "../testUtils.js";

describe("sessions", () => {
  beforeEach(() => { clearAuthTables(); });

  it("creates and resolves a session, sliding expiry", () => {
    const u = insertTestUser({ unionid: "u1" });
    const token = createSession(u.id, "vitest");
    const hit = resolveSession(token);
    expect(hit.user.id).toBe(u.id);
    const row = db.prepare("SELECT * FROM sessions WHERE user_id=?").get(u.id);
    expect(row.token_hash).not.toBe(token);            // 只存哈希
    expect(row.token_hash).toBe(require("node:crypto").createHash("sha256").update(token).digest("hex"));
  });

  it("rejects unknown token and expired session", () => {
    expect(resolveSession("deadbeef")).toBeNull();
    const u = insertTestUser({ unionid: "u2" });
    const token = createSession(u.id, "");
    db.prepare("UPDATE sessions SET expires_at = datetime('now','-1 day') WHERE user_id=?").run(u.id);
    expect(resolveSession(token)).toBeNull();
  });

  it("disabled user session stops resolving", () => {
    const u = insertTestUser({ unionid: "u3" });
    const token = createSession(u.id, "");
    db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(u.id);
    expect(resolveSession(token)).toBeNull();
  });

  it("destroySession deletes the row", () => {
    const u = insertTestUser({ unionid: "u4" });
    const token = createSession(u.id, "");
    destroySession(token);
    expect(resolveSession(token)).toBeNull();
  });
});
```

```js
// server/lib/authMiddleware.test.js
import { describe, it, expect, beforeEach } from "vitest";
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
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run server/lib/sessions.test.js server/lib/authMiddleware.test.js`
Expected: FAIL（Cannot find module ./sessions.js）

- [ ] **Step 4: 实现 sessions.js**

```js
// server/lib/sessions.js
import crypto from "node:crypto";
import db from "../db.js";

const TTL_DAYS = 7;
const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");

export function createSession(userId, userAgent = "") {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare(
    "INSERT INTO sessions (user_id, token_hash, user_agent, expires_at) VALUES (?, ?, ?, datetime('now', '+' || ? || ' days'))"
  ).run(userId, hash(token), String(userAgent).slice(0, 200), TTL_DAYS);
  return token;
}

export function resolveSession(token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT s.*, u.unionid, u.nickname, u.avatar_url, u.role, u.status
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
  ).get(hash(token));
  if (!row) return null;
  const expired = db.prepare("SELECT datetime('now') > ? AS e").get(row.expires_at).e === 1;
  if (expired || row.status !== "active") {
    if (expired) db.prepare("DELETE FROM sessions WHERE id=?").run(row.id);
    return null;
  }
  db.prepare(
    `UPDATE sessions SET expires_at = datetime('now', '+' || ? || ' days') WHERE id = ?`
  ).run(TTL_DAYS, row.id);
  return { user: { id: row.user_id, unionid: row.unionid, nickname: row.nickname, avatar_url: row.avatar_url, role: row.role, status: row.status } };
}

export function destroySession(token) {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash(token));
}
```

- [ ] **Step 5: 实现 authMiddleware.js**

```js
// server/lib/authMiddleware.js
import { resolveSession } from "./sessions.js";

export const SESSION_COOKIE = "eih_session";

export function parseCookieValue(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function requireAuth(req, res, next) {
  const hit = resolveSession(parseCookieValue(req, SESSION_COOKIE));
  if (!hit) return res.status(401).json({ error: "unauthorized" });
  req.user = hit.user;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "forbidden" });
  next();
}

export function setSessionCookie(res, token, production) {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=604800"
  ];
  if (production) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

export function clearSessionCookie(res, production) {
  const attrs = [`${SESSION_COOKIE}=invalid`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (production) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run server/lib/sessions.test.js server/lib/authMiddleware.test.js`
Expected: PASS（sessions ×4 + middleware ×2）

- [ ] **Step 7: Commit**

```bash
git add server/lib/sessions.js server/lib/authMiddleware.js server/lib/sessions.test.js server/lib/authMiddleware.test.js server/testUtils.js
git commit -m "feat(auth): 自管会话与鉴权/角色中间件"
```

---

### Task 3: 身份提供器 identityProvider（微信 + 本地 mock）

**Files:**
- Create: `server/services/identityProvider.js`
- Test: `server/services/identityProvider.test.js`
- Modify: `.env.example`

**Interfaces:**
- Consumes: env `WECHAT_APP_ID` / `WECHAT_APP_SECRET` / `WECHAT_REDIRECT_URI` / `AUTH_DEV_MODE`
- Produces: `getAuthorizeUrl(state) -> string|null`（mock 模式返回 null，前端走 dev 入口）；`exchangeIdentity({ code } | { devUnionid }) -> { unionid, openid, nickname, avatar_url } | { error }`；`isMockMode() -> boolean`
- mock 模式仅当 `AUTH_DEV_MODE=wechat-mock` 且 `NODE_ENV !== "production"` 生效——解决「微信资质未就绪卡联调」的 OQ-1 依赖。

- [ ] **Step 1: 写失败测试**

```js
// server/services/identityProvider.test.js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isMockMode, exchangeIdentity, getAuthorizeUrl } from "./identityProvider.js";

describe("identityProvider mock mode", () => {
  beforeEach(() => { process.env.AUTH_DEV_MODE = "wechat-mock"; process.env.NODE_ENV = "test"; });
  afterEach(() => { delete process.env.AUTH_DEV_MODE; });

  it("mock mode active only outside production", () => {
    expect(isMockMode()).toBe(true);
    process.env.NODE_ENV = "production";
    expect(isMockMode()).toBe(false);
    process.env.NODE_ENV = "test";
  });

  it("mock exchangeIdentity returns deterministic identity", () => {
    const id = exchangeIdentity({ devUnionid: "dev-u1" });
    expect(id.unionid).toBe("dev-u1");
    expect(id.nickname).toMatch(/^dev-/);
  });

  it("mock exchangeIdentity rejects empty unionid", () => {
    expect(exchangeIdentity({ devUnionid: "" }).error).toBeTruthy();
  });

  it("getAuthorizeUrl returns null in mock mode", () => {
    expect(getAuthorizeUrl("s1")).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run server/services/identityProvider.test.js`
Expected: FAIL（Cannot find module）

- [ ] **Step 3: 实现**

```js
// server/services/identityProvider.js
import crypto from "node:crypto";

const WX = {
  TOKEN_URL: "https://api.weixin.qq.com/sns/oauth2/access_token",
  USERINFO_URL: "https://api.weixin.qq.com/sns/userinfo"
};

export function isMockMode() {
  return process.env.AUTH_DEV_MODE === "wechat-mock" && process.env.NODE_ENV !== "production";
}

export function getAuthorizeUrl(state) {
  if (isMockMode()) return null;
  const { WECHAT_APP_ID: appid, WECHAT_REDIRECT_URI: redirect } = process.env;
  if (!appid || !redirect) return null;
  return "https://open.weixin.qq.com/connect/qrconnect?appid=" + encodeURIComponent(appid)
    + "&redirect_uri=" + encodeURIComponent(redirect)
    + "&response_type=code&scope=snsapi_login&state=" + encodeURIComponent(state) + "#wechat_redirect";
}

// 真实微信：code -> access_token -> userinfo(unionid)。同步路由用 async handler。
export async function exchangeIdentityWechat(code) {
  const { WECHAT_APP_ID: appid, WECHAT_APP_SECRET: secret } = process.env;
  if (!appid || !secret) return { error: "wechat_not_configured" };
  const tokenRes = await fetch(`${WX.TOKEN_URL}?appid=${appid}&secret=${secret}&code=${encodeURIComponent(code)}&grant_type=authorization_code`);
  const token = await tokenRes.json();
  if (token.errcode) return { error: `wechat_oauth_failed: ${token.errmsg}` };
  if (!token.unionid) return { error: "wechat_unionid_missing: 应用未绑定开放平台账号" };
  const infoRes = await fetch(`${WX.USERINFO_URL}?access_token=${token.access_token}&openid=${token.openid}&lang=zh_CN`);
  const info = await infoRes.json();
  return {
    unionid: token.unionid,
    openid: token.openid,
    nickname: info.nickname || `wx-${String(token.unionid).slice(-6)}`,
    avatar_url: info.headimgurl || ""
  };
}

export function exchangeIdentity({ code, devUnionid } = {}) {
  if (isMockMode()) {
    const unionid = String(devUnionid || "").trim();
    if (!unionid) return { error: "dev_unionid_required" };
    return {
      unionid,
      openid: "mock-" + crypto.createHash("sha256").update(unionid).digest("hex").slice(0, 16),
      nickname: `dev-${unionid}`,
      avatar_url: ""
    };
  }
  return exchangeIdentityWechat(code); // caller awaits
}
```

- [ ] **Step 4: 跑测试确认通过**（注意实现返回的 nickname 为 `dev-<unionid>`，与断言一致）

Run: `npx vitest run server/services/identityProvider.test.js`
Expected: PASS ×4

- [ ] **Step 5: `.env.example` 追加**

```bash
git add server/services/identityProvider.js server/services/identityProvider.test.js .env.example
```

`.env.example` 末尾追加（不提交真实 .env）：

```
# 微信登录（开放平台网站应用；未就绪时本地用 mock 模式联调）
WECHAT_APP_ID=
WECHAT_APP_SECRET=
WECHAT_REDIRECT_URI=https://eih.cmyself.cc/api/auth/wechat/callback
# 本地开发免微信：AUTH_DEV_MODE=wechat-mock（仅非 production 生效）
AUTH_DEV_MODE=
# 初始管理员 UnionID（首次登录直接成为 admin，免邀请码）
ADMIN_UNIONID=
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(auth): 身份提供器（微信OAuth+本地mock）与 env 模板"
```

---

### Task 4: auth 路由（登录/回调/邀请码开通/me/登出 + ADMIN seed + 限速）

**Files:**
- Create: `server/routes/auth.js`
- Test: `server/routes/auth.test.js`

**Interfaces:**
- Consumes: Task 1 表、Task 2 `createSession/setSessionCookie/requireAuth/parseCookieValue/SESSION_COOKIE`、Task 3 `exchangeIdentity/isMockMode/getAuthorizeUrl`；Task 5 的 `applyInviteDefaults(userId, inviteRow)`（本任务内先以内联实现放置，Task 5 迁移为 views 服务）
- Produces:
  - `GET  /api/auth/config` -> `{ data: { mockMode, authorizeUrl } }`（免鉴权）
  - `POST /api/auth/wechat/callback`（也支持 GET query code/state，微信回跳为 GET）-> 已注册：设 session cookie 后 302 `/`；未注册：建 pending 票据 302 `/login#invite=<ticket>`；disabled：302 `/login#disabled`
  - `POST /api/auth/dev-login`（**仅 mock 模式**，body `{ devUnionid }`）-> 同上语义但返回 JSON `{ data: { status: "active" } }`（已设 cookie）或 `{ data: { status: "need_invite", ticket } }`
  - `POST /api/auth/register` body `{ ticket, code }` -> 成功 `{ data: { user } }`（已设 cookie；原子校验+计数）；失败 400 `{ error }`
  - `GET  /api/auth/me`（requireAuth）-> `{ data: { user } }`
  - `POST /api/auth/logout`（requireAuth）-> 清 session + cookie，`{ success: true }`
  - 限速：`inviteLimiter` 5 次/分钟/IP（内存 Map，够用；重启清零可接受）

- [ ] **Step 1: 写失败测试（覆盖 PRD 开通流四场景）**

```js
// server/routes/auth.test.js
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import db from "../db.js";
import authRouter from "./auth.js";
import { clearAuthTables, insertTestUser, listen, makeCookieJar } from "../testUtils.js";
import { SESSION_COOKIE } from "../lib/authMiddleware.js";

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

describe("auth flow (mock mode)", () => {
  beforeEach(() => {
    process.env.AUTH_DEV_MODE = "wechat-mock";
    process.env.NODE_ENV = "test";
    delete process.env.ADMIN_UNIONID;
    clearAuthTables();
    jar = makeCookieJar();
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

  it("register rejects wrong/expired/exhausted code and burns ticket", async () => {
    const { port, close } = await listen(buildApp());
    try {
      db.prepare(`INSERT INTO invite_codes (code, role, max_uses, used_count) VALUES ('FULL01','user',1,1)`).run();
      const r1 = await api(port, "/api/auth/dev-login", { body: { devUnionid: "u2" } });
      const bad = await api(port, "/api/auth/register", { body: { ticket: r1.body.data.ticket, code: "NOPE" } });
      expect(bad.status).toBe(400);
      const r2 = await api(port, "/api/auth/dev-login", { body: { devUnionid: "u2b" } });
      const full = await api(port, "/api/auth/register", { body: { ticket: r2.body.data.ticket, code: "FULL01" } });
      expect(full.status).toBe(400);
      expect(full.body.error).toMatch(/invite/i);
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
      await api(port, "/api/auth/logout", {});
      expect((await api(port, "/api/auth/me", { method: "GET" })).status).toBe(401);
    } finally { await close(); }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run server/routes/auth.test.js`
Expected: FAIL（Cannot find module ./auth.js）

- [ ] **Step 3: 实现 auth 路由**

```js
// server/routes/auth.js
import crypto from "node:crypto";
import { Router } from "express";
import db from "../db.js";
import { createSession, destroySession } from "../lib/sessions.js";
import { requireAuth, parseCookieValue, SESSION_COOKIE, setSessionCookie, clearSessionCookie } from "../lib/authMiddleware.js";
import { exchangeIdentity, getAuthorizeUrl, isMockMode } from "../services/identityProvider.js";
import { applyInviteDefaults } from "../services/viewService.js";

const router = Router();
const PROD = process.env.NODE_ENV === "production";
const sha256 = (t) => crypto.createHash("sha256").update(t).digest("hex");

// —— 邀请码校验限速：5/min/IP（内存桶即可，重启清零可接受）——
const buckets = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const b = buckets.get(ip) || { count: 0, ts: now };
  if (now - b.ts > 60_000) { b.count = 0; b.ts = now; }
  b.count += 1;
  buckets.set(ip, b);
  if (buckets.size > 10_000) buckets.clear();
  return b.count > 5;
}

function findUserByUnionid(unionid) {
  return db.prepare("SELECT * FROM users WHERE unionid = ?").get(unionid);
}

function issuePending(identity) {
  const ticket = crypto.randomBytes(32).toString("hex");
  db.prepare(
    `INSERT INTO pending_identities (token_hash, unionid, openid, nickname, avatar_url, expires_at)
     VALUES (?, ?, ?, ?, ?, datetime('now','+10 minutes'))`
  ).run(sha256(ticket), identity.unionid, identity.openid || null, identity.nickname, identity.avatar_url);
  return ticket;
}

function loginExisting(res, user) {
  const token = createSession(user.id, "web");
  setSessionCookie(res, token, PROD);
  db.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);
  return publicUser(user);
}

function publicUser(u) {
  return { id: u.id, unionid: u.unionid, nickname: u.nickname, avatar_url: u.avatar_url, role: u.role, status: u.status };
}

// 统一处理身份 -> 登录/待开通/禁用
function handleIdentity(req, res, identity, { json }) {
  if (identity.error) return res.status(400).json({ error: identity.error });
  let user = findUserByUnionid(identity.unionid);
  if (!user && identity.unionid === process.env.ADMIN_UNIONID) {
    // AUTH-6：seed admin 免邀请码
    db.prepare(`INSERT INTO users (unionid, openid_web, nickname, avatar_url, role) VALUES (?, ?, ?, ?, 'admin')`)
      .run(identity.unionid, identity.openid || null, identity.nickname, identity.avatar_url);
    user = findUserByUnionid(identity.unionid);
  }
  if (user) {
    if (user.status !== "active") {
      return json ? res.json({ data: { status: "disabled" } })
                  : res.redirect(302, "/login#disabled");
    }
    const pu = loginExisting(res, user);
    return json ? res.json({ data: { status: "active", user: pu } })
                : res.redirect(302, "/");
  }
  const ticket = issuePending(identity);
  return json ? res.json({ data: { status: "need_invite", ticket } })
              : res.redirect(302, `/login#invite=${ticket}`);
}

router.get("/config", (_req, res) => {
  res.json({ data: { mockMode: isMockMode(), authorizeUrl: getAuthorizeUrl(crypto.randomBytes(8).toString("hex")) } });
});

// 微信回跳（GET，浏览器带 ?code=&state=）
router.get("/wechat/callback", async (req, res) => {
  const identity = await exchangeIdentity({ code: req.query.code });
  handleIdentity(req, res, identity, { json: false });
});
router.post("/wechat/callback", async (req, res) => {
  const identity = await exchangeIdentity({ code: req.body.code });
  handleIdentity(req, res, identity, { json: true });
});

// 仅 mock 模式的本地登录入口（联调/测试；生产自动 404）
router.post("/dev-login", (req, res) => {
  if (!isMockMode()) return res.status(404).json({ error: "not found" });
  const identity = exchangeIdentity({ devUnionid: req.body.devUnionid });
  handleIdentity(req, res, identity, { json: true });
});

router.post("/register", (req, res) => {
  const { ticket, code } = req.body || {};
  if (rateLimited(req.ip)) return res.status(429).json({ error: "too many attempts, slow down" });
  const pending = db.prepare(
    `SELECT * FROM pending_identities WHERE token_hash = ? AND datetime('now') < expires_at`
  ).get(sha256(String(ticket || "")));
  if (!pending) return res.status(400).json({ error: "invalid or expired ticket" });
  const invite = db.prepare("SELECT * FROM invite_codes WHERE code = ? AND active = 1").get(String(code || "").trim());
  const reason =
    !invite ? "invalid invite code"
    : invite.expires_at && db.prepare("SELECT datetime('now') < ? AS ok").get(invite.expires_at).ok !== 1 ? "invite code expired"
    : invite.max_uses != null && invite.used_count >= invite.max_uses ? "invite code exhausted"
    : null;
  if (reason) return res.status(400).json({ error: reason });

  const register = db.transaction(() => {
    // 并发首登同 UnionID 防重复
    const dup = findUserByUnionid(pending.unionid);
    if (dup) return dup;
    db.prepare("UPDATE invite_codes SET used_count = used_count + 1 WHERE id = ?").run(invite.id);
    db.prepare(
      `INSERT INTO users (unionid, openid_web, nickname, avatar_url, role, invited_by_code_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(pending.unionid, pending.openid, pending.nickname, pending.avatar_url, invite.role, invite.id);
    db.prepare("DELETE FROM pending_identities WHERE id = ?").run(pending.id);
    return findUserByUnionid(pending.unionid);
  });
  let user;
  try { user = register(); } catch (e) { return res.status(400).json({ error: "register failed: " + e.message }); }
  applyInviteDefaults(user.id, invite);   // 邀请码默认视角落为首个 user_view（Task 5 提供实现）
  const pu = loginExisting(res, user);
  res.json({ data: { user: pu } });
});

router.get("/me", requireAuth, (req, res) => res.json({ data: { user: req.user } }));

router.post("/logout", requireAuth, (req, res) => {
  destroySession(parseCookieValue(req, SESSION_COOKIE));
  clearSessionCookie(res, PROD);
  res.json({ success: true });
});

export default router;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run server/routes/auth.test.js`
Expected: PASS ×4（auth 路由 import 了 `../services/viewService.js` 的 `applyInviteDefaults`：本任务先建占位文件 `export function applyInviteDefaults() {}`，Task 5 Step 4 覆盖为完整实现）

- [ ] **Step 5: Commit**

```bash
git add server/routes/auth.js server/routes/auth.test.js server/services/viewService.js
git commit -m "feat(auth): 登录回调/邀请码开通/me/登出 路由与限速"
```

---

### Task 5: user_views 迁移 025 + viewService + /api/views CRUD

**Files:**
- Create: `server/migrations/025_user_views.sql`、`server/services/viewService.js`（替换 Task 4 的空占位实现）、`server/routes/views.js`
- Test: `server/routes/views.test.js`

**Interfaces:**
- Produces: `viewService`: `listViews(userId)`、`createView(userId, {name, filters}) -> {view} | {error}`（≥10 → error "view limit reached (10)"）、`updateView(userId, id, patch) -> {view|null}`、`deleteView(userId, id) -> boolean`、`setDefault(userId, id) -> boolean`、`getView(userId, id)`、`applyInviteDefaults(userId, inviteRow)`；`/api/views` GET/POST/PUT/:id/DELETE/:id + POST /:id/default（全部 requireAuth，天然 owner 隔离；admin 无特权例外）
- 视角 filters JSON 的键 = `/api/insights` 查询参数名（VIEW-2 已确认）

- [ ] **Step 1: 迁移 025**

```sql
-- server/migrations/025_user_views.sql
CREATE TABLE IF NOT EXISTS user_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  filters TEXT NOT NULL DEFAULT '{}',   -- JSON：GET /api/insights 参数集
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_views_user ON user_views(user_id);
```

- [ ] **Step 2: 写失败测试**

```js
// server/routes/views.test.js
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import db from "../db.js";
import viewsRouter from "./views.js";
import { requireAuth } from "../lib/authMiddleware.js";
import { createSession } from "../lib/sessions.js";
import { clearAuthTables, insertTestUser, listen, makeCookieJar } from "../testUtils.js";
import { applyInviteDefaults } from "../services/viewService.js";

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use("/api/views", requireAuth, viewsRouter);
  return app;
}

async function authedApi(port, path, { method = "GET", body } = {}) {
  const jar = makeCookieJar();
  const token = createSession(userIdForTest, "vitest");
  jar.absorb({ headers: new Headers({ "set-cookie": `eih_session=${token}` }) });
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: jar.header() },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}

let userIdForTest;
describe("/api/views", () => {
  beforeEach(() => {
    clearAuthTables();
    userIdForTest = insertTestUser({ unionid: "vu1" }).id;
  });

  it("create/list/update/delete with owner isolation", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const c = await authedApi(port, "/api/views", { method: "POST", body: { name: "电力日报", filters: { purposes: "tech", businessCategory: "电力" } } });
      expect(c.status).toBe(200);
      const list = await authedApi(port, "/api/views");
      expect(list.body.data.length).toBe(1);
      expect(list.body.data[0].filters.businessCategory).toBe("电力");
      const u = await authedApi(port, `/api/views/${c.body.data.id}`, { method: "PUT", body: { name: "电力氢能" } });
      expect(u.body.data.name).toBe("电力氢能");
      const d = await authedApi(port, `/api/views/${c.body.data.id}`, { method: "DELETE" });
      expect(d.status).toBe(200);
      // 他人视角 404（不泄露存在性）
      const other = insertTestUser({ unionid: "vu2" });
      const token2 = createSession(other.id, "");
      const jar2 = makeCookieJar();
      jar2.absorb({ headers: new Headers({ "set-cookie": `eih_session=${token2}` }) });
      const res = await fetch(`http://127.0.0.1:${port}/api/views/${c.body.data.id}`, { method: "DELETE", headers: { Cookie: jar2.header() } });
      expect(res.status).toBe(404);
    } finally { await close(); }
  });

  it("enforces limit of 10 views", async () => {
    const { port, close } = await listen(buildApp());
    try {
      for (let i = 0; i < 10; i++) await authedApi(port, "/api/views", { method: "POST", body: { name: `v${i}`, filters: {} } });
      const over = await authedApi(port, "/api/views", { method: "POST", body: { name: "v11", filters: {} } });
      expect(over.status).toBe(400);
      expect(over.body.error).toMatch(/limit/i);
    } finally { await close(); }
  });

  it("setDefault keeps exactly one default; invalid", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const a = await authedApi(port, "/api/views", { method: "POST", body: { name: "a", filters: {} } });
      const b = await authedApi(port, "/api/views", { method: "POST", body: { name: "b", filters: {} } });
      await authedApi(port, `/api/views/${a.body.data.id}/default`, { method: "POST" });
      await authedApi(port, `/api/views/${b.body.data.id}/default`, { method: "POST" });
      const list = await authedApi(port, "/api/views");
      const defaults = list.body.data.filter(v => v.is_default);
      expect(defaults.length).toBe(1);
      expect(defaults[0].id).toBe(b.body.data.id);
    } finally { await close(); }
  });

  it("applyInviteDefaults lands invite default_view as first view", () => {
    const invite = { id: 9, default_view: JSON.stringify({ name: "初始视角", filters: { purposes: "policy" } }) };
    applyInviteDefaults(userIdForTest, invite);
    const rows = db.prepare("SELECT * FROM user_views WHERE user_id=?").all(userIdForTest);
    expect(rows.length).toBe(1);
    expect(JSON.parse(rows[0].filters).purposes).toBe("policy");
    expect(rows[0].is_default).toBe(1);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run server/routes/views.test.js`
Expected: FAIL

- [ ] **Step 4: 实现 viewService + views 路由**

```js
// server/services/viewService.js
import db from "../db.js";

const LIMIT = 10;

function parse(row) {
  if (!row) return row;
  let filters = {};
  try { filters = JSON.parse(row.filters || "{}"); } catch { /* keep {} */ }
  return { ...row, filters };
}

export function listViews(userId) {
  return db.prepare("SELECT * FROM user_views WHERE user_id = ? ORDER BY sort_order, id").all(userId).map(parse);
}

export function getView(userId, id) {
  return parse(db.prepare("SELECT * FROM user_views WHERE id = ? AND user_id = ?").get(id, userId));
}

export function createView(userId, { name, filters }) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM user_views WHERE user_id = ?").get(userId).c;
  if (count >= LIMIT) return { error: `view limit reached (${LIMIT})` };
  const cleanName = String(name || "").trim().slice(0, 40);
  if (!cleanName) return { error: "view name required" };
  const isDefault = count === 0 ? 1 : 0;
  const info = db.prepare(
    "INSERT INTO user_views (user_id, name, filters, is_default) VALUES (?, ?, ?, ?)"
  ).run(userId, cleanName, JSON.stringify(filters || {}), isDefault);
  return { view: getView(userId, info.lastInsertRowid) };
}

export function updateView(userId, id, patch) {
  const existing = getView(userId, id);
  if (!existing) return { error: "not found" };
  const name = patch.name != null ? String(patch.name).trim().slice(0, 40) || existing.name : existing.name;
  const filters = patch.filters != null ? JSON.stringify(patch.filters) : existing.filters;
  db.prepare("UPDATE user_views SET name=?, filters=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?")
    .run(name, filters, id, userId);
  return { view: getView(userId, id) };
}

export function deleteView(userId, id) {
  return db.prepare("DELETE FROM user_views WHERE id=? AND user_id=?").run(id, userId).changes > 0;
}

export function setDefault(userId, id) {
  if (!getView(userId, id)) return false;
  const tx = db.transaction(() => {
    db.prepare("UPDATE user_views SET is_default=0 WHERE user_id=?").run(userId);
    db.prepare("UPDATE user_views SET is_default=1 WHERE id=? AND user_id=?").run(id, userId);
  });
  tx();
  return true;
}

// 邀请码开通时落首个视角（有 default_view 才建）
export function applyInviteDefaults(userId, inviteRow) {
  if (!inviteRow?.default_view) return;
  let dv;
  try { dv = JSON.parse(inviteRow.default_view); } catch { return; }
  if (!dv || typeof dv !== "object") return;
  createView(userId, { name: dv.name || "初始视角", filters: dv.filters || {} });
  const first = db.prepare("SELECT id FROM user_views WHERE user_id=? ORDER BY id LIMIT 1").get(userId);
  if (first) setDefault(userId, first.id);
}
```

```js
// server/routes/views.js
import { Router } from "express";
import { listViews, createView, updateView, deleteView, setDefault, getView } from "../services/viewService.js";

const router = Router();

router.get("/", (req, res) => res.json({ data: listViews(req.user.id) }));
router.post("/", (req, res) => {
  const r = createView(req.user.id, req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ data: r.view });
});
router.put("/:id", (req, res) => {
  const r = updateView(req.user.id, Number(req.params.id), req.body || {});
  if (r.error === "not found") return res.status(404).json({ error: "not found" });
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ data: r.view });
});
router.delete("/:id", (req, res) => {
  if (!deleteView(req.user.id, Number(req.params.id))) return res.status(404).json({ error: "not found" });
  res.json({ success: true });
});
router.post("/:id/default", (req, res) => {
  if (!setDefault(req.user.id, Number(req.params.id))) return res.status(404).json({ error: "not found" });
  res.json({ data: getView(req.user.id, Number(req.params.id)) });
});

export default router;
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run server/routes/views.test.js server/routes/auth.test.js`
Expected: PASS（auth 的占位 applyInviteDefaults 换成真实实现后仍过）

- [ ] **Step 6: Commit**

```bash
git add server/migrations/025_user_views.sql server/services/viewService.js server/routes/views.js server/routes/views.test.js
git commit -m "feat(views): user_views 迁移、viewService 与 CRUD 路由（上限10）"
```

---

### Task 6: 全局挂载鉴权 + 管理面 requireAdmin + cors/credentials

**Files:**
- Modify: `server/index.js`、`server/routes/admin.js`（新建：users/invite-codes 管理路由）、`server/routes/admin.test.js`
- Test: `server/routes/admin.test.js`

**Interfaces:**
- Consumes: Task 2 中间件；Task 4 auth 路由
- Produces: `/api/admin/users` GET/PATCH/:id（role/status）、`/api/admin/invite-codes` GET/POST/PATCH/:id/DELETE… （**停用=active=0，不物理删除**）；`GET /api/admin/users/:id/resources`（ADM-3 只读计数）；index.js 组装顺序：`/api/auth`、`/api/health` 免鉴权，其余全部 `requireAuth`，管理类再叠 `requireAdmin`

- [ ] **Step 1: 写失败测试**

```js
// server/routes/admin.test.js
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import db from "../db.js";
import adminRouter from "./admin.js";
import { requireAuth, requireAdmin } from "../lib/authMiddleware.js";
import { createSession } from "../lib/sessions.js";
import { clearAuthTables, insertTestUser, listen, makeCookieJar } from "../testUtils.js";

const app = express();
app.use(express.json());
app.use("/api/admin", requireAuth, requireAdmin, adminRouter);

async function call(port, path, userId, { method = "GET", body } = {}) {
  const token = createSession(userId, "");
  const jar = makeCookieJar();
  jar.absorb({ headers: new Headers({ "set-cookie": `eih_session=${token}` }) });
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: jar.header() },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("/api/admin (requireAdmin)", () => {
  let admin, user;
  beforeEach(() => {
    clearAuthTables();
    admin = insertTestUser({ unionid: "adm", role: "admin" });
    user = insertTestUser({ unionid: "std" });
  });

  it("rejects plain user with 403 and anonymous with 401", async () => {
    const { port, close } = await listen(app);
    try {
      expect((await call(port, "/api/admin/users", user.id)).status).toBe(403);
      const res = await fetch(`http://127.0.0.1:${port}/api/admin/users`);
      expect(res.status).toBe(401);
    } finally { await close(); }
  });

  it("lists users, patches role/status, never deletes rows", async () => {
    const { port, close } = await listen(app);
    try {
      const list = await call(port, "/api/admin/users", admin.id);
    expect(list.body.data.map(u => u.unionid).sort()).toEqual(["adm", "std"]);
      const patch = await call(port, `/api/admin/users/${user.id}`, admin.id, { method: "PATCH", body: { status: "disabled" } });
      expect(patch.body.data.status).toBe("disabled");
      expect(db.prepare("SELECT COUNT(*) c FROM users").get().c).toBe(2); // 保留数据（OQ-5）
    } finally { await close(); }
  });

  it("creates invite code, deactivates (no hard delete)", async () => {
    const { port, close } = await listen(app);
    try {
      const c = await call(port, "/api/admin/invite-codes", admin.id, {
        method: "POST", body: { code: "NEW01", role: "user", max_uses: 5, note: "市场部", default_view: { name: "默认", filters: { purposes: "policy" } } }
      });
      expect(c.status).toBe(200);
      expect(c.body.data.default_view).toContain("policy");
      const d = await call(port, `/api/admin/invite-codes/${c.body.data.id}`, admin.id, { method: "PATCH", body: { active: 0 } });
      expect(d.body.data.active).toBe(0);
      expect(db.prepare("SELECT COUNT(*) c FROM invite_codes WHERE code='NEW01'").get().c).toBe(1);
    } finally { await close(); }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run server/routes/admin.test.js`
Expected: FAIL（Cannot find module ./admin.js）

- [ ] **Step 3: 实现 admin 路由**

```js
// server/routes/admin.js
import crypto from "node:crypto";
import { Router } from "express";
import db from "../db.js";

const router = Router();

// ADM-3 资源计数：M1 阶段 024/025 部分列可能尚未合入，按表 try/catch 返回 null，Task 8 合入后自动出数
function countSafe(sql, id) {
  try { return db.prepare(sql).get(id).c; } catch { return null; }
}
function publicUser(u) {
  return { ...u, resource_counts: {
    reports: countSafe("SELECT COUNT(*) c FROM reports WHERE owner_id=?", u.id),
    templates: countSafe("SELECT COUNT(*) c FROM report_templates WHERE owner_id=?", u.id),
    views: countSafe("SELECT COUNT(*) c FROM user_views WHERE user_id=?", u.id)
  }};
}

router.get("/users", (_req, res) => {
  res.json({ data: db.prepare("SELECT * FROM users ORDER BY created_at DESC").all().map(publicUser) });
});

router.patch("/users/:id", (req, res) => {
  const target = db.prepare("SELECT * FROM users WHERE id=?").get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: "not found" });
  const role = req.body.role;           // 'admin' | 'user'
  const status = req.body.status;       // 'active' | 'disabled'（禁用=挡登录，数据保留）
  if (role != null && !["admin", "user"].includes(role)) return res.status(400).json({ error: "bad role" });
  if (status != null && !["active", "disabled"].includes(status)) return res.status(400).json({ error: "bad status" });
  if (role != null) db.prepare("UPDATE users SET role=? WHERE id=?").run(role, target.id);
  if (status != null) {
    db.prepare("UPDATE users SET status=? WHERE id=?").run(status, target.id);
    if (status === "disabled") db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id); // 踢下线，非删业务数据
  }
  res.json({ data: db.prepare("SELECT * FROM users WHERE id=?").get(target.id) });
});

router.get("/invite-codes", (_req, res) => {
  res.json({ data: db.prepare("SELECT * FROM invite_codes ORDER BY created_at DESC").all() });
});

router.post("/invite-codes", (req, res) => {
  const b = req.body || {};
  const code = String(b.code || "").trim().toUpperCase() || ("INV" + crypto.randomBytes(3).toString("hex").toUpperCase());
  if (db.prepare("SELECT 1 FROM invite_codes WHERE code=?").get(code)) return res.status(400).json({ error: "code exists" });
  const dv = b.default_view ? JSON.stringify(b.default_view) : null;
  const info = db.prepare(
    `INSERT INTO invite_codes (code, label, role, default_view, max_uses, expires_at, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(code, String(b.label || ""), ["admin","user"].includes(b.role) ? b.role : "user", dv,
        b.max_uses == null ? null : Number(b.max_uses) || null, b.expires_at || null,
        String(b.note || ""), req.user.id);
  res.json({ data: db.prepare("SELECT * FROM invite_codes WHERE id=?").get(info.lastInsertRowid) });
});

router.patch("/invite-codes/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM invite_codes WHERE id=?").get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "not found" });
  if (req.body.active != null) db.prepare("UPDATE invite_codes SET active=? WHERE id=?").run(req.body.active ? 1 : 0, row.id);
  if (req.body.note != null) db.prepare("UPDATE invite_codes SET note=? WHERE id=?").run(String(req.body.note), row.id);
  res.json({ data: db.prepare("SELECT * FROM invite_codes WHERE id=?").get(row.id) });
});

router.get("/invite-codes/:id/usages", (req, res) => {
  res.json({ data: db.prepare("SELECT id, unionid, nickname, created_at FROM users WHERE invited_by_code_id=?").all(Number(req.params.id)) });
});

export default router;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run server/routes/admin.test.js`
Expected: PASS ×3（admin.test 依赖 reports/report_templates/user_views——`countSafe` 已按表 try/catch 兜底：024/025 未合入时 `resource_counts` 对应项为 null，测试不断言该字段，故本任务可独立通过；Task 8 合入 024 后计数自动出数）

- [ ] **Step 5: server/index.js 组装**

修改 `server/index.js`：

```js
// import 区新增：
import authRouter from "./routes/auth.js";
import viewsRouter from "./routes/views.js";
import adminRouter from "./routes/admin.js";
import { requireAuth, requireAdmin } from "./lib/authMiddleware.js";

// 替换 cors 初始化（保留 credentials 以便 LAN 直连调试）：
app.use(cors({ credentials: true }));

// 路由挂载区改为：
app.use("/api/auth", authRouter);
app.use("/api/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() })); // 从 app.get 挪来，保持一致
app.use("/api/views", requireAuth, viewsRouter);
app.use("/api/admin", requireAuth, requireAdmin, adminRouter);
// 以下全部加 requireAuth（管理配置面再叠 requireAdmin）：
app.use("/api/sources", requireAuth, requireAdmin, sourcesRouter);
app.use("/api/insights", requireAuth, insightsRouter);            // DELETE /:id 在路由内部再校验 requireAdmin
app.use("/api/reports", requireAuth, reportsRouter);
app.use("/api/tracker", requireAuth, requireAdmin, trackerRouter);
app.use("/api/tracker-settings", requireAuth, requireAdmin, settingsRouter);
app.use("/api/filters", requireAuth, filtersRouter);               // 写操作在路由内叠 requireAdmin（见 Step 6）
app.use("/api/feedback", requireAuth, feedbackRoutes);
app.use("/api/industries", requireAuth, industriesRouter);         // 写操作路由内叠 requireAdmin
app.use("/api/models", requireAuth, requireAdmin, modelsRouter);
app.use("/api/search-providers", requireAuth, requireAdmin, searchProvidersRouter);
app.use("/api/ai", requireAuth, aiRouter);
// 原 app.get("/api/health") 删除，避免重复。
```

`insights.js` 删除路由内加角色校验（其余 admin-only 写操作同款处理）：

```js
// server/routes/insights.js 顶部 import：
import { requireAdmin } from "../lib/authMiddleware.js";
// router.delete("/:id", ...) 改为 router.delete("/:id", requireAdmin, ...)
```

`filters.js` / `industries.js`：对全部 POST/PUT/DELETE/PATCH 子路由加 `requireAdmin`（GET 保持所有登录用户可读——ContentFiltersPage 主体高亮需要读 rules，前端另按角色隐藏入口）。

- [ ] **Step 6: 全量回归 + 手工冒烟（测试环境）**

Run: `npx vitest run`
Expected: 全部 PASS（既有用例不受影响：settings.test 用裸 app 不经过 index.js）

冒烟：`AUTH_DEV_MODE=wechat-mock npm run dev`；浏览器 `/login` 走 dev-login（Task 7 前端完成后联测）；未登录 `curl http://localhost:3001/api/insights` → 401；`/api/health` → 200。

- [ ] **Step 7: Commit**

```bash
git add server/routes/admin.js server/routes/admin.test.js server/index.js server/routes/insights.js server/routes/filters.js server/routes/industries.js
git commit -m "feat(auth): 全局鉴权挂载、requireAdmin 收紧配置面、admin 用户/邀请码路由"
```

---

### Task 7: M1 前端 —— 登录门 + 用户态 + 角色显隐

**Files:**
- Create: `src/components/LoginGate.jsx`
- Modify: `src/utils/backendApi.js`（credentials + auth 方法）、`src/App.jsx`、`src/components/Header.jsx`、`src/components/Sidebar.jsx`、`src/constants/i18n.js`

**Interfaces:**
- Produces: `backendApi.getAuthConfig/devLogin/wechatRegister/me/logout`；App 状态 `user`（`null | {id,unionid,nickname,avatar_url,role}`）与 `authUnknown`；`LoginGate` props `{ onLoggedIn }`
- 路由语义：`/login` hash `#invite=<ticket>` → 邀请码输入态；`#disabled` → 提示态；其余未登录 → 扫码等待态

- [ ] **Step 1: backendApi 支持凭据与新端点**

```js
// src/utils/backendApi.js request() 的 fetch options 增加：
credentials: "include",
// 对象末尾追加：
getAuthConfig: () => request("/auth/config"),
devLogin: (devUnionid) => request("/auth/dev-login", { method: "POST", body: JSON.stringify({ devUnionid }) }),
registerWithInvite: (ticket, code) => request("/auth/register", { method: "POST", body: JSON.stringify({ ticket, code }) }),
me: () => request("/auth/me"),
logout: () => request("/auth/logout", { method: "POST" }),
getAdminUsers: () => request("/admin/users"),
patchAdminUser: (id, patch) => request(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
getInviteCodes: () => request("/admin/invite-codes"),
createInviteCode: (data) => request("/admin/invite-codes", { method: "POST", body: JSON.stringify(data) }),
patchInviteCode: (id, patch) => request(`/admin/invite-codes/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
getViews: () => request("/views"),
createView: (name, filters) => request("/views", { method: "POST", body: JSON.stringify({ name, filters }) }),
updateView: (id, patch) => request(`/views/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
deleteView: (id) => request(`/views/${id}`, { method: "DELETE" }),
setDefaultView: (id) => request(`/views/${id}/default`, { method: "POST" }),
```

- [ ] **Step 2: App.jsx 用户态与登录门**

`App.jsx` 顶部加 `const [user, setUser] = useState(null); const [authReady, setAuthReady] = useState(false);`；`useEffect` 首帧：

```js
useEffect(() => {
  backendApi.me()
    .then(r => setUser(r.data.user))
    .catch(() => setUser(null))
    .finally(() => setAuthReady(true));
}, []);
```

- `authReady === false` → 渲染空白/加载点（避免闪登录页）。
- `authReady && !user` → **只渲染 `<LoginGate onLoggedIn={u => setUser(u)} />`**，不渲染现有整壳（其余数据加载 useEffect 移到 user 就绪后再执行：给原 `useEffect(..., [])` 加 `if (!user) return;` 守卫并改依赖 `[user?.id]`）。
- 渲染区把 `user` 下传：`<Header ... user={user} onLogout={...} />`、`<Sidebar ... role={user.role} />`、`<ConfigurationPage ... user={user} />`。
- 登出：`await backendApi.logout(); setUser(null);`

- [ ] **Step 3: LoginGate 组件（mock 与真实双态）**

```jsx
// src/components/LoginGate.jsx
import { useEffect, useState } from "react";
import { backendApi } from "../utils/backendApi";
import { storage } from "../utils/storage";
import { i18n } from "../constants/i18n";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";

const inputStyle = {
  padding: "10px 12px", borderRadius: BORDER_RADIUS.md, border: `1px solid ${COLORS.border.light}`,
  fontSize: FONT_SIZES.md, width: "100%", boxSizing: "border-box"
};
const btnStyle = {
  padding: "11px 14px", borderRadius: BORDER_RADIUS.md, border: "none", background: COLORS.primary,
  color: "#fff", fontSize: FONT_SIZES.md, fontWeight: 600, cursor: "pointer", transition: `all ${TRANSITIONS.fast}`
};

export default function LoginGate({ onLoggedIn }) {
  // 登录页在 user 之前渲染，语言独立取 storage（缺省 en），键缺失回退 i18n.en
  const a = (i18n[storage.getStoredLanguage() || "en"] || i18n.en).auth;
  const [config, setConfig] = useState(null);
  const [error, setError] = useState("");
  const [unionid, setUnionid] = useState("dev-me");
  const [code, setCode] = useState("");

  const hash = window.location.hash;
  const mode = hash === "#disabled" ? "disabled" : hash.startsWith("#invite=") ? "invite" : "waiting";
  const ticket = hash.replace("#invite=", "");

  useEffect(() => {
    backendApi.getAuthConfig()
      .then(r => setConfig(r.data))
      .catch(() => setConfig({ mockMode: false, authorizeUrl: null }));
  }, []);

  const handle = (res) => {
    const d = res.data;
    if (d.status === "active") return onLoggedIn(d.user);
    if (d.status === "need_invite") { window.location.hash = `#invite=${d.ticket}`; return; }
    if (d.status === "disabled") { window.location.hash = "#disabled"; }
  };
  const devLogin = async () => {
    setError("");
    try { handle(await backendApi.devLogin(unionid)); } catch (e) { setError(e.message); }
  };
  const register = async () => {
    setError("");
    try { const res = await backendApi.registerWithInvite(ticket, code.trim()); onLoggedIn(res.data.user); }
    catch (e) { setError(a.inviteError); }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8f8fc",
      fontFamily: "'Inter','PingFang SC','Microsoft YaHei',system-ui,sans-serif"
    }}>
      <div style={{
        width: 380, padding: 28, background: "#fff", borderRadius: BORDER_RADIUS.lg,
        border: `1px solid ${COLORS.border.light}`, boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
        display: "flex", flexDirection: "column", gap: 16
      }}>
        <div style={{ fontSize: FONT_SIZES["2xl"], fontWeight: 700, color: COLORS.text.primary, textAlign: "center" }}>
          {a.loginTitle}
        </div>

        {mode === "disabled" && (
          <p style={{ color: "#c0392b", textAlign: "center", margin: 0 }}>{a.disabled}</p>
        )}

        {mode === "waiting" && config && (
          config.mockMode ? (
            <>
              <input value={unionid} onChange={e => setUnionid(e.target.value)} placeholder={a.devPlaceholder} style={inputStyle} />
              <button onClick={devLogin} style={btnStyle}>{a.devLogin}</button>
            </>
          ) : config.authorizeUrl ? (
            <button onClick={() => { window.location.href = config.authorizeUrl; }} style={btnStyle}>{a.wechatLogin}</button>
          ) : (
            <p style={{ color: COLORS.text.secondary, textAlign: "center", margin: 0 }}>{a.notConfigured}</p>
          )
        )}

        {mode === "invite" && (
          <>
            <p style={{ color: COLORS.text.secondary, textAlign: "center", margin: 0 }}>{a.inviteTitle}</p>
            <input value={code} onChange={e => setCode(e.target.value)} placeholder={a.invitePlaceholder} style={inputStyle} />
            {error && <p style={{ color: "#c0392b", margin: 0, fontSize: FONT_SIZES.sm, textAlign: "center" }}>{error}</p>}
            <button onClick={register} style={btnStyle}>{a.inviteSubmit}</button>
          </>
        )}
      </div>
    </div>
  );
}
```

> LoginGate 的 JSX 渲染体按上述注释补全（waiting/invite/disabled/error 四态 + mock 登录表单），禁止返回 null 交付。

- [ ] **Step 4: Header 用户区 + Sidebar 角色过滤**

```jsx
// src/components/Header.jsx props 加 user, onLogout；右侧渲染：
{user && (
  <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: FONT_SIZES.md, color: darkMode ? "#e8e8e8" : COLORS.text.primary }}>
    {user.avatar_url ? <img src={user.avatar_url} style={{ width: 28, height: 28, borderRadius: "50%" }} alt="" /> : null}
    <span>{user.nickname}{user.role === "admin" ? " · " + (language === "zh" ? "管理员" : "Admin") : ""}</span>
    <button onClick={onLogout} style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.text.secondary }}>
      {language === "zh" ? "登出" : "Logout"}
    </button>
  </span>
)}
```

```jsx
// src/components/Sidebar.jsx：MENU_ITEMS 不变，渲染处过滤：
{MENU_ITEMS.filter(item => item.key !== "configuration" || role === "admin")
  .map(item => { /* 原渲染逻辑不动 */ })}
// props 增加 role；调用方 App.jsx 传 role={user.role}
```

- [ ] **Step 5: i18n 词条**

`src/constants/i18n.js` zh/en 各加（键挂在顶层新对象 `auth` 与 `views`，后续任务复用）：

```js
// zh
auth: { loginTitle: "登录混沌能源智库", wechatLogin: "微信扫码登录", inviteTitle: "输入邀请码开通账号",
  invitePlaceholder: "邀请码", inviteSubmit: "开通", disabled: "账号已被停用，请联系管理员",
  logout: "登出", adminBadge: "管理员", devLogin: "本地开发登录（仅测试）", devPlaceholder: "devUnionid（本地）",
  notConfigured: "微信登录未配置（缺 WECHAT_APP_ID / REDIRECT_URI）", inviteError: "邀请码无效或已用完" },
views: { toggleLabel: "自定义视角", myViews: "我的视角", saveAsView: "保存为视角",
  viewLimit: "视角数量已达上限（10 个），请先删除旧视角", driftHint: "当前筛选已偏离视角，是否更新视角？",
  backToPublic: "回到公共池", updateView: "更新视角", deleteView: "删除视角", setDefault: "设为默认" }
// en 对应英文翻译（loginTitle: "Sign in to Energy Insights Hub", ... 逐键补齐）
```

- [ ] **Step 6: 冒烟验证（测试环境全流程）**

Run: `AUTH_DEV_MODE=wechat-mock npm run dev`
浏览器 `http://localhost:5177`：
1. 出登录门；输入 `dev-me` 登录 → 邀请码页（若已建码）或直接 blocked；
2. dev 终端 `sqlite3 data/energy_insights.db "INSERT INTO invite_codes(code,role) VALUES('TEST01','user')"` → 输 `TEST01` 开通成功进情报页；
3. 刷新再进：免邀请码直登；
4. 登出 → 回到登录门。
Expected: 四步全部符合；`npx vitest run` 仍全绿。

- [ ] **Step 7: Commit**

```bash
git add src/components/LoginGate.jsx src/utils/backendApi.js src/App.jsx src/components/Header.jsx src/components/Sidebar.jsx src/constants/i18n.js
git commit -m "feat(auth): 前端登录门/邀请码开通/用户态与角色显隐"
```

**M1 交付判定（对齐 PRD 3.14）：** 新用户凭邀请码开通→登录→再入免码 ✅；未登录 `/api/*` 全 401（health 除外）✅；user 调 admin 配置面 403 ✅。

---

### Task 7b: 管理界面 —— 用户管理 & 邀请码管理（ADM-1 / ADM-2）

**Files:**
- Create: `src/components/admin/UsersPage.jsx`、`src/components/admin/InviteCodesPage.jsx`
- Modify: `src/components/ConfigurationPage.jsx`（TABS 增两项、渲染分支、`user` prop 下传）、`src/constants/i18n.js`（`admin` 命名空间）

**Interfaces:**
- Consumes: Task 6 backendApi `getAdminUsers/patchAdminUser/getInviteCodes/createInviteCode/patchInviteCode`；Task 7 传入的 `user`（ConfigurationPage 现签名无 `user`，本任务补）
- Produces: `ConfigurationPage({ darkMode, language, onTrackerComplete, titleSlotEl, user })`；仅 `user.role === "admin"` 时可见 users / invites 两个子标签

- [ ] **Step 1: UsersPage（列表 + 角色/启停切换）**

```jsx
// src/components/admin/UsersPage.jsx
import { useEffect, useState } from "react";
import { backendApi } from "../../utils/backendApi";
import { COLORS, FONT_SIZES, BORDER_RADIUS } from "../../constants/theme";

export default function UsersPage({ darkMode, language }) {
  const zh = language === "zh";
  const [users, setUsers] = useState([]);
  const [err, setErr] = useState("");
  const load = () => backendApi.getAdminUsers().then(r => setUsers(r.data)).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);

  const patch = async (id, body) => {
    try { await backendApi.patchAdminUser(id, body); load(); } catch (e) { setErr(e.message); }
  };
  const card = { padding: 16, borderRadius: BORDER_RADIUS.md, background: darkMode ? COLORS.background.cardDark : COLORS.background.card, border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}` };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {err && <p style={{ color: "#c0392b", margin: 0 }}>{err}</p>}
      {users.map(u => (
        <div key={u.id} style={{ ...card, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, color: darkMode ? "#e8e8e8" : COLORS.text.primary }}>{u.nickname || u.unionid}</span>
          <span style={{ color: COLORS.text.secondary, fontSize: FONT_SIZES.sm }}>{u.role === "admin" ? (zh ? "管理员" : "Admin") : (zh ? "普通用户" : "User")}</span>
          {u.status === "disabled" && <span style={{ color: "#c0392b", fontSize: FONT_SIZES.sm }}>{zh ? "已停用" : "Disabled"}</span>}
          <span style={{ color: COLORS.text.secondary, fontSize: FONT_SIZES.sm }}>
            {zh
              ? `报告 ${u.resource_counts?.reports ?? 0} · 模板 ${u.resource_counts?.templates ?? 0} · 视角 ${u.resource_counts?.views ?? 0}`
              : `Reports ${u.resource_counts?.reports ?? 0} · Templates ${u.resource_counts?.templates ?? 0} · Views ${u.resource_counts?.views ?? 0}`}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button style={{ padding: "6px 10px", borderRadius: 6, border: "none", background: COLORS.primaryLight, cursor: "pointer" }}
              onClick={() => patch(u.id, { role: u.role === "admin" ? "user" : "admin" })}>{zh ? "切换角色" : "Toggle role"}</button>
            <button style={{ padding: "6px 10px", borderRadius: 6, border: "none", background: u.status === "active" ? "#c0392b" : COLORS.primary, color: "#fff", cursor: "pointer" }}
              onClick={() => patch(u.id, { status: u.status === "active" ? "disabled" : "active" })}>{u.status === "active" ? (zh ? "停用" : "Disable") : (zh ? "启用" : "Enable")}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: InviteCodesPage（列表 + 创建/停用；default_view 由视角 JSON 文本框录入）**

```jsx
// src/components/admin/InviteCodesPage.jsx
import { useEffect, useState } from "react";
import { backendApi } from "../../utils/backendApi";
import { COLORS, FONT_SIZES, BORDER_RADIUS } from "../../constants/theme";

const EMPTY = { code: "", label: "", role: "user", max_uses: "", expires_at: "", note: "", default_view: "" };

export default function InviteCodesPage({ darkMode, language }) {
  const zh = language === "zh";
  const [codes, setCodes] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [err, setErr] = useState("");
  const load = () => backendApi.getInviteCodes().then(r => setCodes(r.data)).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);

  const create = async () => {
    setErr("");
    const payload = {
      code: form.code.trim() || undefined,           // 空 → 后端自动生成 INVxxxxxx
      label: form.label, role: form.role, note: form.note,
      max_uses: form.max_uses === "" ? null : Number(form.max_uses),
      expires_at: form.expires_at || null,
      default_view: form.default_view.trim() ? safeParse(form.default_view) : null
    };
    if (payload.default_view === false) { setErr(zh ? "默认视角 JSON 不合法" : "invalid default_view JSON"); return; }
    try { await backendApi.createInviteCode(payload); setForm(EMPTY); load(); } catch (e) { setErr(e.message); }
  };
  const deactivate = async (id) => { try { await backendApi.patchInviteCode(id, { active: 0 }); load(); } catch (e) { setErr(e.message); } };
  const inp = { padding: "8px 10px", borderRadius: 6, border: `1px solid ${COLORS.border.light}`, fontSize: FONT_SIZES.md };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input style={inp} placeholder={zh ? "码(留空自动生成)" : "code (blank=auto)"} value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} />
        <input style={inp} placeholder={zh ? "标签" : "label"} value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} />
        <select style={inp} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
          <option value="user">{zh ? "普通用户" : "user"}</option><option value="admin">{zh ? "管理员" : "admin"}</option>
        </select>
        <input style={{ ...inp, width: 90 }} placeholder={zh ? "次数上限" : "max uses"} value={form.max_uses} onChange={e => setForm({ ...form, max_uses: e.target.value })} />
        <input style={inp} type="date" value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })} />
        <button onClick={create} style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: COLORS.primary, color: "#fff", cursor: "pointer" }}>{zh ? "新建邀请码" : "Create"}</button>
      </div>
      <textarea style={{ ...inp, minHeight: 60 }} placeholder={zh ? '默认视角 JSON，如 {"name":"电力","filters":{"purposes":"tech"}}' : 'default_view JSON'} value={form.default_view} onChange={e => setForm({ ...form, default_view: e.target.value })} />
      {err && <p style={{ color: "#c0392b", margin: 0 }}>{err}</p>}
      {codes.map(c => (
        <div key={c.id} style={{ padding: 12, borderRadius: BORDER_RADIUS.md, border: `1px solid ${COLORS.border.light}`, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", opacity: c.active ? 1 : 0.5 }}>
          <code style={{ fontWeight: 700 }}>{c.code}</code>
          <span style={{ color: COLORS.text.secondary, fontSize: FONT_SIZES.sm }}>{c.role}{c.label ? ` · ${c.label}` : ""} · {c.used_count}/{c.max_uses ?? (zh ? "不限" : "∞")}{c.expires_at ? ` · ${zh ? "到期" : "exp"} ${String(c.expires_at).slice(0, 10)}` : ""}</span>
          {c.active === 1 && <button onClick={() => deactivate(c.id)} style={{ marginLeft: "auto", padding: "6px 10px", borderRadius: 6, border: "none", background: "#c0392b", color: "#fff", cursor: "pointer" }}>{zh ? "停用" : "Deactivate"}</button>}
        </div>
      ))}
    </div>
  );
}
function safeParse(s) { try { return JSON.parse(s); } catch { return false; } }
```

- [ ] **Step 3: 接线 ConfigurationPage**

- props 改签名：`export default function ConfigurationPage({ darkMode, language, onTrackerComplete, titleSlotEl, user })`（App.jsx 渲染处补 `user={user}`）。
- `TABS` 数组末尾追加：`{ key: "users", icon: "☺", labelKey: "usersTab" }`、`{ key: "invites", icon: "⌘", labelKey: "invitesTab" }`。
- 渲染 TABS 处（约 :301 `TABS.map`）改为 `{TABS.filter(item => ["users","invites"].includes(item.key) ? user?.role === "admin" : true).map(...)}`。
- tab 内容区（约 :412 feedback 分支后）追加：`{tab === "users" && <UsersPage darkMode={darkMode} language={language} />}`、`{tab === "invites" && <InviteCodesPage darkMode={darkMode} language={language} />}`；顶部 import 两个组件。

- [ ] **Step 4: i18n `admin` 命名空间 + 两个 tab 标签**

`competitiveIntelligence`（TABS labelKey 取处）加 `usersTab: "用户管理"/"Users"`、`invitesTab: "邀请码"/"Invite Codes"`。

- [ ] **Step 5: 冒烟 + 提交**

Run: `AUTH_DEV_MODE=wechat-mock npm run dev`；`ADMIN_UNIONID=dev-boss` seed 管理员登录 → 配置页出现「用户管理/邀请码」→ 新建一个 user 角色邀请码 → 用 `dev-alice` 走邀请码开通 → 回用户管理给 Alice 切角色/停用（停用后 Alice 再登录应命中 disabled 页）；Alice 数据不删。

```bash
git add src/components/admin/UsersPage.jsx src/components/admin/InviteCodesPage.jsx src/components/ConfigurationPage.jsx src/App.jsx src/constants/i18n.js
git commit -m "feat(admin): 用户管理与邀请码管理界面（ADM-1/ADM-2）"
```

---

## Phase M2 — 报告/模板归属隔离

### Task 8: 迁移 024（owner_id + 存量归 seed admin）

**Files:**
- Create: `server/migrations/024_resource_ownership.sql`
- Test: `server/migrations/024_resource_ownership.test.js`

**Interfaces:**
- Produces: `reports.owner_id`、`report_jobs.owner_id`、`report_templates.owner_id`、`user_feedback.user_id`、`user_feedback.submit_state`、`feedback_rules_suggestions.submitter_id`；存量行 owner=子查询 `IFNULL((SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1), NULL)`

- [ ] **Step 1: 写测试**：initDb 后断言六列存在（`PRAGMA table_info`），且 `report_templates.is_public=1` 行为不变。
- [ ] **Step 2: 确认失败** `npx vitest run server/migrations/024_resource_ownership.test.js`
- [ ] **Step 3: 迁移 SQL**（better-sqlite3 支持 `ALTER TABLE ... ADD COLUMN`；不支持 IF NOT EXISTS，靠 `_migrations` 保证单次执行）

```sql
-- server/migrations/024_resource_ownership.sql
ALTER TABLE reports ADD COLUMN owner_id INTEGER;
ALTER TABLE report_jobs ADD COLUMN owner_id INTEGER;
ALTER TABLE report_templates ADD COLUMN owner_id INTEGER;
ALTER TABLE user_feedback ADD COLUMN user_id INTEGER;
ALTER TABLE user_feedback ADD COLUMN submit_state TEXT NOT NULL DEFAULT 'none'
  CHECK(submit_state IN ('none','submitted','accepted','rejected'));
ALTER TABLE feedback_rules_suggestions ADD COLUMN submitter_id INTEGER;

UPDATE reports            SET owner_id = (SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1);
UPDATE report_jobs        SET owner_id = (SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1);
UPDATE report_templates   SET owner_id = (SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1);
UPDATE user_feedback      SET user_id  = (SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1);
```

（注：`feedback_semantic_weights` 019 后有 `purpose` 列差异不影响本迁移；执行顺序 023→024→025，runner 按文件名排序，`024` 晚于 `023` 用户表已就绪。）

- [ ] **Step 4: 测试通过** - [ ] **Step 5: Commit** `feat(owner): 024 资源归属迁移（存量归 seed admin）`

---

### Task 9: reports 路由归属过滤 + admin 全量视图

**Files:**
- Modify: `server/routes/reports.js`、`server/services/reportGenerator.js`（createReportJob 落 owner_id）、`server/services/reportTemplateService.js`（listTemplates 支持 owner 语义）、`server/routes/reports.test.js`（既有文件扩展）

**Interfaces:**
- Produces: 路由内 `visibleTemplates(user)`：`is_public=1 OR owner_id=user.id`，admin 全量；列表接口约定 `?scope=all` 仅 admin 生效（每行 JOIN 出 `owner_nickname` 字段，前端直接渲染）；写接口（POST /reports、PUT/DELETE /:id、generate、retry、screening/clarify 的 templateId 校验）非本人 → 404；模板 POST：user 强制 `is_public=0, owner_id=self`；DELETE 公共模板仅 admin；`POST /reports/templates/:id/duplicate`（另存为）
- Consumes: `req.user`（Task 2）

- [ ] **Step 1: 写失败测试（reports.test.js 追加 describe）**

```js
// 断言样例（沿用该文件已有 listen/fetch 辅助；若无则从 server/testUtils.js import）
// 1) user A 列表只见自己：A 建报告 → A GET /api/reports 含之；B GET 不含；admin ?scope=all 含且带 owner.nickname
// 2) B PUT/DELETE A 的报告 → 404
// 3) user 建模板 → is_public=0 且 owner=自己；公共模板 user DELETE → 403（admin DELETE → 200）
// 4) duplicate：user POST /api/reports/templates/:pubId/duplicate → 新行 owner=user, is_public=0, name 带「副本」
// 5) generate：B 对 A 的 reportId 重试 → 404
```

- [ ] **Step 2: 跑测试确认失败** `npx vitest run server/routes/reports.test.js`
- [ ] **Step 3: 实现要点**（每处改动给出目标形态）

```js
// server/routes/reports.js：
// 列表
router.get("/", (req, res) => {
  const all = req.query.scope === "all" && req.user.role === "admin";
  const rows = all
    ? db.prepare(`SELECT r.*, u.nickname AS owner_nickname FROM reports r
                  LEFT JOIN users u ON u.id = r.owner_id ORDER BY r.created_at DESC`).all()
    : db.prepare("SELECT * FROM reports WHERE owner_id = ? ORDER BY created_at DESC").all(req.user.id);
  res.json({ data: rows.map(parseRow) });
});
// 详情/更新/删除统一模式：
const owned = (table, id, user) => {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) return null;
  if (user.role === "admin") return row;
  return row.owner_id === user.id ? row : null;
};
// POST /（保存报告）：INSERT ... owner_id = req.user.id
// POST /generate（reportGenerator.createReportJob）：加参数 ownerId，INSERT reports 带 owner_id、report_jobs 带 owner_id
// 模板：GET /templates 用 visibleTemplates；POST/PUT 模板 user 强制 is_public=0 + owner；DELETE 公共模板非 admin 403；
// POST /templates/:id/duplicate → { data: 新模板 }（name 追加「(副本)/ (Copy)」，owner=req.user.id，is_public=0）
```

```js
// server/services/reportTemplateService.js：listTemplates(user) 过滤：
export function listTemplates(user) {
  if (!user) return db.prepare("SELECT * FROM report_templates ORDER BY id").all();          // admin 全量/兼容旧调用
  if (user.role === "admin") return listTemplates(null);
  return db.prepare("SELECT * FROM report_templates WHERE is_public = 1 OR owner_id = ? ORDER BY id").all(user.id);
}
```

- [ ] **Step 4: 测试通过**（含既有 reports.test.js 用例回归；旧用例如依赖匿名访问，改为先 insertTestUser+session）
- [ ] **Step 5: Commit** `feat(owner): 报告/任务/模板归属隔离与 admin 全量视图、另存为`

---

### Task 10: M2 前端 —— 归属标注与另存为（ReportsPage/模板 tab）

**Files:**
- Modify: `src/components/ReportsPage.jsx`、`src/components/ReportGeneratorModal.jsx`、`src/utils/backendApi.js`、i18n

**Interfaces:**
- Consumes: Task 9 API 语义（`?scope=all`、`owner` 字段、`duplicate`）
- Produces: admin 报告列表每行「归属：{nickname}」+ 按用户筛选下拉；模板卡片「公共/我的/{nickname}」徽标 +「另存为副本」按钮（user 与 admin 均见）；数据加载：user 走默认（后端已隔离），admin 拉 `?scope=all` 并本地过滤

- [ ] **Step 1: backendApi 扩展 + ReportsPage 接线**：

```js
// src/utils/backendApi.js 修改既有条目：
getReports: (all) => request("/reports" + (all ? "?scope=all" : "")),
getReportTemplates: (all) => request("/reports/templates" + (all ? "?scope=all" : "")),
duplicateReportTemplate: (id) => request(`/reports/templates/${id}/duplicate`, { method: "POST" }),
```

（reports 路由的 GET /templates 也需支持 `?scope=all`：非 admin 传入时忽略，返回同默认——Task 9 已实现可见集合，这里仅加透传。）ReportsPage：`loadReports/loadTemplates` 按 `user.role === "admin"` 传 `true`（需把 `user` 或 `role` 传入 ReportsPage：App.jsx 渲染 `<ReportsPage ... role={user.role} />`）；行渲染 owner 徽标（仅 admin，字段 `r.owner_nickname`——Task 9 的 `?scope=all` JOIN 输出）；模板 tab 的「另存为」按钮调 `duplicateReportTemplate(id)` 后刷新列表。
- [ ] **Step 2: ReportGeneratorModal**：`templates` prop 已是过滤后集合（App.jsx 拉取处加 user.role 参数）；无 UI 逻辑变化。
- [ ] **Step 3: i18n**：`ownerLabel: "归属"/"Owner"`、`publicTemplate: "公共"/"Public"`、`mine: "我的"/"Mine"`、`duplicate: "另存为副本"/"Save as copy"`。
- [ ] **Step 4: 冒烟**：dev 模式两个 mock 用户（`dev-me`、`dev-bob`）分别登录——A 只见自己报告；admin（`ADMIN_UNIONID=dev-boss`）见全部带标注；user 对公共模板另存为后可改可删。
- [ ] **Step 5: Commit** `feat(owner): 报告/模板页归属展示与另存为副本`

**M2 交付判定：** user A 不可见 user B 报告与私有模板 ✅；admin 全量+归属标注 ✅；存量数据归 admin 可正常读写 ✅。

---

## Phase M3 — 自定义视角（情报页开关 + 面板 + 报告候选联动）

### Task 11: IntelligencePage 视角开关与管理面板

**Files:**
- Create: `src/components/ViewsBar.jsx`
- Modify: `src/components/IntelligencePage.jsx`（筛选区插入 ViewsBar）、`src/App.jsx`（filters/activeView 状态提升）、`src/components/FilterBar.jsx`（props 不变即可）、i18n（views.* 已在 Task 7 建）

**Interfaces:**
- Consumes: Task 5 `/api/views` CRUD（backendApi 已有 getViews/createView/updateView/deleteView/setDefaultView）
- Produces: App 状态 `activeViewId`（null=公共池）；`filtersToParams(filters)` 复用 `App.jsx` 现有 `fetchInsights` 的 params 组装逻辑（抽为纯函数放 `src/utils/viewFilters.js`：`filtersToParams(filters)`、`viewFiltersToParams(filtersJson)`、`paramsToViewFilters(filters)`）；`viewFromInvite` 无需额外处理（后端开通已落库）

**核心行为（对齐 VIEW-4/5/6/8）：**

- [ ] **Step 1: viewsFilters.js 纯函数 + 单测（无 DOM，前端无测试基建 → 放 server 侧不可行；改为 `npx vitest run` 仅收集 server/**，故本任务纯函数用 node 冒烟脚本验证即可，不留前端测试文件）**

```js
// src/utils/viewFilters.js
export function filtersToView(filters) {
  return {
    purposes: filters.purposes?.length ? filters.purposes.join(",") : undefined,
    businessCategory: filters.businessCategory !== "all" ? filters.businessCategory : undefined,
    subjectCategory: filters.subjectCategory !== "all" ? filters.subjectCategory : undefined,
    enterpriseType: filters.enterpriseType !== "all" ? filters.enterpriseType : undefined,
    sourceType: filters.sourceType !== "all" ? filters.sourceType : undefined,
    search: filters.query || undefined,
    dateRange: filters.dateRange !== "noLimit" ? filters.dateRange : undefined
  };
}
export function viewToFilters(v) {
  return {
    purposes: v.purposes ? v.purposes.split(",") : [],
    businessCategory: v.businessCategory || "all",
    subjectCategory: v.subjectCategory || "all",
    enterpriseType: v.enterpriseType || "all",
    sourceType: v.sourceType || "all",
    query: v.search || "",
    dateRange: v.dateRange || "noLimit"
  };
}
export function isDrift(viewFiltersObj, currentFiltersObj) {
  const a = filtersToView(currentFiltersObj), b = viewFiltersObj || {};
  const norm = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ""));
  return JSON.stringify(norm(a)) !== JSON.stringify(norm({ ...b, purposes: b.purposes ? String(b.purposes) : undefined, dateRange: b.dateRange }));
}
```

- [ ] **Step 2: ViewsBar 组件**：下拉选视角 + 开关（`Switch` 风格按钮，theme 惯例）；开启 → `applyView(view)`：`onFilterChange(viewToFilters(view.filters))` 且 `setActiveViewId(view.id)`；关闭 → `setActiveViewId(null)` 并 `onFilterChange(DEFAULT_FILTERS)`（回公共池不筛选，VIEW-4）；「保存为视角」用当前 filters；开启态改筛选 → `isDrift` 为 true 时顶部条提示「更新视角 / 忽略」。删除设默认按钮走对应 API，成功后刷新列表。超限（后端 400 error match /limit/）toast `t.views.viewLimit`。
- [ ] **Step 3: App.jsx 接线**：`const [activeViewId, setActiveViewId] = useState(null)`；进情报页首拉 `backendApi.getViews()`，若有 `is_default` 且用户未显式关过（localStorage `view_off_${userId}` 未置位）→ 自动启用默认视角（VIEW-5）。`fetchInsights` 不改（视角条件已写入 filters）。
- [ ] **Step 4: 报告候选联动（VIEW-8）**：`onGenerateReport` 打开 Modal 前不改动——候选本来就是当前列表多选 cart，视角已生效，无需新代码；仅验证：开视角 → 勾选范围 ⊂ 视角筛选结果。
- [ ] **Step 5: 冒烟**（mock 两用户各建视角互不可见；开关/默认/偏离提示正确）
- [ ] **Step 6: Commit** `feat(views): 情报页自定义视角开关与管理面板`

**M3 交付判定：** 开/关视角切换正确；VIEW-4/6 优先规则成立 ✅。

---

## Phase M4 — 反馈隔离与提交审批

### Task 12: 反馈路由按角色分流

**Files:**
- Modify: `server/routes/feedback.js`、`server/services/feedbackService.js`、`server/routes/feedback.test.js`（新建或扩展）

**Interfaces:**
- Consumes: `req.user`；既有 `recordFeedback`、`feedback_rules_suggestions`
- Produces:
  - `POST /api/feedback`：`recordFeedback({..., userId: req.user.id})`；**权重与规则建议仅当 `req.user.role === "admin"` 时触发**（FB-2/5）
  - `POST /api/feedback/:insightId/submit` body `{ reason, note }`：user 专属；生成 `feedback_rules_suggestions` 行（`status='pending'`, `submitter_id=req.user.id`, `evidence=note`，`type/name/purpose` 从卡片推断，见实现）并置该卡片最近一条 user_feedback `submit_state='submitted'`
  - `GET /api/feedback/suggestions`：admin 全量 + `submitter_nickname`；user 只见自己提交的（`submitter_id=self`）
  - accept/reject：仅 admin（路由挂载在 index.js 已 requireAuth，这里再叠 requireAdmin）

- [ ] **Step 1: 写失败测试**

```js
// server/routes/feedback.test.js（要点）
// 1) user POST /api/feedback → user_feedback 行含 user_id，且 feedback_semantic_weights COUNT 不变
// 2) admin POST /api/feedback → 权重更新（保持现有行为）
// 3) user POST /api/feedback/:id/submit → suggestions 新增 pending 且 submitter_id 正确；admin GET /suggestions 可见昵称
// 4) user accept 自己的 suggestion → 403/401（按挂载方式）; admin accept → 200 且 filter_rules 写入
```

- [ ] **Step 2: 确认失败** `npx vitest run server/routes/feedback.test.js`
- [ ] **Step 3: 实现**

```js
// server/services/feedbackService.js recordFeedback 签名扩展（新增 opts.userId, opts.isAdmin）：
// - user_feedback INSERT 带 user_id
// - updateWeight/建议生成路径包在 if (isAdmin) 内
// server/routes/feedback.js：
// POST "/"            → recordFeedback({ ...body, userId: req.user.id, isAdmin: req.user.role === "admin" })
// POST "/:insightId/submit" → 校验 insight 存在；INSERT feedback_rules_suggestions
//   (type='exclude_keyword'|'include_keyword', name=<reason 推断>, purpose=<card purpose>, reason, evidence=note, submitter_id=req.user.id, status='pending')
//   UPDATE user_feedback SET submit_state='submitted' WHERE insight_id=? AND user_id=?
// GET  "/suggestions"  → admin 全量 JOIN users 取昵称；非 admin WHERE submitter_id=self
// POST "/suggestions/:id/accept|reject" → 追加 requireAdmin；accept 同步置 submit_state='accepted'（reject → 'rejected'）
```

- [ ] **Step 4: 测试通过**（含既有用例：settings/reports/tracker 全量 `npx vitest run`）
- [ ] **Step 5: Commit** `feat(feedback): 反馈角色分流与提交审批队列`

---

### Task 13: M4 前端 —— 提交入口 + 审阅队列署名

**Files:**
- Modify: `src/components/CardActions.jsx`（hide 弹层加「提交给管理员」+ 补充说明输入，仅 role=user 显示）、`src/components/FeedbackPage.jsx`（admin：建议行显示提交人昵称 + 「来自用户提交」徽标；user 角色不可进）、`src/utils/backendApi.js`（`submitFeedback(insightId, reason, note)`）、i18n（`feedback.submitToAdmin` 等）

**Interfaces:** Consumes Task 12 端点。

- [ ] **Step 1: CardActions**：hide 原因选择后追加 checkbox「提交给管理员审阅」→ `POST /api/feedback/:id/submit`；成功 toast「已提交，管理员审阅后生效」。
- [ ] **Step 2: FeedbackPage**：列表行渲染 `s.submitter_nickname`；accept/reject 沿用现有按钮。
- [ ] **Step 3: 冒烟**：user 提交 → admin Feedback 页见署名 pending → accept → `filter_rules` 出现新规则 → 再跑 tracker 验证生效。
- [ ] **Step 4: Commit** `feat(feedback): 用户反馈提交入口与管理员审阅署名`

**M4 交付判定：** user 反馈不进全局权重 ✅；提交→采纳→filter_rules 生效链路完整 ✅。

---

## Task 14: 收尾 —— 文档、部署与回归

- [ ] **Step 1:** `AGENTS.md` 更新：Key data model 加 users/invite_codes/sessions/user_views 一节；Security considerations 加「鉴权默认开启、AUTH_DEV_MODE 仅非生产、ADMIN_UNIONID seed」；部署节补 `WECHAT_APP_ID/SECRET/REDIRECT_URI` 进 Docker environment（`~/homelab/compose/docker-compose.yml` 由产品负责人手工加，agent 只改仓库文档）。
- [ ] **Step 2:** README 角色说明一节。
- [ ] **Step 3:** 全量回归 `npx vitest run` + lint `npm run lint` 全绿。
- [ ] **Step 4:** 生产切换预案（写进 PRD 3.14 之后作为 Runbook，不改代码）：部署前 `ADMIN_UNIONID` 必须已配置；升级后首个访问必须用 seed 管理员微信登录（存量 owner 归属依赖它）；异常回滚 = 容器指回旧镜像（数据表只增列，向后兼容旧代码）。
- [ ] **Step 5:** Commit `docs: 角色体系文档与部署 runbook`

## 依赖与顺序

```
T1(023) → T2(sessions/mw) → T3(identity) → T4(auth 路由) → T5(views CRUD) → T6(全局挂载+admin) → T7(前端 M1) → T7b(管理界面 ADM)
→ T8(024) → T9(reports owner API) → T10(前端 M2) → T11(前端 M3) → T12(feedback API) → T13(前端 M4) → T14(收尾)
```

外部依赖仅一个：**正式微信凭证（开放平台网站应用，与未来小程序同主体绑定）**——到位前全部任务可用 `AUTH_DEV_MODE=wechat-mock` 完成开发与测试，只把「真实扫码联调」留到凭证就绪后插入（Task 3 的 `exchangeIdentityWechat` 即插点）。
