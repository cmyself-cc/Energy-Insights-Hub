import crypto from "node:crypto";
import db from "../db.js";

export const SESSION_TTL_DAYS = 7;
const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");

export function createSession(userId, userAgent = "") {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare(
    "INSERT INTO sessions (user_id, token_hash, user_agent, expires_at) VALUES (?, ?, ?, datetime('now', '+' || ? || ' days'))"
  ).run(userId, hash(token), String(userAgent).slice(0, 200), SESSION_TTL_DAYS);
  return token;
}

export function resolveSession(token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT s.*, u.unionid, u.nickname, u.avatar_url, u.role, u.status
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
  ).get(hash(token));
  if (!row) return null;
  const expired = db.prepare("SELECT datetime('now') > ? AS e").get(row.expires_at).e === 1;
  if (expired || row.status !== "active") {
    if (expired) db.prepare("DELETE FROM sessions WHERE id=?").run(row.id);
    return null;
  }
  db.prepare(
    `UPDATE sessions SET expires_at = datetime('now', '+' || ? || ' days') WHERE id = ?`
  ).run(SESSION_TTL_DAYS, row.id);
  return { user: { id: row.user_id, unionid: row.unionid, nickname: row.nickname, avatar_url: row.avatar_url, role: row.role, status: row.status } };
}

export function destroySession(token) {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash(token));
}
