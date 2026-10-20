import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import express from "express";
import db from "../db.js";
import adminRouter from "./admin.js";
import authRouter from "./auth.js";
import { ensureSuperAdminInvite, superAdminUnionid } from "../lib/pairIdentity.js";
import { requireAuth, requireAdmin } from "../lib/authMiddleware.js";
import { createSession } from "../lib/sessions.js";
import { clearAuthTables, insertTestUser, listen, makeCookieJar } from "../testUtils.js";

function buildApp() {
  const app = express();
  // 裸 express.json()（默认 100kb），刻意不与 apiRoutes.test.js 的 JSON_LIMIT（10mb，
  // 为与 index.js 同构而设）对齐：本文件不断言 body 解析错误（entity.too.large 之类），
  // limit 取值与这里任何一条断言都无关。要加这类断言时再同步。
  app.use(express.json());
  // 挂载形状与 views.test.js 的宿主 app 一致：中间件写在 router 之前（apiRoutes.js 里
  // 「挂载形状是硬约束」那段注释说明了为什么）。刻意不引用行号——行号会随改动漂移。
  app.use("/api/admin", requireAuth, requireAdmin, adminRouter);
  app.use("/api/auth", authRouter);
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
      // 🔴 024（Task 8）已合入：owner_id 列存在，计数出真值 0（不再是 "no such column" -> null）。
      expect(adm.resource_counts.reports).toBe(0);
      expect(adm.resource_counts.templates).toBe(0);
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
      const u0 = await api(port, `/api/admin/invite-codes/${c.body.data.id}/usages`, admin.id);
      expect(u0.status).toBe(200);
      expect(u0.body.data).toEqual([]);

      // Minor 4：空列表**结构性地**证明不了投影是白名单——把
      // `SELECT id, unionid, nickname, created_at` 改成 `SELECT *`，上面那条照样绿，
      // 而它会向管理员泄漏每个用过该码的用户的 openid_web / openid_mp。
      // 所以先造一个真实使用者，再钉住字段集合**恰好**是这 4 个。
      const usedBy = insertTestUser({ unionid: "used-by-new01" });
      db.prepare("UPDATE users SET invited_by_code_id=? WHERE id=?").run(c.body.data.id, usedBy.id);
      const u = await api(port, `/api/admin/invite-codes/${c.body.data.id}/usages`, admin.id);
      expect(u.status).toBe(200);
      expect(u.body.data.map((r) => r.unionid)).toEqual(["used-by-new01"]);
      expect(Object.keys(u.body.data[0]).sort(), "usages 的投影必须恰好是这 4 个字段，不许 SELECT *")
        .toEqual(["created_at", "id", "nickname", "unionid"]);
      expect(u.body.data[0]).not.toHaveProperty("openid_web");
      expect(u.body.data[0]).not.toHaveProperty("openid_mp");
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

      // 垃圾**字符串** -> 400 且不落库（datetime() 对无法解析的串返回 null）
      const bad = await api(port, "/api/admin/invite-codes", admin.id, { method: "POST", body: { code: "EXP04", expires_at: "garbage" } });
      expect(bad.status).toBe(400);
      expect(bad.body).toEqual({ error: "bad expires_at" });
      expect(codeRow("EXP04")).toBeUndefined();

      // I3：非字符串一律 400。SQLite 的 datetime() 只对**字符串**「白送」非法值拒绝，
      // 对数字它按儒略日解释（实测 `SELECT datetime(?)`）：
      //   2500000 -> "2132-08-31 12:00:00"   HTTP 200，一张实际永不过期的邀请码
      //   2460000 -> "2023-02-24 12:00:00"   HTTP 200
      //   5 / [5] -> "-4713-11-29 12:00:00"  HTTP 200（数组被 better-sqlite3 当绑定参数列表）
      //   true -> TypeError、{n:5} -> RangeError，都是 HTTP 500（本该 400）
      // 失败方向是 fail-open，与 C4 在**同一个 handler 里**对 max_uses 的显式拒绝直接矛盾。
      // 放大因素：PATCH /invite-codes/:id 只支持 active/note，误建之后**无法改正**
      // expires_at，只能停用重建。
      const badTypes = [
        ["数字（被当儒略日 -> 永不过期）", 2500000],
        ["小数", 2460000.5],
        ["布尔", true],
        ["数组", [5]],
        ["对象", { n: 5 }]
      ];
      for (let i = 0; i < badTypes.length; i += 1) {
        const [label, v] = badTypes[i];
        const code = `EXP-BAD${i}`;
        const r = await api(port, "/api/admin/invite-codes", admin.id, { method: "POST", body: { code, expires_at: v } });
        expect(r.status, `expires_at=${label} 应被 400 拒绝（不是 200、也不是 500）`).toBe(400);
        expect(r.body, `expires_at=${label}`).toEqual({ error: "bad expires_at" });
      }
      // 被拒绝的一个都没落库
      expect(db.prepare("SELECT COUNT(*) c FROM invite_codes WHERE code LIKE 'EXP-BAD%'").get().c).toBe(0);

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

      // I2：C5 的计数**必须**带 `AND status='active'`，否则这颗守卫在条件上没有齿。
      // 场景是真实会发生的：管理员停用了一个同事管理员，之后想降级自己。
      // 此时 active admin 只剩 adm 一个，但 role='admin' 的行有 2 个——
      // 少了 status 条件的计数会算出 2、放行，于是 active admin 归零、
      // 整个管理面永久失联，只能直接改库恢复。这正是 C5 存在的唯一理由。
      // （上面 C5 里「把 second 降成 user 之后、adm 仍是最后一个」那条 409 抓不到这个变异：
      //   那时 second 的 role 已经变成 'user'，role='admin' 的行本来就只剩 1 个，
      //   带不带 status 条件结果一样。刻意不引用行号——行号会随改动漂移。）
      expect((await api(port, `/api/admin/users/${second.id}`, admin.id, { method: "PATCH", body: { status: "disabled" } })).status).toBe(200);
      expect(adminCount(), "停用之后 active admin 只剩 adm").toBe(1);
      expect(db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c,
        "但 role='admin' 的行仍有 2 个（含被停用的那个）").toBe(2);
      expect((await api(port, `/api/admin/users/${admin.id}`, admin.id, { method: "PATCH", body: { role: "user" } })).status,
        "1 active + 1 disabled admin 时降级自己必须 409").toBe(409);
      expect((await api(port, `/api/admin/users/${admin.id}`, admin.id, { method: "PATCH", body: { status: "disabled" } })).status,
        "1 active + 1 disabled admin 时停用自己必须 409").toBe(409);
      expect(userRow(admin.id), "两次拒绝之后 adm 分毫未动").toEqual({ role: "admin", status: "active" });
      // 恢复：下面的步骤依赖「adm 不是最后一个 active admin」
      expect((await api(port, `/api/admin/users/${second.id}`, admin.id, { method: "PATCH", body: { status: "active" } })).status).toBe(200);
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

  it("C11: resource_counts degrade to null only for columns that are genuinely missing", async () => {
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
      // 🔴 Task 8（024 迁移）已合入 -> reports / report_templates 的 owner_id 列已存在，
      // countSafe 的 SQL 合法，计数出真值（这两张表里 std/adm 都没有行 -> 0）。
      // 这是本测试**第三次**换预期：024 之前断言 null（no such column）、024 之后断言 0、
      // 若未来再有未迁移的列，null 断言照原样加回来。countSafe 唯一该静默吞掉的
      // 就是 "no such column" 这一类；整个列表不许因此 500。
      expect(std.resource_counts.reports).toBe(0);
      expect(std.resource_counts.templates).toBe(0);
      expect(adm.resource_counts.reports).toBe(0);
      expect(adm.resource_counts.templates).toBe(0);
      // 列都到位了更不该刷错误日志（否则每个管理员每次打开用户列表都是一屏红）
      expect(errSpy).not.toHaveBeenCalled();
    } finally { await close(); }
  });

  it("rejects a malformed default_view at write time instead of silently dropping it later", async () => {
    const { port, close } = await listen(buildApp());
    try {
      // 为什么必须在**写入侧**拒绝：applyInviteDefaults 对坏配置走的是静默 return。
      // 实测 default_view="[]" -> 建出 0 个 user_views、不抛异常、连一行 console.error 都没有。
      // 管理员以为这张码带着默认视角，用它注册的每个用户都什么都拿不到，而任何日志里
      // 都查不到痕迹。此刻管理员还在场、能立刻看到 400；等到注册时再兜底就没人看得见了
      // （这也是为什么改这里比在 viewService.js 里兜底更好）。
      const rejected = [
        ["空数组（实测静默丢视角）", []],
        ["数组", [{ name: "x" }]],
        ["字符串", "policy"],
        ["数字", 5],
        ["布尔", true]
      ];
      for (let i = 0; i < rejected.length; i += 1) {
        const [label, v] = rejected[i];
        const code = `DV-BAD${i}`;
        const r = await api(port, "/api/admin/invite-codes", admin.id, { method: "POST", body: { code, default_view: v } });
        expect(r.status, `default_view=${label} 应被 400 拒绝`).toBe(400);
        expect(r.body, `default_view=${label}`).toEqual({ error: "bad default_view" });
      }
      expect(db.prepare("SELECT COUNT(*) c FROM invite_codes WHERE code LIKE 'DV-BAD%'").get().c).toBe(0);

      // 合法形状与「不填」都必须照常放行——这条校验不许把正常用法一起挡掉
      const ok = await api(port, "/api/admin/invite-codes", admin.id, {
        method: "POST",
        body: { code: "DV-OK1", default_view: { name: "默认", filters: { purposes: "policy" } } }
      });
      expect(ok.status).toBe(200);
      expect(JSON.parse(codeRow("DV-OK1").default_view)).toEqual({ name: "默认", filters: { purposes: "policy" } });
      for (const [code, extra] of [["DV-OK2", {}], ["DV-OK3", { default_view: null }]]) {
        expect((await api(port, "/api/admin/invite-codes", admin.id, { method: "POST", body: { code, ...extra } })).status).toBe(200);
        expect(codeRow(code).default_view, `${code} 不填 default_view 应存 NULL`).toBeNull();
      }
    } finally { await close(); }
  });

  it("rejects an unknown role with 400 instead of silently issuing a plain-user code", async () => {
    const { port, close } = await listen(buildApp());
    try {
      // brief 原来是 ["admin","user"].includes(b.role) ? b.role : "user"：
      // role:"Admin"（大小写打错）会**静默发出一张普通用户邀请码**，管理员只能从响应体里
      // 发现。这与 C4 在同一个 handler 里对 max_uses 的显式拒绝原则自相矛盾。
      // 方向仍是 fail-closed（最小权限），所以这不是安全洞，是一致性 + 可发现性问题。
      const rejected = [
        ["不存在的角色", "root"],
        ["大小写打错", "Admin"],
        ["空字符串", ""],
        ["数字", 5],
        ["布尔", true],
        ["数组", ["admin"]]
      ];
      for (let i = 0; i < rejected.length; i += 1) {
        const [label, v] = rejected[i];
        const code = `ROLE-BAD${i}`;
        const r = await api(port, "/api/admin/invite-codes", admin.id, { method: "POST", body: { code, role: v } });
        expect(r.status, `role=${label} 应被 400 拒绝`).toBe(400);
        expect(r.body, `role=${label}`).toEqual({ error: "bad role" });
      }
      expect(db.prepare("SELECT COUNT(*) c FROM invite_codes WHERE code LIKE 'ROLE-BAD%'").get().c).toBe(0);

      // 两个合法值照常；省略 / null = 默认 user（与 PATCH /users/:id 的 role 口径一致）
      expect((await api(port, "/api/admin/invite-codes", admin.id, { method: "POST", body: { code: "ROLE-A", role: "admin" } })).status).toBe(200);
      expect(codeRow("ROLE-A").role).toBe("admin");
      expect((await api(port, "/api/admin/invite-codes", admin.id, { method: "POST", body: { code: "ROLE-U", role: "user" } })).status).toBe(200);
      expect(codeRow("ROLE-U").role).toBe("user");
      for (const [code, extra] of [["ROLE-D1", {}], ["ROLE-D2", { role: null }]]) {
        expect((await api(port, "/api/admin/invite-codes", admin.id, { method: "POST", body: { code, ...extra } })).status).toBe(200);
        expect(codeRow(code).role, `${code} 省略 role 应默认 user`).toBe("user");
      }
    } finally { await close(); }
  });
});

describe("内置超级管理员（产品负责人 2026-10-21）", () => {
  let sadm, sua;
  beforeEach(() => {
    clearAuthTables();
    sadm = insertTestUser({ unionid: "radm", role: "admin" });
    sua = insertTestUser({ unionid: "rstd-a" });
    ensureSuperAdminInvite();
  });

  it("种子：幂等，且码为 admin 角色、不限次、不过期", () => {
    ensureSuperAdminInvite();  // 二次调用不炸、不重复
    const code = db.prepare("SELECT * FROM invite_codes WHERE code='ADMIN123456'").get();
    expect(code.role).toBe("admin");
    expect(code.max_uses).toBe(1);   // 超管只有一个名额
    expect(code.expires_at).toBeNull();
    expect(code.active).toBe(1);
    expect(db.prepare("SELECT COUNT(*) c FROM invite_codes WHERE code='ADMIN123456'").get().c).toBe(1);
  });

  it("超管账号注册（pair 流程）→ role=admin，列表带 locked=true", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const reg = await api(port, "/api/auth/register-pair", sua.id, { method: "POST", body: { code: "admin123456", username: "admin" } });
      expect(reg.status).toBe(201);
      expect(reg.body.data.user.role).toBe("admin");
      // 超管本人视角：能看到自己行且 locked=true
      const meList = await api(port, "/api/admin/users", reg.body.data.user.id);
      const row = meList.body.data.find((u) => u.nickname === "admin");
      expect(row.locked).toBe(true);
      // 其他管理员视角：超管行不可见
      const otherList = await api(port, "/api/admin/users", sadm.id);
      expect(otherList.body.data.find((u) => u.nickname === "admin")).toBeUndefined();
      const other = otherList.body.data.find((u) => u.unionid === "rstd-a");
      expect(other.locked).toBe(false);
    } finally { await close(); }
  });

  it("🔴 超管不可改角色 / 不可停用（先于一切校验，任何 patch 一律 400）", async () => {
    const { port, close } = await listen(buildApp());
    try {
      await api(port, "/api/auth/register-pair", sua.id, { method: "POST", body: { code: "admin123456", username: "admin" } });
      // 其他管理员的列表已滤掉超管行（下方有专门用例），这里直接查库拿 id
      const saRow = db.prepare("SELECT id FROM users WHERE unionid = ?").get(superAdminUnionid());
      const demote = await api(port, `/api/admin/users/${saRow.id}`, sadm.id, { method: "PATCH", body: { role: "user" } });
      expect(demote.status).toBe(400);
      expect(demote.body.error).toBe("super admin account cannot be modified");
      const disable = await api(port, `/api/admin/users/${saRow.id}`, sadm.id, { method: "PATCH", body: { status: "disabled" } });
      expect(disable.status).toBe(400);
      // 行原样保留
      const row = db.prepare("SELECT role, status FROM users WHERE id=?").get(saRow.id);
      expect(row.role).toBe("admin");
      expect(row.status).toBe("active");
    } finally { await close(); }
  });

  it("🔴 超管邀请码不可被停用（新注册永远开放）", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const codeRow = db.prepare("SELECT id FROM invite_codes WHERE code='ADMIN123456'").get();
      const r = await api(port, `/api/admin/invite-codes/${codeRow.id}`, sadm.id, { method: "PATCH", body: { active: 0 } });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("super admin invite code cannot be deactivated");
      expect(db.prepare("SELECT active FROM invite_codes WHERE code='ADMIN123456'").get().active).toBe(1);
    } finally { await close(); }
  });
});

describe("超管唯一性与可见性（产品负责人 2026-10-21 补充）", () => {
  let sadm, sua;
  beforeEach(() => {
    clearAuthTables();
    sadm = insertTestUser({ unionid: "radm", role: "admin" });
    sua = insertTestUser({ unionid: "rstd-a" });
    ensureSuperAdminInvite();
  });

  it("🔴 超管注册后码即枯竭：同码不可再注册任何新用户/新管理员（名额只有一个）", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const first = await api(port, "/api/auth/register-pair", sua.id, { method: "POST", body: { code: "admin123456", username: "admin" } });
      expect(first.status).toBe(201);
      const second = await api(port, "/api/auth/register-pair", sua.id, { method: "POST", body: { code: "admin123456", username: "admin2" } });
      expect(second.status).toBe(400);
      expect(second.body.error).toBe("invite code exhausted");
    } finally { await close(); }
  });

  it("🔴 其他管理员的邀请码列表看不到 ADMIN123456 行（防暴露登录信息）；超管本人可见", async () => {
    const { port, close } = await listen(buildApp());
    try {
      await api(port, "/api/auth/register-pair", sua.id, { method: "POST", body: { code: "admin123456", username: "admin" } });
      const superId = db.prepare("SELECT id FROM users WHERE unionid=?").get(superAdminUnionid()).id;
      const superList = await api(port, "/api/admin/invite-codes", superId);
      expect(superList.body.data.find((c) => c.code === "ADMIN123456")).toBeTruthy();
      const otherList = await api(port, "/api/admin/invite-codes", sadm.id);
      expect(otherList.body.data.find((c) => c.code === "ADMIN123456")).toBeUndefined();
    } finally { await close(); }
  });
});
