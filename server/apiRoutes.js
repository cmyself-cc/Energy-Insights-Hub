import sourcesRouter from "./routes/sources.js";
import insightsRouter from "./routes/insights.js";
import reportsRouter from "./routes/reports.js";
import trackerRouter from "./routes/tracker.js";
import settingsRouter from "./routes/settings.js";
import filtersRouter from "./routes/filters.js";
import feedbackRoutes from "./routes/feedback.js";
import industriesRouter from "./routes/industries.js";
import modelsRouter from "./routes/models.js";
import searchProvidersRouter from "./routes/searchProviders.js";
import aiRouter from "./routes/ai.js";
import authRouter from "./routes/auth.js";
import viewsRouter from "./routes/views.js";
import adminRouter from "./routes/admin.js";
import { requireAuth, requireAdmin } from "./lib/authMiddleware.js";

// 把挂载表抽成独立模块的唯一理由是可测性：server/index.js 在模块加载时就 initDb() + 跑 6 个
// seed + reconcileStaleRuns()，末尾直接 app.listen() 并启动抓取调度器，任何测试 import 它都会
// 绑死 :3001 并对测试库真去抓网站。而这张挂载表是整个「分用户分角色管理」计划的鉴权边界——
// 它必须能被 apiRoutes.test.js 直接断言，否则将来谁摘掉一个 requireAuth 都没有测试会红。
//
// 约定：本函数只做「挂载」，不 listen、不 seed、不启动任何后台任务，因此 import 它是零副作用的。
//
// 🔴 挂载形状是硬约束：中间件必须写在 router **之前**，即
//       app.use("/api/views", requireAuth, viewsRouter)
// 而不是 app.use("/api/views", viewsRouter) 再去 router 内部自我施加。views.js / admin.js 的
// handler 都直接读 req.user.id，少了前置中间件就会 TypeError → 500 HTML。失败方向是 fail-closed
// （不是鉴权绕过），所以是可用性问题而非安全问题，但形状必须写死，别改。
export function mountApiRoutes(app) {
  // 生产是**单跳** Caddy（`curl -D - https://eih.cmyself.cc/api/health` 回 `via: 1.1 Caddy`），
  // 所以只信任最近一跳：req.ip 取到 Caddy 追加的真实客户端 IP，客户端自己塞在左边的伪造值
  // 会被 express 忽略。不设的话 req.ip 恒为代理地址，auth.js 的邀请码限速会退化成
  // 「全局 5 次/分钟」——一个攻击者就能把所有人的注册通道锁死。
  //
  // 这行语义上影响整个 app 而不只是 API，放在这里是刻意的轻微越界，理由是可测性：
  // apiRoutes.test.js 直接断言 per-IP 配额，而 index.js 一 import 就 listen + 跑 seed +
  // 启动抓取调度器，测不了。改代理拓扑（比如前面再加一层）时必须同步改这个数字。
  app.set("trust proxy", 1);

  // —— 匿名可达 ——
  // C2：保持 app.get 而不是 brief 写的 app.use。app.use 会匹配所有方法与所有子路径，零收益。
  // 响应形状与 index.js 原来那个逐字一致（外部监控可能在打它；容器虽无 HEALTHCHECK，
  // 但不能假定没有外部探测）。必须挂在受保护路由之前。
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });
  // 登录流程本身必须匿名可达（/config、/wechat/callback、/dev-login、/register）。
  // /api/auth/me 与 /api/auth/logout 在 router 内部各自带 requireAuth，所以前缀级不能加。
  app.use("/api/auth", authRouter);

  // —— 所有登录用户 ——
  // insights / filters / industries 的管理类**写操作**在各自 router 内部逐条叠 requireAdmin；
  // GET 一律保持所有登录用户可读（ContentFiltersPage 的主体高亮要读 rules，前端按角色隐藏入口）。
  app.use("/api/views", requireAuth, viewsRouter);
  app.use("/api/insights", requireAuth, insightsRouter);
  app.use("/api/reports", requireAuth, reportsRouter);
  app.use("/api/filters", requireAuth, filtersRouter);
  app.use("/api/feedback", requireAuth, feedbackRoutes);
  app.use("/api/industries", requireAuth, industriesRouter);
  app.use("/api/ai", requireAuth, aiRouter);

  // —— 仅管理员（整个前缀，含 GET）——
  app.use("/api/admin", requireAuth, requireAdmin, adminRouter);
  app.use("/api/sources", requireAuth, requireAdmin, sourcesRouter);
  app.use("/api/tracker", requireAuth, requireAdmin, trackerRouter);
  app.use("/api/tracker-settings", requireAuth, requireAdmin, settingsRouter);
  app.use("/api/models", requireAuth, requireAdmin, modelsRouter);
  app.use("/api/search-providers", requireAuth, requireAdmin, searchProvidersRouter);

  // —— 中央 JSON 错误中间件，必须挂在所有 **API** 路由之后 ——
  // 挂在 mountApiRoutes 末尾而不是 index.js 末尾，同样是为了 apiRoutes.test.js 能够着它。
  // 它是 4 参处理器：正常请求流会被 express 整个跳过，所以不影响 index.js 里排在后面的
  // express.static / SPA 兜底；而任何 next(err)（含 express.json 的 body 解析错误——
  // 那个中间件在 index.js 里注册得比这里**早**，但 express 找错误处理器时是从出错位置
  // 向后扫，跳过一切非 4 参层）都会落到这里，而不是 express 默认的 text/html 错误页。
  //
  // ⚠️ 作用域只到 API，别把「所有路由之后」读成「覆盖整个 app」：index.js 里排在**本行
  // 之后**的 express.static 与 SPA 的 sendFile 若抛错（磁盘故障、路径问题），next(err)
  // 会绕过本中间件、落到 express 默认的 HTML 错误页。这是刻意接受的——那两条路径本来就是
  // 在给浏览器回 HTML，回一段 HTML 错误页比回一个 JSON 信封更对。
  // 也不要为了「统一」把这个中间件在 index.js 末尾再注册一遍：重复注册会让同一个错误被
  // 处理两次，第二次走进下面的 headersSent 分支、把连接直接销毁。
  app.use(jsonErrorHandler);
}

// body-parser 给错误挂的 type，用来把「客户端发坏了」和「服务端炸了」区分开。
// 状态码取自 err.status（body-parser 自己算的），只接受 4xx，其余一律 500。
// 用 Map 而不是对象字面量：err.type 是字符串下标，对象查表会把 "constructor" /
// "__proto__" 之类的键解析到原型链上，拿回一个函数当响应用。
const BODY_ERROR_ENVELOPES = new Map([
  ["entity.parse.failed", "invalid request body"],
  ["entity.too.large", "request body too large"],
  ["encoding.unsupported", "unsupported body encoding"],
  ["request.aborted", "invalid request body"]
]);

function jsonErrorHandler(err, _req, res, next) {
  const status = typeof err?.status === "number" && err.status >= 400 && err.status < 500 ? err.status : 500;
  const envelope = BODY_ERROR_ENVELOPES.get(err?.type) || (status === 400 ? "bad request" : "internal server error");
  // 详情只落服务端日志，绝不进响应：SyntaxError 的消息带原始 token、body-parser 还把
  // 整个请求体挂在 err.body 上，better-sqlite3 的消息会带出 schema 内部信息。
  // /api/auth/register 匿名可达，回显等于给外部一个反射式探针。
  console.error(`[api] ${status} ${err?.type || "error"}:`, err?.message || err);
  // 响应已经开写了就没法再换状态码/body。此时**不能**直接 return：那会让连接一直挂着
  // 直到超时。交回 express 的默认处理器——它（finalhandler）在 headersSent 时会
  // req.socket.destroy() 把连接干掉，这正是 express 自己的做法。
  // 今天这条分支不可达（本中间件是 API 链路的终点，上游没人写过响应），纯健壮性。
  if (res.headersSent) return next(err);
  res.status(status).json({ error: envelope });
}
