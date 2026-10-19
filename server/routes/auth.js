import crypto from "node:crypto";
import { Router } from "express";
import db from "../db.js";
import { createSession, destroySession } from "../lib/sessions.js";
import { requireAuth, parseCookieValue, SESSION_COOKIE, setSessionCookie, clearSessionCookie } from "../lib/authMiddleware.js";
import { exchangeIdentity, getAuthorizeUrl, isMockMode } from "../services/identityProvider.js";
import { applyInviteDefaults } from "../services/viewService.js";

const router = Router();
const PROD = process.env.NODE_ENV === "production";
const sha256 = (t) => crypto.createHash("sha256").update(t).digest("hex");

// —— 邀请码校验限速：5/min/IP（内存桶即可，重启清零可接受）——
const buckets = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const b = buckets.get(ip) || { count: 0, ts: now };
  if (now - b.ts > 60_000) { b.count = 0; b.ts = now; }
  b.count += 1;
  buckets.set(ip, b);
  if (buckets.size > 10_000) buckets.clear();
  return b.count > 5;
}

// 限速键的取值集中在这里，将来改口径只需动这一个函数。
// 现状：生产部署在反向代理（Caddy）之后，而 server/index.js 未设 `trust proxy`，
// 所以 req.ip 拿到的是代理地址而非真实客户端 IP，限速实际退化为「全局 5 次/分钟」。
// 这个方向是偏严不偏松（fail-safe），修正需要结合线上部署确认代理跳数，属 Task 6 范围。
// 不要在这里自行读 X-Forwarded-For：未设 trust proxy 时该头可被客户端任意伪造，比现状更糟。
function clientKey(req) {
  return req.ip;
}

// 仅供测试使用：限速桶是模块级状态，用例之间必须能清零，否则会互相污染出假 429。
export function __resetInviteLimiter() {
  buckets.clear();
}

function findUserByUnionid(unionid) {
  return db.prepare("SELECT * FROM users WHERE unionid = ?").get(unionid);
}

// expires_at 的写入与比较一律走 SQL 侧 datetime()：created_at 用 CURRENT_TIMESTAMP
// 落成 'YYYY-MM-DD HH:MM:SS'，而 JS 的 ISO 串带 T/Z，SQLite 按 TEXT 比较时
// ' '(0x20) < 'T'(0x54) 会让跨日比较静默出错（参见 server/services/tracker.js）。
function issuePending(identity) {
  const ticket = crypto.randomBytes(32).toString("hex");
  db.prepare(
    `INSERT INTO pending_identities (token_hash, unionid, openid, nickname, avatar_url, expires_at)
     VALUES (?, ?, ?, ?, ?, datetime('now','+10 minutes'))`
  ).run(sha256(ticket), identity.unionid, identity.openid || null, identity.nickname, identity.avatar_url);
  return ticket;
}

function loginExisting(res, user) {
  const token = createSession(user.id, "web");
  setSessionCookie(res, token, PROD);
  db.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);
  return publicUser(user);
}

function publicUser(u) {
  return { id: u.id, unionid: u.unionid, nickname: u.nickname, avatar_url: u.avatar_url, role: u.role, status: u.status };
}

// 统一处理身份 -> 登录/待开通/禁用。identity 必须是已 await 的解析结果（不是 Promise），
// 本函数保持同步。exchangeIdentity 的契约是 total 的：失败走 identity.error 分支。
function handleIdentity(req, res, identity, { json }) {
  if (identity.error) return res.status(400).json({ error: identity.error });
  let user = findUserByUnionid(identity.unionid);
  if (!user && identity.unionid === process.env.ADMIN_UNIONID) {
    // AUTH-6：seed admin 免邀请码
    db.prepare(`INSERT INTO users (unionid, openid_web, nickname, avatar_url, role) VALUES (?, ?, ?, ?, 'admin')`)
      .run(identity.unionid, identity.openid || null, identity.nickname, identity.avatar_url);
    user = findUserByUnionid(identity.unionid);
  }
  if (user) {
    if (user.status !== "active") {
      return json ? res.json({ data: { status: "disabled" } })
                  : res.redirect(302, "/login#disabled");
    }
    const pu = loginExisting(res, user);
    return json ? res.json({ data: { status: "active", user: pu } })
                : res.redirect(302, "/");
  }
  const ticket = issuePending(identity);
  return json ? res.json({ data: { status: "need_invite", ticket } })
              : res.redirect(302, `/login#invite=${ticket}`);
}

router.get("/config", (_req, res) => {
  res.json({ data: { mockMode: isMockMode(), authorizeUrl: getAuthorizeUrl(crypto.randomBytes(8).toString("hex")) } });
});

// 微信回跳（GET，浏览器带 ?code=&state=）
router.get("/wechat/callback", async (req, res) => {
  const identity = await exchangeIdentity({ code: req.query.code });
  handleIdentity(req, res, identity, { json: false });
});
router.post("/wechat/callback", async (req, res) => {
  const { code } = req.body || {};
  const identity = await exchangeIdentity({ code });
  handleIdentity(req, res, identity, { json: true });
});

// 仅 mock 模式的本地登录入口（联调/测试；生产自动 404）
// 必须 async + await：exchangeIdentity 两个分支都返回 Promise，漏掉 await 会让
// identity.unionid 读到 undefined，最终在 pending_identities.unionid 上撞 NOT NULL
// 约束抛出 500（server/index.js 未装 4 参错误中间件，还会泄漏堆栈）。
router.post("/dev-login", async (req, res) => {
  if (!isMockMode()) return res.status(404).json({ error: "not found" });
  const { devUnionid } = req.body || {};
  const identity = await exchangeIdentity({ devUnionid });
  handleIdentity(req, res, identity, { json: true });
});

router.post("/register", (req, res) => {
  const { ticket, code } = req.body || {};
  if (rateLimited(clientKey(req))) return res.status(429).json({ error: "too many attempts, slow down" });
  const pending = db.prepare(
    `SELECT * FROM pending_identities WHERE token_hash = ? AND datetime('now') < expires_at`
  ).get(sha256(String(ticket || "")));
  if (!pending) return res.status(400).json({ error: "invalid or expired ticket" });
  const invite = db.prepare("SELECT * FROM invite_codes WHERE code = ? AND active = 1").get(String(code || "").trim());
  const reason =
    !invite ? "invalid invite code"
    : invite.expires_at && db.prepare("SELECT datetime('now') < ? AS ok").get(invite.expires_at).ok !== 1 ? "invite code expired"
    : invite.max_uses != null && invite.used_count >= invite.max_uses ? "invite code exhausted"
    : null;
  if (reason) return res.status(400).json({ error: reason });

  const register = db.transaction(() => {
    // 并发首登同 UnionID 防重复
    const dup = findUserByUnionid(pending.unionid);
    if (dup) return dup;
    db.prepare("UPDATE invite_codes SET used_count = used_count + 1 WHERE id = ?").run(invite.id);
    db.prepare(
      `INSERT INTO users (unionid, openid_web, nickname, avatar_url, role, invited_by_code_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(pending.unionid, pending.openid, pending.nickname, pending.avatar_url, invite.role, invite.id);
    db.prepare("DELETE FROM pending_identities WHERE id = ?").run(pending.id);
    return findUserByUnionid(pending.unionid);
  });
  let user;
  try { user = register(); } catch (e) { return res.status(400).json({ error: "register failed: " + e.message }); }
  applyInviteDefaults(user.id, invite);   // 邀请码默认视角落为首个 user_view（Task 5 提供实现）
  const pu = loginExisting(res, user);
  res.json({ data: { user: pu } });
});

router.get("/me", requireAuth, (req, res) => res.json({ data: { user: req.user } }));

router.post("/logout", requireAuth, (req, res) => {
  destroySession(parseCookieValue(req, SESSION_COOKIE));
  clearSessionCookie(res, PROD);
  res.json({ success: true });
});

export default router;
