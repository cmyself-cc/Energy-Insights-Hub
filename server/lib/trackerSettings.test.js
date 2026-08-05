import { describe, it, expect, beforeEach } from "vitest";
import db, { initDb } from "../db.js";
import { loadSettings, buildScheduleCron, filterSourcesByType, SOURCE_TYPES } from "./trackerSettings.js";

describe("trackerSettings", () => {
  beforeEach(() => {
    initDb();
    db.prepare("DELETE FROM tracker_settings").run();
  });

  function save(key, value) {
    db.prepare(
      "INSERT INTO tracker_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    ).run(key, value);
  }

  describe("schedule settings", () => {
    it("defaults to enabled, daily, 05:00 when no schedule keys exist", () => {
      const s = loadSettings();
      expect(s.scheduleEnabled).toBe(true);
      expect(s.scheduleFrequency).toBe("daily");
      expect(s.scheduleTime).toBe("05:00");
    });

    it("loads persisted schedule values", () => {
      save("schedule_enabled", "0");
      save("schedule_frequency", "weekly");
      save("schedule_time", "09:30");
      save("schedule_weekday", "3");

      const s = loadSettings();
      expect(s.scheduleEnabled).toBe(false);
      expect(s.scheduleFrequency).toBe("weekly");
      expect(s.scheduleTime).toBe("09:30");
      expect(s.scheduleWeekday).toBe(3);
    });
  });

  describe("source-type filtering", () => {
    it("returns no sources when the enabled list is empty (nothing crawled)", () => {
      const sources = [
        { id: 1, type: "website" },
        { id: 2, type: "rss" },
        { id: 3, type: "wechat_mcp" }
      ];
      expect(filterSourcesByType(sources, [])).toEqual([]);
    });

    it("keeps only enabled types when the list is set", () => {
      const sources = [
        { id: 1, type: "website" },
        { id: 2, type: "rss" },
        { id: 3, type: "wechat_mcp" }
      ];
      const result = filterSourcesByType(sources, ["website", "rss"]);
      expect(result.map(s => s.id)).toEqual([1, 2]);
    });

    it("defaults to all legal source types when the setting was never saved", () => {
      const s = loadSettings();
      expect(s.enabledSourceTypes).toEqual(["rss", "website", "wechat_mcp"]);
    });

    it("loads the persisted enabled-source-type list", () => {
      save("enabled_source_types", "website,rss");
      expect(loadSettings().enabledSourceTypes).toEqual(["website", "rss"]);
    });

    it("returns an empty list when the setting was explicitly saved as empty", () => {
      save("enabled_source_types", "");
      expect(loadSettings().enabledSourceTypes).toEqual([]);
    });
  });

  describe("buildScheduleCron", () => {
    it("builds a daily cron from the time", () => {
      expect(buildScheduleCron({ scheduleFrequency: "daily", scheduleTime: "05:00" })).toBe("0 5 * * *");
    });

    it("builds a weekly cron on the selected weekday", () => {
      // weekday 0 = Sunday
      expect(buildScheduleCron({ scheduleFrequency: "weekly", scheduleTime: "09:30", scheduleWeekday: 0 }))
        .toBe("30 9 * * 0");
      expect(buildScheduleCron({ scheduleFrequency: "weekly", scheduleTime: "09:30", scheduleWeekday: 3 }))
        .toBe("30 9 * * 3");
    });

    it("falls back to the default daily 05:00 for an invalid time", () => {
      expect(buildScheduleCron({ scheduleFrequency: "daily", scheduleTime: "25:99" })).toBe("0 5 * * *");
    });
  });

  it("exposes the legal source types from the sources page", () => {
    expect(SOURCE_TYPES).toEqual(["rss", "website", "wechat_mcp"]);
  });
});
