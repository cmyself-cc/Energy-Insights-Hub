import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import db, { initDb } from "../db.js";

// ── 公共 helper ────────────────────────────────────────────────
const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

function migrationFilesBefore(before) {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && f < before)
    .sort();
}

function freshDb() {
  const file = path.join(os.tmpdir(), `eih-024-test-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
  const conn = new Database(file);
  return { conn, file };
}

function applyMigrations(conn, files) {
  for (const f of files) {
    conn.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
  }
}

function columnInfo(conn, table, name) {
  return conn.prepare(`PRAGMA table_info(${table})`).all().find((c) => c.name === name);
}

// 024 之后应有的六列
const EXPECTED_COLUMNS = [
  ["reports", "owner_id"],
  ["report_jobs", "owner_id"],
  ["report_templates", "owner_id"],
  ["user_feedback", "user_id"],
  ["user_feedback", "submit_state"],
  ["feedback_rules_suggestions", "submitter_id"],
];

// ── Part 1：共享测试库上的 schema 契约（initDb 走真 runner）──
describe("migration 024 resource ownership — shared test DB schema", () => {
  const inserted = { feedbackIds: [], templateIds: [] };

  beforeEach(() => {
    initDb();
  });

  afterEach(() => {
    for (const id of inserted.feedbackIds) {
      db.prepare("DELETE FROM user_feedback WHERE id = ?").run(id);
    }
    for (const id of inserted.templateIds) {
      db.prepare("DELETE FROM report_templates WHERE id = ?").run(id);
    }
    inserted.feedbackIds = [];
    inserted.templateIds = [];
  });

  it("creates the six ownership columns", () => {
    for (const [table, column] of EXPECTED_COLUMNS) {
      expect(columnInfo(db, table, column), `${table}.${column}`).toBeTruthy();
    }
  });

  it("user_feedback.submit_state is TEXT NOT NULL DEFAULT 'none' with a CHECK constraint", () => {
    const col = columnInfo(db, "user_feedback", "submit_state");
    expect(col.type).toBe("TEXT");
    expect(col.notnull).toBe(1);
    expect(col.dflt_value).toBe("'none'");

    const { lastInsertRowid } = db
      .prepare("INSERT INTO user_feedback (action, submit_state) VALUES ('hide', 'submitted')")
      .run();
    inserted.feedbackIds.push(Number(lastInsertRowid));
    const row = db.prepare("SELECT submit_state FROM user_feedback WHERE id = ?").get(lastInsertRowid);
    expect(row.submit_state).toBe("submitted");

    expect(() =>
      db.prepare("INSERT INTO user_feedback (action, submit_state) VALUES ('hide', 'bogus')").run()
    ).toThrow(/CHECK/i);

    // 缺省落 'none'
    const { lastInsertRowid: id2 } = db.prepare("INSERT INTO user_feedback (action) VALUES ('hide')").run();
    inserted.feedbackIds.push(Number(id2));
    expect(db.prepare("SELECT submit_state FROM user_feedback WHERE id = ?").get(id2).submit_state).toBe("none");
  });

  it("user_feedback.submit_state accepts every state of the allowed set", () => {
    for (const state of ["submitted", "accepted", "rejected"]) {
      const { lastInsertRowid } = db
        .prepare("INSERT INTO user_feedback (action, submit_state) VALUES ('hide', ?)")
        .run(state);
      inserted.feedbackIds.push(Number(lastInsertRowid));
    }
  });

  it("report_templates.is_public behavior is unchanged (default still 1)", () => {
    const col = columnInfo(db, "report_templates", "is_public");
    expect(col).toBeTruthy();
    const { lastInsertRowid } = db
      .prepare("INSERT INTO report_templates (name, prompt) VALUES ('t-024-probe', 'p')")
      .run();
    inserted.templateIds.push(Number(lastInsertRowid));
    const row = db.prepare("SELECT is_public FROM report_templates WHERE id = ?").get(lastInsertRowid);
    expect(row.is_public).toBe(1);
  });
});

// ── Part 2：全新临时库端到端回填验证（直接执行 024.sql 真文件）──
describe("migration 024 resource ownership — fresh DB backfill", () => {
  const tmpFiles = [];

  function makeMigratedDb({ withAdmin }) {
    const { conn, file } = freshDb();
    tmpFiles.push(file);
    applyMigrations(conn, migrationFilesBefore("024_resource_ownership.sql"));
    if (withAdmin) {
      // 023 建的 users 表。先插 admin 再插普通用户，验证回填挑的是**第一个** admin 而不是别的行。
      conn.prepare("INSERT INTO users (unionid, nickname, role) VALUES ('seed-admin', 'Seed Admin', 'admin')").run();
      conn.prepare("INSERT INTO users (unionid, nickname, role) VALUES ('u-x', 'Plain', 'user')").run();
    } else {
      conn.prepare("INSERT INTO users (unionid, nickname, role) VALUES ('u-x', 'Plain', 'user')").run();
    }
    // 024 之前的存量行：此时还没有 owner 列。
    conn.prepare("INSERT INTO reports (title, content) VALUES ('R1', 'C')").run();
    conn.prepare("INSERT INTO report_jobs (report_id) VALUES (1)").run();
    conn.prepare("INSERT INTO report_templates (name, prompt, is_public) VALUES ('pub', 'p', 1)").run();
    conn.prepare("INSERT INTO report_templates (name, prompt, is_public) VALUES ('priv', 'p', 0)").run();
    conn.prepare("INSERT INTO user_feedback (action) VALUES ('hide')").run();
    conn.prepare("INSERT INTO feedback_rules_suggestions (type, name) VALUES ('enterprise', 'Acme')").run();
    // 执行真正的迁移文件
    applyMigrations(conn, ["024_resource_ownership.sql"]);
    return conn;
  }

  afterEach(() => {
    for (const f of tmpFiles) {
      try { fs.unlinkSync(f); } catch { /* 已被连接清理则忽略 */ }
    }
    tmpFiles.length = 0;
  });

  it("backfills owner_id/user_id to the FIRST admin's id on all five tables", () => {
    const conn = makeMigratedDb({ withAdmin: true });
    const admin = conn.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get();
    expect(admin).toBeTruthy();

    for (const [table, column] of EXPECTED_COLUMNS) {
      const col = columnInfo(conn, table, column);
      expect(col, `${table}.${column} 存在`).toBeTruthy();
    }
    expect(conn.prepare("SELECT owner_id FROM reports WHERE id=1").get().owner_id).toBe(admin.id);
    expect(conn.prepare("SELECT owner_id FROM report_jobs WHERE id=1").get().owner_id).toBe(admin.id);
    const tplOwners = conn.prepare("SELECT owner_id FROM report_templates ORDER BY id").all();
    expect(tplOwners.every((r) => r.owner_id === admin.id)).toBe(true);
    expect(conn.prepare("SELECT user_id FROM user_feedback WHERE id=1").get().user_id).toBe(admin.id);
    // submitter_id 刻意**不回填**（迁移文件里的注释）：存量建议全是匿名系统生成物，
    // 挂到某个管理员头上是伪造归属。Task 12 之后产生的建议才会写 submitter_id。
    expect(conn.prepare("SELECT submitter_id FROM feedback_rules_suggestions WHERE id=1").get().submitter_id).toBeNull();
    conn.close();
  });

  it("preserves is_public values while backfilling report_templates", () => {
    const conn = makeMigratedDb({ withAdmin: true });
    const rows = conn.prepare("SELECT name, is_public, owner_id FROM report_templates ORDER BY id").all();
    expect(rows[0]).toMatchObject({ name: "pub", is_public: 1 });
    expect(rows[1]).toMatchObject({ name: "priv", is_public: 0 });
    conn.close();
  });

  it("leaves ownership columns NULL when no admin exists (nothing to attribute to)", () => {
    const conn = makeMigratedDb({ withAdmin: false });
    expect(conn.prepare("SELECT owner_id FROM reports WHERE id=1").get().owner_id).toBeNull();
    expect(conn.prepare("SELECT owner_id FROM report_jobs WHERE id=1").get().owner_id).toBeNull();
    expect(conn.prepare("SELECT user_id FROM user_feedback WHERE id=1").get().user_id).toBeNull();
    // submit_state 的 DEFAULT 对存量行也生效（ADD COLUMN ... DEFAULT 回填存量行）
    expect(conn.prepare("SELECT submit_state FROM user_feedback WHERE id=1").get().submit_state).toBe("none");
    conn.close();
  });

  it("submit_state CHECK and default hold on the fresh DB too", () => {
    const conn = makeMigratedDb({ withAdmin: true });
    conn.prepare("INSERT INTO user_feedback (action, submit_state) VALUES ('hide', 'accepted')").run();
    expect(() =>
      conn.prepare("INSERT INTO user_feedback (action, submit_state) VALUES ('hide', 'weird')").run()
    ).toThrow(/CHECK/i);
    const { lastInsertRowid } = conn.prepare("INSERT INTO user_feedback (action) VALUES ('hide')").run();
    expect(conn.prepare("SELECT submit_state FROM user_feedback WHERE id=?").get(lastInsertRowid).submit_state).toBe("none");
    conn.close();
  });
});
