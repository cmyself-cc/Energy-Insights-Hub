import { describe, it, expect, beforeEach } from "vitest";
import db, { initDb } from "../db.js";

function resetTables() {
  db.prepare("DELETE FROM sessions").run();
  db.prepare("DELETE FROM pending_identities").run();
  db.prepare("DELETE FROM invite_codes").run();
  // user_views 有外键指向 users(id)，且 better-sqlite3 默认 PRAGMA foreign_keys=1；
  // 不先清它，DELETE FROM users 会抛 FOREIGN KEY constraint failed。
  db.prepare("DELETE FROM user_views").run();
  db.prepare("DELETE FROM users").run();
}

describe("migration 023 users auth", () => {
  beforeEach(() => {
    initDb();
    resetTables();
  });

  it("creates users table with role check constraint", () => {
    db.prepare(`INSERT INTO users (unionid, nickname, role) VALUES ('u1', 'N1', 'admin')`).run();
    expect(db.prepare("SELECT role FROM users WHERE unionid='u1'").get().role).toBe("admin");
    expect(() =>
      db.prepare(`INSERT INTO users (unionid, nickname, role) VALUES ('u2', 'N2', 'root')`).run()
    ).toThrow();
  });

  it("creates invite_codes with nullable limits (reusable by default)", () => {
    db.prepare(`INSERT INTO invite_codes (code, label, role) VALUES ('ABC123', 'team', 'user')`).run();
    const row = db.prepare("SELECT * FROM invite_codes WHERE code='ABC123'").get();
    expect(row.max_uses).toBeNull();
    expect(row.expires_at).toBeNull();
    expect(row.used_count).toBe(0);
    expect(row.active).toBe(1);
  });

  it("creates sessions and pending_identities tables", () => {
    const { lastInsertRowid: userId } = db.prepare(`INSERT INTO users (unionid, nickname, role) VALUES ('u8', 'N8', 'user')`).run();
    db.prepare(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, 'h1', '2030-01-01 00:00:00')`).run(userId);
    db.prepare(`INSERT INTO pending_identities (token_hash, unionid, expires_at) VALUES ('p1', 'u9', '2030-01-01 00:00:00')`).run();
    expect(db.prepare("SELECT 1 FROM sessions WHERE token_hash='h1'").get()).toBeTruthy();
    expect(db.prepare("SELECT 1 FROM pending_identities WHERE token_hash='p1'").get()).toBeTruthy();
  });
});
