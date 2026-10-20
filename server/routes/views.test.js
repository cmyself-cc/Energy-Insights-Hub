import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import express from "express";
import db from "../db.js";
import viewsRouter from "./views.js";
import { requireAuth } from "../lib/authMiddleware.js";
import { createSession } from "../lib/sessions.js";
import { clearAuthTables, insertTestUser, listen, makeCookieJar } from "../testUtils.js";
import { applyInviteDefaults } from "../services/viewService.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/views", requireAuth, viewsRouter);
  return app;
}

// 每个用例一条 session、一个 jar，全程复用（模拟同一个浏览器），而不是每次请求新建会话
let jar;
let userIdForTest;

// 造一个已登录的 jar：库里只存 sha256，cookie 里带明文 token
function sessionJarFor(userId) {
  const j = makeCookieJar();
  j.absorb({ headers: new Headers({ "set-cookie": `eih_session=${createSession(userId, "vitest")}` }) });
  return j;
}

async function authedApi(port, path, { method = "GET", body, cookieJar } = {}) {
  const j = cookieJar || jar;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(j.header() ? { Cookie: j.header() } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  j.absorb(res);
  // .catch(() => null)：上面 buildApp() 只挂了 router，没有装 server/apiRoutes.js 里那个
  // JSON 错误中间件，所以 handler 万一逃逸抛出，express 的默认处理会 500 成 text/html。
  // 加了 catch，失败才会呈现为「expected 200, got 500」，而不是 SyntaxError: Unexpected token '<'
  return { status: res.status, body: await res.json().catch(() => null) };
}

const countViews = (userId) => db.prepare("SELECT COUNT(*) AS c FROM user_views WHERE user_id=?").get(userId).c;
const defaultIds = (rows) => rows.filter((v) => v.is_default).map((v) => v.id);

describe("/api/views", () => {
  beforeEach(() => {
    clearAuthTables();
    userIdForTest = insertTestUser({ unionid: "vu1" }).id;
    jar = sessionJarFor(userIdForTest);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("create/list/update/delete, with owner isolation on every verb", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const c = await authedApi(port, "/api/views", {
        method: "POST",
        body: { name: "电力日报", filters: { purposes: "tech", businessCategory: "电力" } }
      });
      expect(c.status).toBe(200);
      expect(c.body.data.name).toBe("电力日报");

      const list = await authedApi(port, "/api/views");
      expect(list.status).toBe(200);
      expect(list.body.data.length).toBe(1);
      // filters 存的是 JSON 文本、读回来必须是对象
      expect(list.body.data[0].filters.businessCategory).toBe("电力");

      // PUT 不带 filters：existing.filters 已被 parse() 换成对象，直接绑进 SQL 会抛
      // RangeError（better-sqlite3 把 plain object 当命名参数）→ 500 text/html
      const u = await authedApi(port, `/api/views/${c.body.data.id}`, { method: "PUT", body: { name: "电力氢能" } });
      expect(u.status).toBe(200);
      expect(u.body.data.name).toBe("电力氢能");
      // 没带 filters 不等于把 filters 清掉
      expect(u.body.data.filters.businessCategory).toBe("电力");

      // 属主的第二个视角：下面让 vu2 来打它。
      // （不能像"先由属主删掉、再让他人删同一个 id"那样测——那个 404 平凡为真，对所有权什么都没证明）
      const second = await authedApi(port, "/api/views", { method: "POST", body: { name: "第二视角", filters: { purposes: "policy" } } });
      expect(second.status).toBe(200);
      const secondId = second.body.data.id;
      expect(countViews(userIdForTest)).toBe(2);

      // 无 cookie → 401
      expect((await authedApi(port, "/api/views", { cookieJar: makeCookieJar() })).status).toBe(401);

      // 他人视角一律 404（不泄露存在性）：列表天然隔离，三个按 id 的动词各自都要带 AND user_id=?
      const vu2 = insertTestUser({ unionid: "vu2" });
      const jar2 = sessionJarFor(vu2.id);
      const asVu2 = await authedApi(port, "/api/views", { cookieJar: jar2 });
      expect(asVu2.status).toBe(200);
      expect(asVu2.body.data).toEqual([]);
      expect((await authedApi(port, `/api/views/${secondId}`, { method: "PUT", body: { name: "篡改" }, cookieJar: jar2 })).status).toBe(404);
      expect((await authedApi(port, `/api/views/${secondId}/default`, { method: "POST", cookieJar: jar2 })).status).toBe(404);
      expect((await authedApi(port, `/api/views/${secondId}`, { method: "DELETE", cookieJar: jar2 })).status).toBe(404);

      // 越权尝试之后，属主的数据必须分毫未动
      const row = db.prepare("SELECT * FROM user_views WHERE id=?").get(secondId);
      expect(row, "他人 DELETE 之后行必须还在").toBeTruthy();
      expect(row.name).toBe("第二视角");
      expect(row.is_default).toBe(0);
      expect(countViews(userIdForTest)).toBe(2);

      // 属主自己删得掉；响应信封是 { data: { success: true } }，不是裸 { success: true }
      const d = await authedApi(port, `/api/views/${c.body.data.id}`, { method: "DELETE" });
      expect(d.status).toBe(200);
      expect(d.body).toEqual({ data: { success: true } });
      expect(countViews(userIdForTest)).toBe(1);
      // 删掉的正是 default 视角（首个创建 → count===0 → isDefault=1），而 deleteView 是裸
      // DELETE、createView 只在 count===0 时设 default，所以不会自动重指派 → 落到零 default。
      // 这不是 spec 违约（plan 的「若有 is_default → 自动启用」是条件式，容忍零 default，
      // 且用户有「设默认」按钮可自愈）。显式钉住当前行为：将来若决定要自动重指派，
      // 这条会红，强迫一次有意识的决定。
      expect(defaultIds((await authedApi(port, "/api/views")).body.data)).toEqual([]);
    } finally { await close(); }
  });

  it("enforces the per-user limit of 10 views", async () => {
    const { port, close } = await listen(buildApp());
    try {
      for (let i = 0; i < 10; i += 1) {
        const r = await authedApi(port, "/api/views", { method: "POST", body: { name: `v${i}`, filters: {} } });
        expect(r.status, `第 ${i + 1} 个视角应当创建成功`).toBe(200);
      }
      expect(countViews(userIdForTest)).toBe(10);

      const over = await authedApi(port, "/api/views", { method: "POST", body: { name: "v11", filters: {} } });
      expect(over.status).toBe(400);
      expect(over.body.error).toMatch(/limit/i);
      expect(over.body.error).toBe("view limit reached (10)");
      expect(countViews(userIdForTest)).toBe(10);   // 第 11 个没有落库

      // 上限是「每用户」的：另一个用户不受影响
      const vu2 = insertTestUser({ unionid: "vu2" });
      const other = await authedApi(port, "/api/views", {
        method: "POST", body: { name: "别人的", filters: {} }, cookieJar: sessionJarFor(vu2.id)
      });
      expect(other.status).toBe(200);
      expect(countViews(vu2.id)).toBe(1);
    } finally { await close(); }
  });

  it("setDefault keeps exactly one default; nonexistent ids are 404 on every verb", async () => {
    const { port, close } = await listen(buildApp());
    try {
      const a = await authedApi(port, "/api/views", { method: "POST", body: { name: "a", filters: {} } });
      const b = await authedApi(port, "/api/views", { method: "POST", body: { name: "b", filters: {} } });
      // 首个视角建出来时就是 default，切到 a 再切到 b，任何时刻都只能有一个
      expect(defaultIds((await authedApi(port, "/api/views")).body.data)).toEqual([a.body.data.id]);
      await authedApi(port, `/api/views/${a.body.data.id}/default`, { method: "POST" });
      expect(defaultIds((await authedApi(port, "/api/views")).body.data)).toEqual([a.body.data.id]);
      const setB = await authedApi(port, `/api/views/${b.body.data.id}/default`, { method: "POST" });
      expect(setB.status).toBe(200);
      expect(defaultIds((await authedApi(port, "/api/views")).body.data)).toEqual([b.body.data.id]);

      // 标题里的 invalid：不存在的 id 在三个按 id 的动词上都必须 404，且不得改动现状
      expect((await authedApi(port, "/api/views/999999/default", { method: "POST" })).status).toBe(404);
      expect((await authedApi(port, "/api/views/999999", { method: "PUT", body: { name: "x" } })).status).toBe(404);
      expect((await authedApi(port, "/api/views/999999", { method: "DELETE" })).status).toBe(404);
      // 非数字 id：Number("abc") → NaN。今天它不抛、只 404，靠的是 better-sqlite3 11.10.0
      // 对非有限数的绑定行为（SELECT 得 null、UPDATE/DELETE changes=0），**不是 SQLite 语义**。
      // 一次依赖升级就可能把它变成 500 + 栈泄漏，而套件全绿。钉住，让结论从「实测过一次」
      // 变成「被持续保护」。（已复证 NaN/0/1.5/1e21/-1/undefined/null × 三条 SQL 共 21 组全不抛，
      // 所以不需要 id 白名单。）
      expect((await authedApi(port, "/api/views/abc", { method: "PUT", body: { name: "x" } })).status).toBe(404);
      expect(defaultIds((await authedApi(port, "/api/views")).body.data)).toEqual([b.body.data.id]);
      expect(countViews(userIdForTest)).toBe(2);
    } finally { await close(); }
  });

  it("applyInviteDefaults lands the invite default_view as the first, default view", () => {
    // 只读 default_view 一列：邀请码只携带「角色 + 默认视角配置」，其余列与视角无关
    applyInviteDefaults(userIdForTest, {
      id: 9, code: "TEAM01", label: "team", role: "user", max_uses: null, used_count: 3,
      default_view: JSON.stringify({ name: "初始视角", filters: { purposes: "policy" } })
    });
    const rows = db.prepare("SELECT * FROM user_views WHERE user_id=?").all(userIdForTest);
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("初始视角");
    expect(JSON.parse(rows[0].filters).purposes).toBe("policy");
    expect(rows[0].is_default).toBe(1);
  });

  it("applyInviteDefaults never throws: bad config degrades quietly, DB failures are logged", () => {
    // auth.js 在 db.transaction 之外、try/catch 之外调它。一旦抛出，失败形态是
    // 「用户已建 + 邀请码已计数 + 500」，所以「不抛」本身就是契约。
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const badConfigs = [
      ["没有 default_view", {}],
      ["default_view 为 null", { default_view: null }],
      ["default_view 不是 JSON", { default_view: "{不是 JSON" }],
      ["default_view 是 JSON 但不是对象", { default_view: "\"just a string\"" }],
      // typeof [] === "object"，所以数组能穿过形状守卫，静默建出名为「初始视角」、
      // filters 为 {} 的垃圾视角。Task 5 的形状守卫是整条链路上唯一拦得住它的地方：
      // 管理界面是自由文本 textarea、路由只做 JSON 合法性校验（safeParse）、存库直接
      // JSON.stringify，三处都不校验形状。管理员把 filters 误写成 ["purposes=policy"]
      // 是很自然的错法，所以必须在这里挡住。属「配置不合法」→ 走静默降级，不得刷错误日志。
      ["default_view 是数组", { default_view: "[]" }],
      ["inviteRow 整个是 undefined", undefined]
    ];
    for (const [label, invite] of badConfigs) {
      expect(() => applyInviteDefaults(userIdForTest, invite), label).not.toThrow();
    }
    expect(countViews(userIdForTest)).toBe(0);
    expect(errSpy).not.toHaveBeenCalled();   // 配置不合法是正常降级，不该刷错误日志

    // 数据库层面抛出也必须被吞掉：用一个违反外键的 userId 触发真实 SqliteError
    expect(() => applyInviteDefaults(999999, { default_view: JSON.stringify({ name: "x", filters: {} }) })).not.toThrow();
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toBe("[views] applyInviteDefaults failed:");
    expect(String(errSpy.mock.calls[0][1])).toMatch(/FOREIGN KEY/);
    expect(countViews(userIdForTest)).toBe(0);
  });

  it("applyInviteDefaults does not silently move an existing default when the limit is hit", () => {
    // 可达路径：auth.js 注册事务的 dup 分支返回既有用户而不抛，随后对**已存在的用户**调
    // applyInviteDefaults。今天需要跨进程并发（/register 全同步、单进程无交错窗口）；但
    // Task 9/10 的管理员建号一旦落地，「管理员先建号 + 该 UnionID 手里还有一张 10 分钟内
    // 有效的票据」就是一条无需并发的路径。
    //
    // 用户已满 10 个视角时 createView 返回 {error}、视角没建成。若丢弃这个返回值，后面的
    // setDefault 会无条件执行，把 default 静默搬到 id 最小的视角上——一次无意的数据改动。
    const ids = [];
    for (let i = 0; i < 10; i += 1) {
      const { lastInsertRowid } = db.prepare(
        "INSERT INTO user_views (user_id, name, filters, is_default) VALUES (?,?,?,0)"
      ).run(userIdForTest, `v${i}`, "{}");
      ids.push(lastInsertRowid);
    }
    // 故意把 default 放在 **id 最大** 的那个上：出 bug 时 setDefault 会去抢 ORDER BY id
    // LIMIT 1（id 最小）的那个，断言才抓得住。放在 id 最小上则平凡为真、什么都证明不了。
    const keeper = ids[ids.length - 1];
    db.prepare("UPDATE user_views SET is_default=1 WHERE id=?").run(keeper);
    expect(countViews(userIdForTest)).toBe(10);

    expect(() => applyInviteDefaults(userIdForTest, {
      default_view: JSON.stringify({ name: "初始视角", filters: { purposes: "policy" } })
    }), "已达上限时不得抛出").not.toThrow();

    expect(countViews(userIdForTest)).toBe(10);   // 第 11 个没有落库
    const defaults = db.prepare("SELECT id FROM user_views WHERE user_id=? AND is_default=1")
      .all(userIdForTest).map((r) => r.id);
    expect(defaults, "default 必须仍是原来那个，不能被静默搬走").toEqual([keeper]);
  });

  // 文件级清理：user_views 有外键指向 users(id) 且 better-sqlite3 默认 PRAGMA foreign_keys=1，
  // 残留行会让后续测试文件的 DELETE FROM users 抛 FOREIGN KEY constraint failed。
  // 当前「本文件跑完恰好是干净的」只是**数据性质的巧合**（最后一个用例的 beforeEach 清过、
  // 且它自己不建行），不是代码性质。Task 8 的邀请码管理测试会 POST default_view 并走
  // 「邀请码 → 注册」端到端，届时就会开始留残留行。加这一行把整类顺序脆弱性移掉；
  // 023_users_auth.test.js 里那条 R4 修复仍然保留（纵深防御，两处一起才对）。
  afterAll(() => { clearAuthTables(); });
});
