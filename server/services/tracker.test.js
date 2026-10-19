import { describe, it, beforeEach, expect } from "vitest";
import db, { initDb } from "../db.js";
import { reconcileStaleRuns } from "./tracker.js";

// CURRENT_TIMESTAMP 格式（UTC、空格分隔），与 tracker_runs 真实写入保持一致
function recentStartedAt() {
  return new Date(Date.now() - 5 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
}

function insertRun(status, startedAt = recentStartedAt()) {
  return db
    .prepare("INSERT INTO tracker_runs (status, started_at, sources_total) VALUES (?, ?, 77)")
    .run(status, startedAt).lastInsertRowid;
}

function statusOf(id) {
  return db.prepare("SELECT status FROM tracker_runs WHERE id = ?").get(id).status;
}

describe("reconcileStaleRuns", () => {
  beforeEach(() => {
    initDb();
    db.prepare("DELETE FROM tracker_runs").run();
  });

  it("marks a leftover running row as interrupted and returns how many it fixed", () => {
    const id = insertRun("running");

    const count = reconcileStaleRuns();

    expect(count).toBe(1);
    const row = db
      .prepare("SELECT status, finished_at, message FROM tracker_runs WHERE id = ?")
      .get(id);
    expect(row.status).toBe("completed_with_errors");
    expect(row.finished_at).not.toBeNull();
    expect(row.message).toMatch(/中断/);
  });

  it("leaves already-finished runs untouched", () => {
    const done = insertRun("completed");
    const withErrors = insertRun("completed_with_errors");

    const count = reconcileStaleRuns();

    expect(count).toBe(0);
    expect(statusOf(done)).toBe("completed");
    expect(statusOf(withErrors)).toBe("completed_with_errors");
  });

  it("clears the mutex predicate so the next run is not skipped", () => {
    // 复现真实故障：进程被 SIGTERM 杀死后遗留的 running 行，启动时间落在
    // 1 小时窗口内，会让 runTracker 的 hasRunningTrackerInDb 判定"已有别的
    // run 在跑"，把之后每一次抓取都秒跳过（成功 0 / 失败 0 / 新增 0）。
    insertRun("running");

    reconcileStaleRuns();

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const blocking = db
      .prepare(
        "SELECT id FROM tracker_runs WHERE status = 'running' AND datetime(started_at) >= datetime(?) AND id != ?",
      )
      .all(oneHourAgo, 999999);
    expect(blocking).toEqual([]);
  });

  it("reconciles rows left stale for longer than the one hour window", () => {
    // 1 小时窗口只能让僵尸行"不再阻塞"，但它在运行历史里永远显示进行中。
    const ancient = insertRun("running", "2026-09-05 21:00:00");

    const count = reconcileStaleRuns();

    expect(count).toBe(1);
    expect(statusOf(ancient)).toBe("completed_with_errors");
  });
});
