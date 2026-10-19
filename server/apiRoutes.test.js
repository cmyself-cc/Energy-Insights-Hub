import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import express from "express";
import db from "./db.js";
import { mountApiRoutes } from "./apiRoutes.js";
import { createSession } from "./lib/sessions.js";
import { __resetInviteLimiter } from "./routes/auth.js";
import { clearAuthTables, insertTestUser, listen, makeCookieJar } from "./testUtils.js";

// 这份文件断言的就是「鉴权矩阵」本身——整个分用户分角色计划的安全边界。
// 把挂载表从 index.js 抽成 apiRoutes.js 的全部理由就在这里：index.js 一 import 就 listen +
// 跑 seed + 启动抓取调度器，测不了；而边界没有测试覆盖的话，将来谁摘掉一个 requireAuth，
// 不会有任何一个测试变红。
//
// 设计上零副作用：requireAuth / requireAdmin 都在 router 之前短路，所以匿名与越权用例
// **永远碰不到任何真实 handler**。唯一会走到 handler 的是「必须保持所有登录用户可用」那组，
// 全部用 id 999999999（测试库 insights 表实测 rows=0），即使真执行也只影响 0 行。

function buildApp() {
  const app = express();
  app.use(express.json());
  mountApiRoutes(app);
  return app;
}

// 中央错误中间件需要一个「真的会抛」的 handler 才够得着。真实路由里没有一条能在测试里
// 稳定地抛（能抛的都依赖缺列/缺表，而那正是要避免写进断言的东西），所以插一条只属于测试的
// 探针路由。它必须挂在 mountApiRoutes **之前**：express 处理 next(err) 时是从当前位置
// 向后找 4 参处理器，探针排在中间件上游才够得着它。
// 这不是 mock 被测代码——被测对象就是那个中间件，异常是真的从 handler 里抛出来的。
function buildAppWithProbe() {
  const app = express();
  app.use(express.json());
  app.get("/api/__boom", () => { throw new Error("boom: UNIQUE constraint failed: secret_table.col"); });
  mountApiRoutes(app);
  return app;
}

const jars = new Map();
function jarFor(userId) {
  if (!jars.has(userId)) {
    const j = makeCookieJar();
    j.absorb({ headers: new Headers({ "set-cookie": `eih_session=${createSession(userId, "vitest")}` }) });
    jars.set(userId, j);
  }
  return jars.get(userId);
}

async function call(port, path, userId, { method = "GET", body } = {}) {
  const j = userId == null ? makeCookieJar() : jarFor(userId);
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(j.header() ? { Cookie: j.header() } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  j.absorb(res);
  return { status: res.status, body: await res.json().catch(() => null) };
}

// 畸形 body 的用例不能用 call()：它会 JSON.stringify，而这里要发的恰恰是**不合法**的原始串。
// 同时要把 content-type 与原始文本一起拿出来，才能断言「不是 express 默认的 text/html 错误页」。
async function rawCall(port, path, rawBody, { method = "POST", userId = null, headers } = {}) {
  const j = userId == null ? makeCookieJar() : jarFor(userId);
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(j.header() ? { Cookie: j.header() } : {}), ...headers },
    body: rawBody
  });
  j.absorb(res);
  return { status: res.status, contentType: res.headers.get("content-type") || "", text: await res.text() };
}

// —— 匿名可达（登录流程本身 + 健康检查）——
const PUBLIC_PATHS = ["/api/health", "/api/auth/config"];

// —— 必须登录：匿名一律 401。用裸前缀，正好测「中间件挂在前缀上」这件事 ——
const PROTECTED_PREFIXES = [
  "/api/views", "/api/admin", "/api/sources", "/api/insights", "/api/reports",
  "/api/tracker", "/api/tracker-settings", "/api/filters", "/api/feedback",
  "/api/industries", "/api/models", "/api/search-providers", "/api/ai"
];

// —— 前缀级 requireAdmin：非 admin 连读都进不去。
// 这里刻意只挑**只读** GET（tracker 没有 GET /，用 /status），这样万一有人摘掉 requireAdmin，
// 请求落到的是读操作而不是 POST /run 之类会真去抓网站的 handler。
const ADMIN_ONLY_READS = [
  "/api/admin/users",
  "/api/admin/invite-codes",
  "/api/sources",
  "/api/tracker/status",
  "/api/tracker-settings",
  "/api/models",
  "/api/search-providers"
];

// —— 路由内联 requireAdmin 的写操作：403 必须发生在 handler 之前 ——
const ADMIN_ONLY_WRITES = [
  ["DELETE", "/api/insights/999999999"],
  ["POST", "/api/filters/rules"],
  ["PUT", "/api/filters/rules/999999999"],
  ["DELETE", "/api/filters/rules/999999999"],
  ["POST", "/api/filters/rules/999999999/regenerate-aliases"],
  ["PUT", "/api/filters/categories/999999999"],
  ["PUT", "/api/filters/config"],
  ["PUT", "/api/filters/ai-presets"],
  ["POST", "/api/industries"],
  ["PUT", "/api/industries/999999999"],
  ["DELETE", "/api/industries/999999999"],
  ["POST", "/api/industries/suggest-keywords"]
];

// —— 反向钉子：这些**不是** admin-only。hide/unhide/reclassify 是用户反馈动作
// （AGENTS.md：bookmark/hide feedback that feeds back into filtering weights），
// 必须对所有登录用户开放。将来谁把 requireAdmin 顺手加到它们上面，这里会红。
const USER_LEVEL_FEEDBACK = [
  ["POST", "/api/insights/999999999/hide", undefined],
  ["POST", "/api/insights/999999999/unhide", undefined],
  // 空 body -> toPurpose 不合法 -> handler 在任何写库之前就 400，因此这条零副作用
  ["POST", "/api/insights/999999999/reclassify", {}]
];

describe("apiRoutes auth matrix", () => {
  let admin, user;

  beforeEach(() => {
    clearAuthTables();
    jars.clear();
    admin = insertTestUser({ unionid: "mtx-adm", role: "admin" });
    user = insertTestUser({ unionid: "mtx-std" });
  });

  // 测试库跨进程持久，sessions / user_views 都有外键指向 users(id)；残留行会让别的套件炸 FK
  afterAll(() => { clearAuthTables(); });

  it("anonymous callers get JSON 401 on every protected prefix, and 200 on the public ones", async () => {
    const { port, close } = await listen(buildApp());
    try {
      for (const p of PUBLIC_PATHS) {
        const r = await call(port, p, null);
        expect(r.status, `${p} 必须匿名可达`).toBe(200);
      }
      // 健康检查的响应形状不许变（外部监控可能在打它；容器没有 HEALTHCHECK，但不能假定没有外部探测）
      const health = await call(port, "/api/health", null);
      expect(health.body.status).toBe("ok");
      expect(typeof health.body.timestamp).toBe("string");

      for (const p of PROTECTED_PREFIXES) {
        const r = await call(port, p, null);
        expect(r.status, `${p} 匿名必须是 401（不是 404、不是 200）`).toBe(401);
        expect(r.body, `${p} 的 401 必须是 JSON 信封`).toEqual({ error: "unauthorized" });
      }
    } finally { await close(); }
  });

  it("a plain logged-in user gets 403 on every admin-only prefix", async () => {
    const { port, close } = await listen(buildApp());
    try {
      for (const p of ADMIN_ONLY_READS) {
        const r = await call(port, p, user.id);
        expect(r.status, `${p} 对普通用户必须是 403`).toBe(403);
        expect(r.body, `${p} 的 403 必须是 JSON 信封`).toEqual({ error: "forbidden" });
      }
    } finally { await close(); }
  });

  it("an admin is let through the admin-only prefixes (positive control: the 403s mean something)", async () => {
    const { port, close } = await listen(buildApp());
    try {
      // 没有这条正向对照，「全部 403」也能让上面那个用例全绿——比如把 requireAdmin 写成
      // 无条件拒绝。这里确认 admin 真的进得去，403 才是有意义的信号。
      for (const p of ADMIN_ONLY_READS) {
        const r = await call(port, p, admin.id);
        expect(r.status, `${p} 对 admin 不该是 401/403`).not.toBe(401);
        expect(r.status, `${p} 对 admin 不该是 403`).not.toBe(403);
        expect(r.status, `${p} 对 admin 应当正常返回`).toBe(200);
      }
    } finally { await close(); }
  });

  it("admin-only write routes reject a plain user with 403 before reaching the handler", async () => {
    const { port, close } = await listen(buildApp());
    try {
      for (const [method, p] of ADMIN_ONLY_WRITES) {
        const r = await call(port, p, user.id, { method, body: {} });
        expect(r.status, `${method} ${p} 对普通用户必须是 403`).toBe(403);
      }
      // 403 必须发生在 handler 之前：这些写操作一个都不许落库。
      // POST /api/filters/rules 若真跑到 handler，会先 await generateAliases()（一次 LLM 调用）
      // 再 INSERT 一行，所以「表仍是空的」既证明没写库、也证明没打 LLM。
      expect(db.prepare("SELECT COUNT(*) c FROM filter_rules").get().c).toBe(0);
      expect(db.prepare("SELECT COUNT(*) c FROM industry_categories").get().c).toBe(0);
    } finally { await close(); }
  });

  it("user-level feedback writes stay open to every logged-in user (not admin-gated)", async () => {
    const { port, close } = await listen(buildApp());
    try {
      for (const [method, p, body] of USER_LEVEL_FEEDBACK) {
        const r = await call(port, p, user.id, { method, body });
        // 断言的是「没有被鉴权挡掉」这个性质本身，而不是各 handler 具体返回什么：
        // hide/unhide 对不存在的 id 返回 200，reclassify 空 body 返回 400，两者都算通过。
        expect(r.status, `${method} ${p} 不该要求 admin`).not.toBe(403);
        expect(r.status, `${method} ${p} 用户已登录，不该 401`).not.toBe(401);
      }
      // 同一个用户读 insights 列表也应当放行（ContentFiltersPage 主体高亮要读 rules）
      expect((await call(port, "/api/insights", user.id)).status).toBe(200);
      expect((await call(port, "/api/filters/rules", user.id)).status).toBe(200);
    } finally { await close(); }
  });
});

// 畸形 JSON 过去会掉到 express 的默认错误处理器：一段 text/html 页面，正文里带着
// SyntaxError 的原始消息**和整个请求体**（body-parser 把 err.body 挂在错误上）。
// 对匿名可达的 /api/auth/register 来说这就是一个反射式回显 + 内部信息泄漏。
describe("apiRoutes error envelope", () => {
  let admin, user;
  let spy;

  beforeEach(() => {
    clearAuthTables();
    jars.clear();
    // 中央错误中间件会 console.error 记录详情（这是它该有的行为），
    // 测试里静音掉，免得污染 stderr 基线
    spy = vi.spyOn(console, "error").mockImplementation(() => {});
    admin = insertTestUser({ unionid: "err-adm", role: "admin" });
    user = insertTestUser({ unionid: "err-std" });
  });

  afterEach(() => { spy.mockRestore(); });
  afterAll(() => { clearAuthTables(); });

  // 覆盖公开 / 登录 / admin-only 三类路径：body 解析发生在 express.json()，
  // 比 requireAuth、requireAdmin 都早，所以三者的响应形状必须完全一致（不能按角色分叉）。
  const MALFORMED_TARGETS = [
    ["POST", "/api/auth/register", null],
    ["POST", "/api/views", "user"],
    ["PUT", "/api/tracker-settings", "admin"]
  ];

  it("malformed JSON yields a JSON 400 envelope, never express's HTML error page", async () => {
    const { port, close } = await listen(buildApp());
    try {
      for (const [method, path, who] of MALFORMED_TARGETS) {
        const userId = who === "admin" ? admin.id : who === "user" ? user.id : null;
        const r = await rawCall(port, path, '{"name": "oops",,,}', { method, userId });
        expect(r.status, `${method} ${path} 畸形 body 必须是 400`).toBe(400);
        expect(r.contentType, `${method} ${path} 必须回 JSON 而不是 text/html`).toContain("application/json");
        const parsed = JSON.parse(r.text);   // 解析不了就直接抛，用例失败
        expect(parsed, `${method} ${path} 信封必须是 { error }`).toEqual({ error: "invalid request body" });
        // 不回显：SyntaxError 的消息里带原始 token，body-parser 还会把 err.body 挂在错误上
        expect(r.text, `${method} ${path} 不得回显解析器消息`).not.toContain("Unexpected");
        expect(r.text, `${method} ${path} 不得回显请求体`).not.toContain("oops");
      }
    } finally { await close(); }
  });

  it("a handler that throws surfaces as a JSON 500, never the message or a stack trace", async () => {
    const { port, close } = await listen(buildAppWithProbe());
    try {
      const r = await rawCall(port, "/api/__boom", undefined, { method: "GET" });
      expect(r.status, "抛异常必须是 500").toBe(500);
      expect(r.contentType, "必须是 JSON 信封而不是 text/html 堆栈页").toContain("application/json");
      expect(JSON.parse(r.text), "信封必须是固定的 { error }").toEqual({ error: "internal server error" });
      expect(r.text, "不得回显 e.message（这条消息里刻意塞了 schema 内部信息）").not.toContain("boom");
      expect(r.text).not.toContain("secret_table");
    } finally { await close(); }
  });
});

describe("invite limiter is per real client IP", () => {
  beforeEach(() => {
    clearAuthTables();
    // 限速桶是 auth.js 的模块级状态，不清就会跨用例累积出假 429
    __resetInviteLimiter();
  });

  afterAll(() => { clearAuthTables(); });

  const register = (port, ip) => fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    // ticket 是假的 -> 服务端在票据校验处 400，全程零写库，只消耗一个限速配额
    body: JSON.stringify({ ticket: "nope", code: "nope" })
  }).then((r) => r.status);

  it("five attempts per IP, then 429 — and a different client IP keeps its own quota", async () => {
    const { port, close } = await listen(buildApp());
    try {
      for (let i = 1; i <= 5; i++) {
        const s = await register(port, "1.2.3.4");
        expect(s, `1.2.3.4 第 ${i} 次应走到票据校验（400）而不是被限速`).toBe(400);
      }
      expect(await register(port, "1.2.3.4"), "同一个真实 IP 第 6 次必须 429").toBe(429);

      // 这条才是判别式：没设 trust proxy 时 req.ip 恒为 127.0.0.1，
      // 所有客户端共用一个桶，换一个 IP 也立刻 429 —— 限速退化成「全局 5 次/分钟」，
      // 一个攻击者就能把所有人的注册通道锁死。
      expect(await register(port, "5.6.7.8"), "不同真实 IP 必须有独立配额").not.toBe(429);
      expect(await register(port, "5.6.7.8"), "独立配额意味着它也走到票据校验").toBe(400);
    } finally { await close(); }
  });
});
