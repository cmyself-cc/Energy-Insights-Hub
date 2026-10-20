import crypto from "node:crypto";
import db from "../db.js";

// 用户名+邀请码体系的身份合成（产品负责人 2026-10-21）。
// 从 server/routes/auth.js 抽出为共享 lib：admin.js 的「超管护锁」与启动种子都要算
// 同一个 unionid，定义必须只有一份。
export const pairUnionid = (code, username) =>
  "pair-" + crypto.createHash("sha256")
    .update(`${String(code || "").trim().toUpperCase()}:${String(username || "").trim()}`)
    .digest("hex");

// ── 内置超级管理员（产品负责人 2026-10-21 指定）──
// 账号 admin / 邀请码 admin123456：不可停用、不可改角色（admin.js PATCH 硬门禁），
// 其邀请码也不可被停用（新注册永远开放，存量登录本就不受码生命周期影响）。
// 账号本体不走迁移/启动 INSERT —— 首次用 pair 注册自然建号（码 role=admin），
// 这样密码学上依旧「码即凭证」，没有旁路。
export const SUPER_ADMIN = { CODE: "ADMIN123456", USERNAME: "admin" };
export const superAdminUnionid = () => pairUnionid(SUPER_ADMIN.CODE, SUPER_ADMIN.USERNAME);

// 幂等种子：确保超管邀请码存在（不重建、不改已有行的配置）。进程启动时调用一次。
export function ensureSuperAdminInvite() {
  const existing = db.prepare("SELECT * FROM invite_codes WHERE code = ?").get(SUPER_ADMIN.CODE);
  if (!existing) {
    // max_uses=1：超管只有一个名额 —— 注册完即枯竭，此码不能再出任何新号（管理员也不行）
    db.prepare(
      `INSERT INTO invite_codes (code, label, role, max_uses, expires_at, note)
       VALUES (?, '内置超级管理员（不可停用）', 'admin', 1, NULL, ?)`
    ).run(SUPER_ADMIN.CODE, "用户名 admin + 本码 开通即超级管理员；仅此一个名额");
    return;
  }
  // 自愈：早期版本种下的 max_uses NULL 行纠正为 1（幂等，覆盖手改）
  if (existing.max_uses !== 1 || existing.role !== "admin") {
    db.prepare("UPDATE invite_codes SET max_uses = 1, role = 'admin' WHERE id = ?").run(existing.id);
  }
}
