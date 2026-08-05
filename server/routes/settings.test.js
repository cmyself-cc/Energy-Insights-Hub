import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import db, { initDb } from "../db.js";
import settingsRouter from "./settings.js";
import { rescheduleScheduler } from "../services/tracker.js";

vi.mock("../services/tracker.js", () => ({
  rescheduleScheduler: vi.fn(),
  runTracker: vi.fn(),
  stopTracker: vi.fn()
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/tracker-settings", settingsRouter);
  return app;
}

async function putSettings(payload) {
  const app = buildApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/tracker-settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

const VALID_BASE = {
  lookbackHours: 24,
  maxPerSource: 3,
  wechatMcpPerFeedLimit: 10,
  fuzzyDeduplicationThreshold: 0.85
};

describe("PUT /api/tracker-settings", () => {
  beforeEach(() => {
    initDb();
    db.prepare("DELETE FROM tracker_settings").run();
    rescheduleScheduler.mockClear();
  });

  it("rejects an invalid schedule time", async () => {
    const { status } = await putSettings({ ...VALID_BASE, scheduleEnabled: true, scheduleFrequency: "daily", scheduleTime: "25:99" });
    expect(status).toBe(400);
  });

  it("rejects an invalid schedule frequency", async () => {
    const { status } = await putSettings({ ...VALID_BASE, scheduleFrequency: "monthly", scheduleTime: "05:00" });
    expect(status).toBe(400);
  });

  it("rejects a source type that is not in the legal list (wechat_album / tavily are legacy, not selectable)", async () => {
    const { status } = await putSettings({ ...VALID_BASE, enabledSourceTypes: ["website", "wechat_album"] });
    expect(status).toBe(400);
  });

  it("persists schedule and source-type settings and reschedules", async () => {
    const { status, body } = await putSettings({
      ...VALID_BASE,
      scheduleEnabled: true,
      scheduleFrequency: "weekly",
      scheduleTime: "09:30",
      scheduleWeekday: 3,
      enabledSourceTypes: ["website", "rss"]
    });

    expect(status).toBe(200);
    expect(body.data.success).toBe(true);
    expect(rescheduleScheduler).toHaveBeenCalledTimes(1);

    const rows = Object.fromEntries(
      db.prepare("SELECT key, value FROM tracker_settings").all().map(r => [r.key, r.value])
    );
    expect(rows.schedule_enabled).toBe("1");
    expect(rows.schedule_frequency).toBe("weekly");
    expect(rows.schedule_time).toBe("09:30");
    expect(rows.schedule_weekday).toBe("3");
    expect(rows.enabled_source_types).toBe("website,rss");
  });

  it("persists an empty enabledSourceTypes and crawls nothing", async () => {
    await putSettings({ ...VALID_BASE, enabledSourceTypes: [] });
    const rows = Object.fromEntries(
      db.prepare("SELECT key, value FROM tracker_settings").all().map(r => [r.key, r.value])
    );
    expect(rows.enabled_source_types).toBe("");
    const { loadSettings } = await import("../lib/trackerSettings.js");
    expect(loadSettings().enabledSourceTypes).toEqual([]);
  });
});
