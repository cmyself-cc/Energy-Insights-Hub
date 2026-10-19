import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import express from "express";
import db from "../db.js";
import adminRouter from "./admin.js";
import { requireAuth, requireAdmin } from "../lib/authMiddleware.js";
import { createSession } from "../lib/sessions.js";
import { clearAuthTables, insertTestUser, listen, makeCookieJar } from "../testUtils.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  // 挂载形状照抄 views.test.js:13：中间件写在 router 之前。
  app.use("/api/admin", requireAuth, requireAdmin, adminRouter);
  return app;
}

// 每个用户一条 session + 一个 jar，全程复用（模拟同一个浏览器），而不是每次请求新建会话。
// beforeEach 里必须 clear：测试库跨进程持久，上一个用例的 token 在 clearAuthTables() 之后就是死的。
const jars = new Map();
function jarFor(userId) {
  if (!jars.has(userId)) {
    const j = makeCookieJar();
    j.absorb({ headers: new Headers({ "set-cookie": `eih_session=${createSession(userId, "vitest")}` }) });
    jars.set(userId, j);
  }
  return jars.get(userId);
}

async function api(port, path, userId, { method = "GET", body } = {}) {
  const j = userId == null ? makeCookieJar() : jarFor(userId);
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(j.header() ? { Cookie: j.header() } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  j.absorb(res);
  // .catch(() => null)：万一 handler 500 成 text/html，失败要呈现为「expected 200, got 500」
  // 而不是 SyntaxError；同时 body 为 null 也能反过来钉住「错误响应必须是 JSON 信封」。
  return { status: res.status, body: await res.json().catch(() => null) };
}

const userRow = (id) => db.prepare("SELECT role, status FROM users WHERE id=?").get(id);
const adminCount = () => db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND status='active'").get().c;
const sessionCount = (id) => db.prepare("SELECT COUNT(*) c FROM sessions WHERE user_id=?").get(id).c;
const codeRow = (code) => db.prepare("SELECT * FROM invite_codes WHERE code=?").get(code);

describe("/api/admin (requireAuth + requireAdmin)", () => {
  let admin, user;

  beforeEach(() => {
    clearAuthTables();
    jars.clear();
    admin = insertTestUser({ unionid: "adm", role: "admin" });
    user = insertTestUser({ unionid: "std" });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  // 测试库在磁盘上跨进程持久：user_views / sessions 都有外键指向 users(id)，而 better-sqlite3
  // 默认 PRAGMA foreign_keys=1，残留行会让后续套件的 DELETE FROM users 炸 FK。
  afterAll(() => { clearAuthTables(); });

  it("rejects a plain user with 403 and an anonymous caller with 401, both as JSON", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const plain = await api(port, "/api/admin/users", user.id);
      expect(plain.status).toBe(403);
      expect(plain.body).toEqual({ error: "forbidden" });   // 不是 text/html

      const anon = await api(port, "/api/admin/users", null);
      expect(anon.status).toBe(401);
      expect(anon.body).toEqual({ error: "unauthorized" });
    } finally { await close(); }
  });

  it("lists users through an explicit whitelist, patches role/status, and never deletes rows", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const list = await api(port, "/api/admin/users", admin.id);
      expect(list.status).toBe(200);
      expect(list.body.data.map((u) => u.unionid).sort()).toEqual(["adm", "std"]);

      // C10：管理面用显式白名单，不是 {...u} 全量展开。openid_web/openid_mp 是身份提供商的
      // 内部标识，不属于管理列表；全量展开的话将来给 users 加任何列都会自动泄漏出去。
      const adm = list.body.data.find((u) => u.unionid === "adm");
      expect(adm).not.toHaveProperty("openid_web");
      expect(adm).not.toHaveProperty("openid_mp");
      expect(adm.role).toBe("admin");
      expect(adm.status).toBe("active");
      // 白名单该给的字段要给到，否则管理界面没数据可用
      for (const k of ["id", "unionid", "nickname", "avatar_url", "role", "status", "invited_by_code_id", "created_at", "last_login_at"]) {
        expect(adm, `管理列表应包含 ${k}`).toHaveProperty(k);
      }

      // C7 + C11：计数内嵌进列表，没有独立的 /users/:id/resources 路由
      expect(adm.resource_counts.views).toBe(0);
      expect(adm.resource_counts.reports).toBeNull();      // owner_id 要等 Task 8 的 024
      expect(adm.resource_counts.templates).toBeNull();
      expect((await api(port, `/api/admin/users/${user.id}/resources`, admin.id)).status).toBe(404);

      // 停用 = 挡登录，数据全保留（OQ-5）
      const patch = await api(port, `/api/admin/users/${user.id}`, admin.id, { method: "PATCH", body: { status: "disabled" } });
      expect(patch.status).toBe(200);
      expect(patch.body.data.status).toBe("disabled");
      // PATCH 的响应也走同一套白名单，不能从这条路把 openid_* 漏出去
      expect(patch.body.data).not.toHaveProperty("openid_web");
      expect(patch.body.data).not.toHaveProperty("openid_mp");
      expect(db.prepare("SELECT COUNT(*) c FROM users").get().c).toBe(2);

      // 非法 role / status -> 400，且一个字段都不许写
      expect((await api(port, `/api/admin/users/${user.id}`, admin.id, { method: "PATCH", body: { role: "root" } })).status).toBe(400);
      expect((await api(port, `/api/admin/users/${user.id}`, admin.id, { method: "PATCH", body: { status: "banned" } })).status).toBe(400);
      expect(userRow(user.id)).toEqual({ role: "user", status: "disabled" });

      // 不存在的 id -> 404（不泄露存在性）
      expect((await api(port, "/api/admin/users/999999", admin.id, { method: "PATCH", body: { role: "user" } })).status).toBe(404);
    } finally { await close(); }
  });

  it("creates an invite code and deactivates it instead of hard-deleting", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const c = await api(port, "/api/admin/invite-codes", admin.id, {
        method: "POST",
        body: {
          code: "new01", label: "市场部", role: "user", max_uses: 5, note: "首批",
          default_view: { name: "默认", filters: { purposes: "policy" } }
        }
      });
      expect(c.status).toBe(200);
      expect(c.body.data.code).toBe("NEW01");                       // 归一化成大写
      expect(c.body.data.default_view).toContain("policy");
      expect(JSON.parse(c.body.data.default_view)).toEqual({ name: "默认", filters: { purposes: "policy" } });
      expect(c.body.data.max_uses).toBe(5);
      expect(c.body.data.created_by).toBe(admin.id);
      expect(c.body.data.active).toBe(1);

      // 重码 -> 400
      const dup = await api(port, "/api/admin/invite-codes", admin.id, { method: "POST", body: { code: "NEW01" } });
      expect(dup.status).toBe(400);
      expect(dup.body).toEqual({ error: "code exists" });

      const list = await api(port, "/api/admin/invite-codes", admin.id);
      expect(list.status).toBe(200);
      expect(list.body.data.map((r) => r.code)).toEqual(["NEW01"]);

      // 停用 = active 置 0，绝不物理删除（Global Constraint）
      const d = await api(port, `/api/admin/invite-codes/${c.body.data.id}`, admin.id, { method: "PATCH", body: { active: 0 } });
      expect(d.status).toBe(200);
      expect(d.body.data.active).toBe(0);
      expect(db.prepare("SELECT COUNT(*) c FROM invite_codes WHERE code='NEW01'").get().c).toBe(1);

      // C7：没有 DELETE 路由——停用就是 active=0
      expect((await api(port, `/api/admin/invite-codes/${c.body.data.id}`, admin.id, { method: "DELETE" })).status).toBe(404);
      expect(db.prepare("SELECT COUNT(*) c FROM invite_codes WHERE code='NEW01'").get().c).toBe(1);

      // 改 note 不该顺手把 active 改回去
      const n = await api(port, `/api/admin/invite-codes/${c.body.data.id}`, admin.id, { method: "PATCH", body: { note: "改过的备注" } });
      expect(n.body.data.note).toBe("改过的备注");
      expect(n.body.data.active).toBe(0);

      expect((await api(port, "/api/admin/invite-codes/999999", admin.id, { method: "PATCH", body: { active: 0 } })).status).toBe(404);

      // usages：谁用这个码注册的（此时还没人注册）
      const u = await api(port, `/api/admin/invite-codes/${c.body.data.id}/usages`, admin.id);
      expect(u.status).toBe(200);
      expect(u.body.data).toEqual([]);
    } finally { await close(); }
  });

  it("C3: normalizes expires_at on write so the auth-side comparison cannot silently misjudge", async () => {
    const { port, close } = await listen(buildApp());
    try {
      // 浏览器 datetime-local / JSON 的自然形态是带 T/Z 的 ISO 串，而 auth.js 的 /register 用
      // `SELECT datetime('now') < ? AS ok` 比较它。TEXT 字典序里 ' '(0x20) < 'T'(0x54)，
      // 于是「当天午夜、其实早已过期」会被判成未过期。先证明这个陷阱真实存在：
      const today = db.prepare("SELECT datetime('now') n").get().n.slice(0, 10);
      const pastIso = `${today}T00:00:00Z`;
      expect(db.prepare("SELECT datetime('now') < ? AS ok").get(pastIso).ok).toBe(1);   // 原样存 -> 误判「未过期」

      const r = await api(port, "/api/admin/invite-codes", admin.id, { method: "POST", body: { code: "EXP01", expires_at: pastIso } });
      expect(r.status).toBe(200);
      const stored = codeRow("EXP01").expires_at;
      expect(stored).toBe(`${today} 00:00:00`);                                       // 落库前已归一化
      expect(db.prepare("SELECT datetime('now') < ? AS ok").get(stored).ok).toBe(0);   // 现在正确判为已过期

      // 带时区偏移 -> 转 UTC
      expect((await api(port, "/api/admin/invite-codes", admin.id, { method: "POST", body: { code: "EXP02", expires_at: "2026-12-31T23:59:59+08:00" } })).status).toBe(200);
      expect(codeRow("EXP02").expires_at).toBe("2026-12-31 15:59:59");

      // 纯日期 -> 当天午夜
      expect((await api(port, "/api/admin/invite-codes", admin.id, { method: "POST", body: { code: "EXP03", expires_at: "2026-12-31" } })).status).toBe(200);
      expect(codeRow("EXP03").expires_at).toBe("2026-12-31 00:00:00");

      // 垃圾输入 -> 400 且不落库（datetime() 对无法解析的串返回 null）
      const bad = await api(port, "/api/admin/invite-codes", admin.id, { method: "POST", body: { code: "EXP04", expires_at: "garbage" } });
      expect(bad.status).toBe(400);
      expect(bad.body).toEqual({ error: "bad expires_at" });
      expect(codeRow("EXP04")).toBeUndefined();

      // 不传 / null -> NULL（长期有效）
      expect((await api(port, "/api/admin/invite-codes", admin.id, { method: "POST", body: { code: "EXP05" } })).status).toBe(200);
      expect(codeRow("EXP05").expires_at).toBeNull();
      expect((await api(port, "/api/admin/invite-codes", admin.id, { method: "POST", body: { code: "EXP06", expires_at: null } })).status).toBe(200);
      expect(codeRow("EXP06").expires_at).toBeNull();
    } finally { await close(); }
  });

  it("C4: rejects every max_uses that would fail open, accepts null and integers >= 1", async () => {
    const { port, close } = await listen(buildApp());
    try {
      // brief 原本的 `Number(x) || null` 会把 0 和 "abc" 都映射成 null=不限：
      // 「本意谁都不能用」和「管理员打错字」统统 fail-open 成无限次可用。
      const rejected = [
        ["0（本意谁都不能用，却会变成不限）", 0],
        ["负数", -5],
        ["小数", 1.7],
        ["非数字字符串（打错字）", "abc"],
        ["空字符串", ""],
        ["布尔", true],
        ["数组", [5]],
        ["对象", { n: 5 }]
      ];
      for (let i = 0; i < rejected.length; i += 1) {
        const [label, v] = rejected[i];
        const code = `MU-BAD${i}`;
        const r = await api(port, "/api/admin/invite-codes", admin.id, { method: "POST", body: { code, max_uses: v } });
        expect(r.status, `max_uses=${label} 应被 400 拒绝`).toBe(400);
        expect(r.body, `max_uses=${label}`).toEqual({ error: "bad max_uses" });
      }
      // 被拒绝的一个都没落库
      expect(db.prepare("SELECT COUNT(*) c FROM invite_codes WHERE code LIKE 'MU-BAD%'").get().c).toBe(0);

      for (const [code, v] of [["MU-OK1", 5], ["MU-OK2", "5"], ["MU-OK3", 1]]) {
        const r = await api(port, "/api/admin/invite-codes", admin.id, { method: "POST", body: { code, max_uses: v } });
        expect(r.status, `max_uses=${JSON.stringify(v)} 应被接受`).toBe(200);
        expect(codeRow(code).max_uses).toBe(Number(v));
      }

      // 不传 / null = 不限（Global Constraint：max_uses NULL=不限）
      // body 必须带上 code，否则服务端会自己生成随机码，下面就按 code 查不到这一行了
      for (const [code, extra] of [["MU-NULL1", {}], ["MU-NULL2", { max_uses: null }]]) {
        expect((await api(port, "/api/admin/invite-codes", admin.id, { method: "POST", body: { code, ...extra } })).status).toBe(200);
        expect(codeRow(code).max_uses, `${code} 应为 NULL=不限`).toBeNull();
      }

      // 省略 code 时服务端自己生成一个 INV 前缀的随机码（顺带把上面那个坑变成正向覆盖）
      const auto = await api(port, "/api/admin/invite-codes", admin.id, { method: "POST", body: {} });
      expect(auto.status).toBe(200);
      expect(auto.body.data.code).toMatch(/^INV[0-9A-F]{6}$/);
    } finally { await close(); }
  });

  it("C5: refuses to demote or disable the last active admin, and allows it once another admin exists", async () => {
    const { port, close } = await listen(buildApp());
    try {
      expect(adminCount()).toBe(1);   // 此刻只有 adm 一个 active admin

      // 三种会摘掉最后一个 admin 的改法都必须被挡
      const demote = await api(port, `/api/admin/users/${admin.id}`, admin.id, { method: "PATCH", body: { role: "user" } });
      expect(demote.status).toBe(409);
      expect(demote.body.error).toMatch(/last active admin/i);
      const disable = await api(port, `/api/admin/users/${admin.id}`, admin.id, { method: "PATCH", body: { status: "disabled" } });
      expect(disable.status).toBe(409);
      const both = await api(port, `/api/admin/users/${admin.id}`, admin.id, { method: "PATCH", body: { role: "user", status: "disabled" } });
      expect(both.status).toBe(409);
      // 三次拒绝之后，行必须分毫未动（守卫要在任何写入之前）
      expect(userRow(admin.id)).toEqual({ role: "admin", status: "active" });

      // 「维持自己仍是 active admin」不是锁死，必须放行
      const noop = await api(port, `/api/admin/users/${admin.id}`, admin.id, { method: "PATCH", body: { role: "admin", status: "active" } });
      expect(noop.status).toBe(200);
      expect(noop.body.data.role).toBe("admin");

      // 有了第二个 active admin，降级其中一个就安全了
      const second = insertTestUser({ unionid: "adm2", role: "admin" });
      expect(adminCount()).toBe(2);
      expect((await api(port, `/api/admin/users/${second.id}`, admin.id, { method: "PATCH", body: { role: "user" } })).status).toBe(200);
      expect(adminCount()).toBe(1);
      expect((await api(port, `/api/admin/users/${admin.id}`, admin.id, { method: "PATCH", body: { role: "user" } })).status).toBe(409);

      // 把第二个提回来，adm 才不再是最后一个
      expect((await api(port, `/api/admin/users/${second.id}`, admin.id, { method: "PATCH", body: { role: "admin" } })).status).toBe(200);
      expect(adminCount()).toBe(2);

      // 普通用户不受这个守卫影响
      expect((await api(port, `/api/admin/users/${user.id}`, admin.id, { method: "PATCH", body: { status: "disabled" } })).status).toBe(200);

      // 放在最后：这一步之后 adm 自己的 jar 就会 403（requireAdmin 每次请求都重读 role）
      expect((await api(port, `/api/admin/users/${admin.id}`, admin.id, { method: "PATCH", body: { role: "user" } })).status).toBe(200);
      expect(userRow(admin.id)).toEqual({ role: "user", status: "active" });
      expect(adminCount()).toBe(1);
      expect((await api(port, "/api/admin/users", admin.id)).status).toBe(403);
    } finally { await close(); }
  });

  it("C9: disabling a user purges their session rows so the old cookie dies immediately", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const stdJar = jarFor(user.id);
      const oldCookie = stdJar.header();
      expect(oldCookie).toMatch(/^eih_session=/);
      // 能走到 requireAdmin（403 而不是 401）就证明这条 cookie 此刻是活的
      expect((await api(port, "/api/admin/users", user.id)).status).toBe(403);
      expect(sessionCount(user.id)).toBe(1);

      expect((await api(port, `/api/admin/users/${user.id}`, admin.id, { method: "PATCH", body: { status: "disabled" } })).status).toBe(200);

      // 承重断言：sessions 行真的被删掉了。
      // 注意下面那条 401 单独证明不了 DELETE —— sessions.js:23 的 resolveSession 本来就会因
      // status !== 'active' 返回 null。真正钉住 DELETE FROM sessions 的是这条行数断言。
      expect(sessionCount(user.id)).toBe(0);

      const res = await fetch(`http://127.0.0.1:${port}/api/admin/users`, { headers: { Cookie: oldCookie } });
      expect(res.status).toBe(401);
      // 用户行本身保留（禁用 != 删除）
      expect(db.prepare("SELECT COUNT(*) c FROM users WHERE id=?").get(user.id).c).toBe(1);
    } finally { await close(); }
  });

  it("C11: resource_counts degrades to null for not-yet-migrated columns, silently", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { port, close } = await listen(buildApp());
    try {
      // 让 views 计数出一个非零值，证明那条 SQL 真的在数，而不是恰好返回 0
      db.prepare("INSERT INTO user_views (user_id, name, filters) VALUES (?,?,?)").run(user.id, "v1", "{}");

      const list = await api(port, "/api/admin/users", admin.id);
      expect(list.status).toBe(200);
      const std = list.body.data.find((u) => u.unionid === "std");
      const adm = list.body.data.find((u) => u.unionid === "adm");

      // 025 已合入 -> user_views 出真数
      expect(std.resource_counts.views).toBe(1);
      expect(adm.resource_counts.views).toBe(0);
      // reports / report_templates 的 owner_id 要等 Task 8 的 024 -> "no such column" -> null，
      // 这是 countSafe 唯一该静默吞掉的一类；整个列表不许因此 500。
      expect(std.resource_counts.reports).toBeNull();
      expect(std.resource_counts.templates).toBeNull();
      // schema 还没到位是预期状态，不该刷错误日志（否则每个管理员每次打开用户列表都是一屏红）
      expect(errSpy).not.toHaveBeenCalled();
    } finally { await close(); }
  });
});
