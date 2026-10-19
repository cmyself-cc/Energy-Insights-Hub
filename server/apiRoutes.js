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
}
