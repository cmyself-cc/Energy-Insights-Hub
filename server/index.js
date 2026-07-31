import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import db, { initDb } from "./db.js";
import sourcesRouter from "./routes/sources.js";
import insightsRouter from "./routes/insights.js";
import reportsRouter from "./routes/reports.js";
import trackerRouter from "./routes/tracker.js";
import settingsRouter from "./routes/settings.js";
import filtersRouter from "./routes/filters.js";
import feedbackRoutes from "./routes/feedback.js";
import industriesRouter from "./routes/industries.js";
import { startScheduler } from "./services/tracker.js";
import { seedSources } from "./seeds/002_seed_sources.js";
import { seedIndustryCategories } from "./seeds/seedIndustryCategories.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

initDb();
seedSources();
seedIndustryCategories();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use("/api/sources", sourcesRouter);
app.use("/api/insights", insightsRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/tracker", trackerRouter);
app.use("/api/tracker-settings", settingsRouter);
app.use("/api/filters", filtersRouter);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/industries", industriesRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

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
});

// 优雅关闭
process.on("SIGINT", () => {
  db.close();
  process.exit(0);
});
