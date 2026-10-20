import { describe, it, expect, beforeEach, afterAll } from "vitest";
import db from "../db.js";
import { createSession, resolveSession, destroySession } from "./sessions.js";
import { insertTestUser, clearAuthTables } from "../testUtils.js";

describe("sessions", () => {
  beforeEach(() => { clearAuthTables(); });

  // 文件级清理（R2 规则：凡是写 auth 表的测试文件都要带这个钩子）。
  // beforeEach 只保证**本文件内**每个用例从干净状态开始，管不到文件跑完之后：
  // 最后一个用例（destroySession）删掉的是 session 行，不是 user 行，所以本文件单跑
  // 会在测试库留下 users=1（u4）。实测过：`npx vitest run server/lib/sessions.test.js`
  // 加这个钩子之前留 users=1，之后 5 张 auth 表全 0。
  // 全量跑之所以看起来干净，只是因为 023_users_auth.test.js 恰好在写 auth 表的文件里
  // **最后完成**、它的 beforeEach 顺手擦掉了残留 —— 而 vitest 不承诺完成顺序。
  // initDb() 的耦合顾虑在这里不成立：本文件的 beforeEach 早就在调 clearAuthTables() 了。
  afterAll(() => { clearAuthTables(); });

  it("creates and resolves a session, sliding expiry", () => {
    const u = insertTestUser({ unionid: "u1" });
    const token = createSession(u.id, "vitest");
    const hit = resolveSession(token);
    expect(hit.user.id).toBe(u.id);
    const row = db.prepare("SELECT * FROM sessions WHERE user_id=?").get(u.id);
    expect(row.token_hash).not.toBe(token);            // 只存哈希
    expect(row.token_hash).toBe(require("node:crypto").createHash("sha256").update(token).digest("hex"));
    // 滑动续期：把有效期压到 +3 天，一次 resolveSession 应把它推回 +7 天（SQL 侧比较，不用 JS 时间串）
    db.prepare("UPDATE sessions SET expires_at = datetime('now','+3 days') WHERE user_id=?").run(u.id);
    expect(resolveSession(token)).not.toBeNull();
    const daysLeft = db.prepare(
      "SELECT (julianday(expires_at) - julianday('now')) AS d FROM sessions WHERE user_id=?"
    ).get(u.id).d;
    expect(daysLeft).toBeGreaterThan(6.9);
    expect(daysLeft).toBeLessThan(7.1);
  });

  it("rejects unknown token and expired session", () => {
    expect(resolveSession("deadbeef")).toBeNull();
    const u = insertTestUser({ unionid: "u2" });
    const token = createSession(u.id, "");
    db.prepare("UPDATE sessions SET expires_at = datetime('now','-1 day') WHERE user_id=?").run(u.id);
    expect(resolveSession(token)).toBeNull();
  });

  it("disabled user session stops resolving", () => {
    const u = insertTestUser({ unionid: "u3" });
    const token = createSession(u.id, "");
    db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(u.id);
    expect(resolveSession(token)).toBeNull();
  });

  it("destroySession deletes the row", () => {
    const u = insertTestUser({ unionid: "u4" });
    const token = createSession(u.id, "");
    destroySession(token);
    expect(resolveSession(token)).toBeNull();
  });
});
