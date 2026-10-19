import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import db, { initDb } from "./db.js";
import { mountApiRoutes } from "./apiRoutes.js";
import { startScheduler, reconcileStaleRuns } from "./services/tracker.js";
import { seedSources } from "./seeds/002_seed_sources.js";
import { seedIndustryCategories } from "./seeds/seedIndustryCategories.js";
import { seedDefaults } from "./seeds/seedDefaults.js";
import { seedReportTemplates } from "./services/reportTemplateService.js";
import { seedSearchProviders } from "./services/searchProviderService.js";
import { seedLlmPrompts } from "./services/promptStore.js";
import { startJobRunner } from "./services/reportGenerator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

initDb();
// 上一次进程若被强杀（SIGTERM/OOM/断电），会留下 status='running' 的僵尸运行记录，
// 在 1 小时窗口内把之后每次抓取都秒跳过。启动时对账，任何崩溃都能自愈。
reconcileStaleRuns();
seedSources();
seedIndustryCategories();
seedDefaults();
seedReportTemplates();
seedSearchProviders();
seedLlmPrompts();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

mountApiRoutes(app);

// 生产环境：提供静态前端构建产物
const distPath = path.join(__dirname, "..", "dist");
if (process.env.NODE_ENV === "production" && fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  startScheduler();
  startJobRunner();
});

// 优雅关闭
process.on("SIGINT", () => {
  db.close();
  process.exit(0);
});
