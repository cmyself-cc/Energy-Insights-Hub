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

// 把挂载表抽成独立模块的唯一理由是可测性：server/index.js 在模块加载时就 initDb() + 跑 6 个
// seed + reconcileStaleRuns()，末尾直接 app.listen() 并启动抓取调度器，任何测试 import 它都会
// 绑死 :3001 并对测试库真去抓网站。而这张挂载表是整个「分用户分角色管理」计划的鉴权边界——
// 它必须能被 apiRoutes.test.js 直接断言，否则将来谁摘掉一个 requireAuth 都没有测试会红。
//
// 约定：本函数只做「挂载」，不 listen、不 seed、不启动任何后台任务，因此 import 它是零副作用的。
export function mountApiRoutes(app) {
  app.use("/api/sources", sourcesRouter);
  app.use("/api/insights", insightsRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/tracker", trackerRouter);
  app.use("/api/tracker-settings", settingsRouter);
  app.use("/api/filters", filtersRouter);
  app.use("/api/feedback", feedbackRoutes);
  app.use("/api/industries", industriesRouter);
  app.use("/api/models", modelsRouter);
  app.use("/api/search-providers", searchProvidersRouter);
  app.use("/api/ai", aiRouter);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });
}
