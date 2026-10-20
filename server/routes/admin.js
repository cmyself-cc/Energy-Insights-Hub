import crypto from "node:crypto";
import { Router } from "express";
import db from "../db.js";

const router = Router();

// C10：管理面一律走显式白名单，绝不用 {...u} 全量展开。
// brief 里这个函数叫 publicUser，与 auth.js 里那个**同名但语义相反**的 publicUser 撞车
// （那个是给登录用户看自己的，本来就是白名单式）。改名 adminUser 消除歧义，并显式列出字段：
// 这样将来给 users 加任何列都不会自动泄漏出去。openid_web / openid_mp 是身份提供商的内部
// 标识，不属于管理列表。
const ADMIN_USER_FIELDS = [
  "id", "unionid", "nickname", "avatar_url", "role", "status",
  "invited_by_code_id", "created_at", "last_login_at"
];

// C11：只吞「schema 还没到位」这一类异常。
// reports / report_templates 的 owner_id 要等 Task 8 的 024；在那之前这两条计数会抛
// "no such column"，属预期状态，降级成 null（且不刷日志，否则管理员每打开一次用户列表
// 就是一屏红）。但**其余异常必须记日志**：brief 原来的裸 `catch { return null; }` 会把
// Task 8 之后的真 SQL bug 也伪装成「还没合入」，那样就永远查不出来了。
function countSafe(sql, id) {
  try {
    return db.prepare(sql).get(id).c;
  } catch (e) {
    const msg = String(e?.message || e);
    if (/no such (table|column)/i.test(msg)) return null;
    console.error("[admin] resource count failed:", msg);
    return null;
  }
}

function adminUser(u) {
  const out = {};
  for (const k of ADMIN_USER_FIELDS) out[k] = u[k] ?? null;
  // C7：ADM-3 的只读计数内嵌在列表里，没有独立的 GET /users/:id/resources 路由
  out.resource_counts = {
    reports: countSafe("SELECT COUNT(*) c FROM reports WHERE owner_id=?", u.id),
    templates: countSafe("SELECT COUNT(*) c FROM report_templates WHERE owner_id=?", u.id),
    views: countSafe("SELECT COUNT(*) c FROM user_views WHERE user_id=?", u.id)
  };
  return out;
}

// C3：expires_at 落库前一律在 SQL 侧归一化。
// auth.js 的 POST /register 用 `SELECT datetime('now') < ? AS ok` 比较这一列，而 created_at 由
// CURRENT_TIMESTAMP 落成 'YYYY-MM-DD HH:MM:SS'。若把浏览器 datetime-local / JSON 的 ISO 串
// （带 T/Z）原样存进去，TEXT 字典序里 ' '(0x20) < 'T'(0x54)，日期部分相同、只有时间不同时
// 比较会静默出错——实测「当天午夜、其实早已过期」会被判成 ok=1（未过期），邀请码于是永不过期。
// 这是本仓踩过的同一个坑（server/services/tracker.js 的 reconcileStaleRuns、
// auth.js 的 issuePending 上方注释都有记录；这里刻意不写行号，行号会随改动漂移）。
// datetime() 顺带把带时区偏移的串转成 UTC、把纯日期补成当天午夜。
// ⚠️ 但它只对**字符串**「白送」非法值拒绝（无法解析的串返回 null）。对数字它按儒略日解释：
// 实测 datetime(2500000) -> "2132-08-31 12:00:00"、datetime(5) -> "-4713-11-29 12:00:00"，
// 都是「合法」输出，于是一张垃圾输入建出的邀请码会拿到永不过期的 expires_at（fail-open）；
// 而 true / {n:5} 会让 better-sqlite3 抛 TypeError / RangeError -> 500，本该是 400。
// 所以类型检查必须在进 SQL 之前做，口径与 C4 对 max_uses 的显式拒绝保持一致。
function normalizeExpiresAt(raw) {
  if (raw == null) return { value: null };            // NULL = 长期有效
  if (typeof raw !== "string") return { error: "bad expires_at" };
  const d = db.prepare("SELECT datetime(?) AS d").get(raw).d;
  return d == null ? { error: "bad expires_at" } : { value: d };
}

// C4：只接受 null（不限）或整数 >= 1，其余一律 400。
// brief 原来的 `Number(x) || null` 实测映射是 0 -> null、"abc" -> null，也就是「本意谁都不能用」
// 和「管理员打错字」统统 fail-open 成无限次可用；-5 和 1.7 还会原样落库。方向必须是 fail-closed。
function normalizeMaxUses(raw) {
  if (raw == null) return { value: null };            // NULL = 不限
  const n = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) return { error: "bad max_uses" };
  return { value: n };
}

// C5：防「最后一个 admin 被锁死」。单管理员一次误操作（把自己降成 user、或把自己停用）就能
// 永久失去整个管理面，只能直接改库恢复。任何会让「active admin 数量归零」的改动一律拒绝。
function isLastActiveAdmin(target) {
  if (target.role !== "admin" || target.status !== "active") return false;
  return db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND status='active'").get().c <= 1;
}

router.get("/users", (_req, res) => {
  res.json({ data: db.prepare("SELECT * FROM users ORDER BY created_at DESC").all().map(adminUser) });
});

router.patch("/users/:id", (req, res) => {
  const target = db.prepare("SELECT * FROM users WHERE id=?").get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: "not found" });
  const b = req.body || {};
  const role = b.role;            // 'admin' | 'user'
  const status = b.status;        // 'active' | 'disabled'（禁用 = 只挡登录，数据全保留）
  if (role != null && !["admin", "user"].includes(role)) return res.status(400).json({ error: "bad role" });
  if (status != null && !["active", "disabled"].includes(status)) return res.status(400).json({ error: "bad status" });

  // 所有校验都在任何写入之前完成：被拒的请求不许留下半截改动
  const nextRole = role != null ? role : target.role;
  const nextStatus = status != null ? status : target.status;
  const losesAdmin = !(nextRole === "admin" && nextStatus === "active");
  if (losesAdmin && isLastActiveAdmin(target)) {
    return res.status(409).json({ error: "cannot demote or disable the last active admin" });
  }

  // role + status + 踢下线三件事要么全成、要么全不成
  db.transaction(() => {
    if (role != null) db.prepare("UPDATE users SET role=? WHERE id=?").run(role, target.id);
    if (status != null) {
      db.prepare("UPDATE users SET status=? WHERE id=?").run(status, target.id);
      // C9：停用即硬登出。删的是 sessions（登录凭据），不是业务/配置数据，计划已授权。
      if (status === "disabled") db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
    }
  })();

  res.json({ data: adminUser(db.prepare("SELECT * FROM users WHERE id=?").get(target.id)) });
});

router.get("/invite-codes", (_req, res) => {
  res.json({ data: db.prepare("SELECT * FROM invite_codes ORDER BY created_at DESC").all() });
});

router.post("/invite-codes", (req, res) => {
  const b = req.body || {};
  const code = String(b.code || "").trim().toUpperCase() || ("INV" + crypto.randomBytes(3).toString("hex").toUpperCase());
  if (db.prepare("SELECT 1 FROM invite_codes WHERE code=?").get(code)) return res.status(400).json({ error: "code exists" });

  const mu = normalizeMaxUses(b.max_uses);
  if (mu.error) return res.status(400).json({ error: mu.error });
  const ex = normalizeExpiresAt(b.expires_at);
  if (ex.error) return res.status(400).json({ error: ex.error });

  // 所有校验都在任何写入之前完成，口径与 PATCH /users/:id 一致：
  // null / 省略 = 用默认值，非法值 = 400，绝不静默改写管理员的输入。
  // brief 原来是 `["admin","user"].includes(b.role) ? b.role : "user"`，于是 role:"Admin"
  // （大小写打错）会静默发出一张**普通用户**邀请码，管理员只能从响应体里发现。
  // 方向仍是 fail-closed（最小权限），所以这不是安全洞，是一致性 + 可发现性问题。
  if (b.role != null && !["admin", "user"].includes(b.role)) {
    return res.status(400).json({ error: "bad role" });
  }
  // default_view 必须是对象。数组也是 typeof "object"，而 applyInviteDefaults 对数组走的是
  // **静默 return**：实测 default_view="[]" 会建出 0 个 user_views、不抛异常、连一行
  // console.error 都没有——管理员以为这张码带着默认视角，用它注册的每个用户都拿不到，
  // 事后也无从追查。在这里拒绝而不是去 viewService.js 兜底：此刻管理员还在场，能立刻看到 400。
  if (b.default_view != null && (typeof b.default_view !== "object" || Array.isArray(b.default_view))) {
    return res.status(400).json({ error: "bad default_view" });
  }

  const dv = b.default_view ? JSON.stringify(b.default_view) : null;
  const info = db.prepare(
    `INSERT INTO invite_codes (code, label, role, default_view, max_uses, expires_at, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(code, String(b.label || ""), b.role ?? "user", dv,
        mu.value, ex.value, String(b.note || ""), req.user.id);
  res.json({ data: db.prepare("SELECT * FROM invite_codes WHERE id=?").get(info.lastInsertRowid) });
});

// 停用 = active 置 0，不物理删除（Global Constraint）；因此本文件**没有** DELETE 路由（C7）
router.patch("/invite-codes/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM invite_codes WHERE id=?").get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "not found" });
  const b = req.body || {};
  if (b.active != null) db.prepare("UPDATE invite_codes SET active=? WHERE id=?").run(b.active ? 1 : 0, row.id);
  if (b.note != null) db.prepare("UPDATE invite_codes SET note=? WHERE id=?").run(String(b.note), row.id);
  res.json({ data: db.prepare("SELECT * FROM invite_codes WHERE id=?").get(row.id) });
});

router.get("/invite-codes/:id/usages", (req, res) => {
  res.json({
    data: db.prepare("SELECT id, unionid, nickname, created_at FROM users WHERE invited_by_code_id=?")
      .all(Number(req.params.id))
  });
});

export default router;
