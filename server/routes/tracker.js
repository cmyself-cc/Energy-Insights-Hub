import { Router } from "express";
import db from "../db.js";
import { runTracker } from "../services/tracker.js";

const router = Router();

router.post("/run", async (_req, res) => {
  try {
    // 在后台运行，立即返回运行 ID
    const insert = db.prepare(
      "INSERT INTO tracker_runs (status, started_at) VALUES ('running', CURRENT_TIMESTAMP)"
    );
    const result = insert.run();
    const runId = result.lastInsertRowid;

    runTracker(runId).catch(err => {
      console.error("Tracker run failed:", err);
    });

    res.json({ data: { runId, status: "running" } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/runs", (_req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM tracker_runs ORDER BY started_at DESC LIMIT 20").all();
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
