import crypto from "node:crypto";
import { Router } from "express";
import db from "../db.js";
import { createSession, destroySession } from "../lib/sessions.js";
import { requireAuth, parseCookieValue, SESSION_COOKIE, setSessionCookie, clearSessionCookie } from "../lib/authMiddleware.js";
import { exchangeIdentity, getAuthorizeUrl, isMockMode } from "../services/identityProvider.js";
import { applyInviteDefaults } from "../services/viewService.js";

const router = Router();
// ⚠️ PROD 在**模块加载时**就固化了，之后改 process.env.NODE_ENV 不会重新求值。
// 测试正是在 beforeEach 里才设 NODE_ENV（晚于 import），所以测试里 PROD 恒为 false，
// session cookie 的 Secure 位也恒为 false。这目前无害（测试跑在 http://127.0.0.1 上，
// 加了 Secure 反而浏览器不发），但将来谁把 NODE_ENV 的设置挪到 import 之后，
// cookie 行为就会静默与生产分叉，而没有任何测试会红。改这里之前先读一遍这条。
const PROD = process.env.NODE_ENV === "production";
const sha256 = (t) => crypto.createHash("sha256").update(t).digest("hex");

// —— 邀请码校验限速：5/min/IP（内存桶即可，重启清零可接受）——
const LIMIT_WINDOW_MS = 60_000;
const LIMIT_MAX = 5;
const MAX_BUCKETS = 10_000;
const buckets = new Map();

// 逐桶按 ts 过期，取代原来的「size > 10_000 就 buckets.clear()」。
// 全清是一个外部可触发的复位开关：apiRoutes.js 设了 trust proxy 之后 req.ip 是真实客户端 IP，
// 轮换来源 IP 就能把 map 撑过上限，把**所有人**的限速一起清零——原本用来防内存无界的兜底，
// 反倒成了绕过限速的手段。现在上界不变，但淘汰的是已经出窗口、本来就不该再计数的桶。
function evictExpired(now) {
  for (const [ip, b] of buckets) {
    if (now - b.ts > LIMIT_WINDOW_MS) buckets.delete(ip);
  }
}

function rateLimited(ip) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now - b.ts > LIMIT_WINDOW_MS) {
    if (buckets.size >= MAX_BUCKETS) {
      evictExpired(now);
      // 扫完还满，说明窗口内真有上万个不同 IP 在打注册：按**插入顺序**淘汰最老的（Map 保序，
      // 而命中已有桶时下面只改 b.count、并不 re-set，所以位置就是该 IP 首次出现的位置）。
      // ⚠️ 这不等于淘汰「最久没活动」的那个：被淘汰的桶可能仍在窗口内，于是那个客户端的
      // 计数被清零、拿到一份全新配额（对**单个**客户端 fail-open）。做成真 LRU 要在每个
      // 请求上 delete + set，churn 与收益不匹配，所以这里只保证「不波及其他人」——
      // 而这已经严格优于原来的 clear()：那会把**所有人**的配额一起清零，
      // 等于给外部一个可触发的限速复位开关。
      while (buckets.size >= MAX_BUCKETS) {
        const oldest = buckets.keys().next();
        if (oldest.done) break;
        buckets.delete(oldest.value);
      }
    }
    b = { count: 0, ts: now };
    buckets.set(ip, b);
  }
  b.count += 1;
  return b.count > LIMIT_MAX;
}

// 限速键的取值集中在这里，将来改口径只需动这一个函数。
// server/apiRoutes.js 已设 app.set("trust proxy", 1)（生产是单跳 Caddy），
// 所以 req.ip 拿到的是真实客户端 IP，限速是真正的 per-IP。
// 不要在这里自行读 X-Forwarded-For：express 已经按跳数处理过了，
// 手读等于把最左边那个客户端可任意伪造的值当成真相。
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
//
// oneTimeState：回跳路径传 true，state cookie 必须被消费掉（一次性，不给重放窗口）。
// 清理写在这里而不是调用方，因为这里是唯一同时满足两个约束的位置——
//   · 必须在 setSessionCookie **之后**：它用 setHeader("Set-Cookie", …) 会整条覆盖，
//     先 append 的清除指令会被抹掉；
//   · 必须在 res.json/res.redirect **之前**：响应一发出就不能再动头（ERR_HTTP_HEADERS_SENT）。
//     ⚠️ 别「顺手简化」成 try/finally。评审把两种形状分开实测过：
//       - 没有 clearOauthStateCookie 里那道 `if (!res.headersSent)` 守卫（:177）时，裸
//         res.append 确实抛 ERR_HTTP_HEADERS_SENT —— 上面那句话在那个形状下成立；
//       - **带着**已发布的守卫时，append 一次都不会被调用：清除指令被静默丢弃，且不抛异常。
//     所以在当前形状下挪到 finally 不会让测试变红，而是无声地失去一次性——比抛错更危险。
//     结论不变：clear 必须在 settle() 里、响应发出之前。评审的 M-C 变异（把 clear 挪到响应
//     之后）被现有用例 KILLED，说明这个顺序已经被钉住。
// dev-login 传 false：它没有 OAuth 往返，从没铸过 state cookie，不该多发一条无意义的 Set-Cookie。
function handleIdentity(req, res, identity, { json, oneTimeState }) {
  const settle = (payload, location) => {
    if (oneTimeState) clearOauthStateCookie(res);
    return json ? res.json(payload) : res.redirect(302, location);
  };
  if (identity.error) {
    // 交换失败也算消费掉了这次回跳：让用户重新走一遍 /config 拿新 state，
    // 而不是留着一个已经暴露在 URL 里（会进 access log / Referer）的旧值。
    if (oneTimeState) clearOauthStateCookie(res);
    return res.status(400).json({ error: identity.error });
  }
  let user = findUserByUnionid(identity.unionid);
  if (!user && identity.unionid === process.env.ADMIN_UNIONID) {
    // AUTH-6：seed admin 免邀请码
    db.prepare(`INSERT INTO users (unionid, openid_web, nickname, avatar_url, role) VALUES (?, ?, ?, ?, 'admin')`)
      .run(identity.unionid, identity.openid || null, identity.nickname, identity.avatar_url);
    user = findUserByUnionid(identity.unionid);
  }
  if (user) {
    if (user.status !== "active") {
      return settle({ data: { status: "disabled" } }, "/login#disabled");
    }
    const pu = loginExisting(res, user);
    return settle({ data: { status: "active", user: pu } }, "/");
  }
  const ticket = issuePending(identity);
  return settle({ data: { status: "need_invite", ticket } }, `/login#invite=${ticket}`);
}

// —— OAuth state 与浏览器绑定（login CSRF 防护）——
//
// 双提交 cookie：/config 把 state 同时写进 authorizeUrl 和一次性 HttpOnly cookie；回跳时比对
// 「URL 带回来的」与「**这个浏览器自己存的**」。攻击者可以给自己领到完全合法的 state，
// **只要他没法把那个值写进受害者的 cookie jar**，伪造链接就必然比对失败。
//
// ⚠️ 那个前提是有条件的，早先这里写成「没有办法」是不准确的。已知的写 cookie 路径：
//   · 兄弟子域控制权——本 cookie 是 host-only 的（不带 Domain 属性），但任何能控制
//     *.cmyself.cc 兄弟子域的一方都可以自己抛一条 Domain=.cmyself.cc 的同名 cookie 盖过来；
//   · 兄弟源上的 XSS（能把请求打到本站）；
//   · 无 TLS 的 MITM——生产是 Caddy + HTTPS，且 PROD 下这条 cookie 带 Secure，此路已排除。
// 评审实测到的绕过形状：请求的 Cookie 头里放两条同名 eih_oauth_state（攻击者的值在前）+
// query 带攻击者的值 → 302 /，因为 parseCookieValue（server/lib/authMiddleware.js:5-16）
// 顺序扫描并返回**第一个**同名匹配。
// 这是双提交 cookie 模式的固有上限，不是本实现的 bug。要彻底消除得上服务端一次性 state 表
// （需要新迁移，超出本任务范围）——所以这里只订正说法，不改代码。
//
// 为什么不用无状态 HMAC 签名：/config 匿名可达，攻击者随时能领一个签名合法的 state 塞进伪造
// 链接——HMAC 只证明「这个 state 是我们签发的」，而防御需要的是「这个 state 是**这个浏览器**
// 领的」。少一个绑定，签名再强也没用。
//
// 不校验的具体危害（修复前的真实状态）：攻击者用自己的账号取得合法 code，诱使受害者访问
// /api/auth/wechat/callback?code=<攻击者的code> → 受害者浏览器被写下**攻击者账号**的 session
// cookie → 受害者此后保存的视角、反馈全部落进攻击者可读的账号。
const OAUTH_STATE_COOKIE = "eih_oauth_state";
// 10 分钟：够扫码。⚠️ 但这**不等于**服务端意义上的「一次性」——服务端不记消费，那条
// Max-Age=0 的清除指令只是请浏览器删 cookie；无视它的客户端可以拿同一个 state + 同一条 cookie
// 反复通过（评审实测连续 3 次成功，铸出 5 条 session 行），而且每次 GET /config 都把 Max-Age
// 重置回 600，寿命可以无限延长。
// 这没有在 M-3 之外增加攻击面：重放要求同时出示 state S **和**一条含 S 的 cookie——攻击者自己
// 满足这两个条件只能登进他自己的账号；要在受害者浏览器里满足，就得先具备 M-3 列的那些前提。
// 口径订正：它更像「10 分钟内可换多次会话的票」，不是一次性令牌（每次成功重放新铸一条 session 行）。
const OAUTH_STATE_MAX_AGE_S = 600;
const OAUTH_STATE_RE = /^[0-9a-f]{16}$/;    // crypto.randomBytes(8).toString("hex") 的形状

// ⚠️ 必须用 res.append 而不是 res.setHeader：authMiddleware.js 的 setSessionCookie /
// clearSessionCookie 用的是 setHeader("Set-Cookie", …)，那会**整条覆盖**。回跳成功那一发要
// 同时下发 session cookie 与 state 清除指令两条，所以这里 append，且调用时机必须在
// setSessionCookie 之后、响应发出之前（见 handleIdentity 里的 settle）。
// authMiddleware.js 不在本任务允许改动的清单里，顺序只能由本文件保证。
function setOauthStateCookie(res, state, maxAge = OAUTH_STATE_MAX_AGE_S) {
  const attrs = [
    `${OAUTH_STATE_COOKIE}=${maxAge === 0 ? "" : state}`,
    "Path=/api/auth", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`
  ];
  if (PROD) attrs.push("Secure");
  res.append("Set-Cookie", attrs.join("; "));
}

// cookie 是客户端可控输入：形状不对的值既不许被复用/回显进 authorizeUrl，也不许进入下面的
// 定长比较（timingSafeEqual 遇到长度不等会直接抛）。
function validState(v) {
  return typeof v === "string" && OAUTH_STATE_RE.test(v) ? v : undefined;
}

function clearOauthStateCookie(res) {
  if (!res.headersSent) setOauthStateCookie(res, "", 0);
}

// query 优先（微信回跳的形状），body 兜底（程序化 POST 的形状）。
//
// ⚠️ 归属订正：这里早先写着「?state=a&state=b 会被 express 解析成数组，typeof 守卫把它挡在
// 外面」，把功劳记在了本函数头上 —— 记错了。这条链上有**两层** typeof 检查：stateFrom 自己
// 这一层，和 validState 里那一层（`typeof v === "string" && OAUTH_STATE_RE.test(v)`）。
// 数组形状最终是被 **validState** 拒掉的。证据：评审的 G10 变异把本函数的
// `if (typeof q === "string")` 换成 `if (q !== undefined)`（其余控制流完全不变），
// **全量套件 SURVIVED** —— 本函数这层是冗余的纵深防御，不是承重墙。
// （对照：把数组**摊平成首元素**再交给 validState 那种改写是有观察者的，auth.test.js 里
// 那条 array-shaped state 用例会红 —— 区别在于摊平之后 validState 看到的就是合法字符串了。）
// 冗余本身没问题、多一层不多花什么，但注释不该替它冒领功劳：否则日后有人「简化」掉
// validState 那层时，会以为这里还兜着。
function stateFrom(req) {
  const q = req.query?.state;
  if (typeof q === "string") return validState(q);
  const b = req.body?.state;
  return typeof b === "string" ? validState(b) : undefined;
}

// 定长常量时间比较：=== 会比到第一个不同字节就短路，把 state 变成可逐位爆破的 oracle。
function stateMatches(req) {
  const presented = stateFrom(req);
  const owned = validState(parseCookieValue(req, OAUTH_STATE_COOKIE));
  if (!presented || !owned) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(owned);
  if (a.length !== b.length) return false;   // 形状校验已保证等长，这一行是兜底（长度不等时 timingSafeEqual 抛异常）
  return crypto.timingSafeEqual(a, b);
}

// state 校验失败的统一出口。GET 回 302、POST 回 400 JSON，与 handleIdentity 的 json 口径一致：
// GET 是浏览器导航，最常见的**良性**成因是 state cookie 过期（在微信扫码页停留超过 10 分钟）
// 或用户在另一个浏览器里打开了回跳链接，前端 /login#state_expired 会给出「登录超时，请重试」，
// 而不是一屏 JSON。
function rejectState(res, json) {
  clearOauthStateCookie(res);
  return json
    ? res.status(400).json({ error: "invalid state" })
    : res.redirect(302, "/login#state_expired");
}

// D2：StrictMode（src/main.jsx）下 LoginGate 的 effect 跑两次 → 两个并发 /config。若每次都新铸
// state，浏览器留下的是最后到达的 Set-Cookie、React 留下的是最后 resolve 的 promise，两者可能
// 不是同一个 state，于是合法登录被自己拒掉——交互式偶发、极难查。
// 所以：cookie 里已有形状正确的 state 就**复用**它（并刷新 Max-Age），端点因此幂等，竞态消失。
// mock 模式也照铸不误：那时 authorizeUrl 是 null、cookie 用不上，但保持单一代码路径比省一个
// Set-Cookie 重要（回跳为什么不设 mock 豁免，见下面 GET /wechat/callback）。
router.get("/config", (req, res) => {
  const state = validState(parseCookieValue(req, OAUTH_STATE_COOKIE)) || crypto.randomBytes(8).toString("hex");
  setOauthStateCookie(res, state);
  res.json({ data: { mockMode: isMockMode(), authorizeUrl: getAuthorizeUrl(state) } });
});

// 微信回跳（GET，浏览器带 ?code=&state=）。
//
// 🔴 state 校验**不设 mock 豁免**。带 dev-mode 旁路的安全检查，迟早会在生产被旁路掉，而这里的
// 豁免代价是零：测试客户端不是浏览器，HttpOnly 对它无效，它可以直接从 /config 的 Set-Cookie 里
// 读出 state 再回传（server/routes/auth.test.js 的 oauth state binding 那一组就是这么做的）。
// 所以 mock 分支与真实微信分支走的是同一套校验，「mock 下测不到」这个借口不成立。
//
// exchangeIdentity 的契约是 total 的、不会 reject，所以 catch 目前不可达；但本仓 express 是
// 4.x，async handler 里逃逸的 rejected promise 不会被转给 next(err)，会变成进程级
// unhandled rejection。handleIdentity 保持同步，兜底包在它的调用方。
// catch 里仍然记日志：不可达 ≠ 永远不会可达，而这条路径最难查的形态是 loginExisting 已经挂上
// Set-Cookie、随后的 UPDATE 才抛出——客户端收到 500、实际却已登录，没有服务端日志无从定位。
router.get("/wechat/callback", async (req, res) => {
  if (!stateMatches(req)) return rejectState(res, false);
  try {
    const identity = await exchangeIdentity({ code: req.query.code });
    handleIdentity(req, res, identity, { json: false, oneTimeState: true });
  } catch (e) {
    console.error("[auth] login failed:", e?.message || e);
    clearOauthStateCookie(res);
    res.status(500).json({ error: "login failed" });
  }
});
router.post("/wechat/callback", async (req, res) => {
  const { code } = req.body || {};
  if (!stateMatches(req)) return rejectState(res, true);
  try {
    const identity = await exchangeIdentity({ code });
    handleIdentity(req, res, identity, { json: true, oneTimeState: true });
  } catch (e) {
    console.error("[auth] login failed:", e?.message || e);
    clearOauthStateCookie(res);
    res.status(500).json({ error: "login failed" });
  }
});

// 仅 mock 模式的本地登录入口（联调/测试；生产自动 404）
// 必须 async + await：exchangeIdentity 两个分支都返回 Promise，漏掉 await 会让
// identity.unionid 读到 undefined，最终在 pending_identities.unionid 上撞 NOT NULL 约束抛出。
// try/catch 的理由与上面两个回调逐字相同：express 4.x 不把 async 逃逸转给 next(err)，
// 所以 apiRoutes.js 里那个中央 JSON 错误中间件**够不着这里**——逃逸的 rejected promise
// 会变成进程级 unhandled rejection，连一个 500 响应都不会有。
//
// 这条**不做** OAuth state 校验，是有意的、且不是「安全检查可以按模式跳过」的先例：
// login CSRF 的成立条件是「攻击者能驱动受害者的浏览器去打回跳 URL，并带上自己那份 code/state」，
// 而 dev-login 没有浏览器跳转、没有 code、没有 state，攻击者手里没有任何可以塞进受害者请求的东西
// （它是 POST + SameSite=Lax 的会话 cookie 也不参与）。它自身已被 isMockMode() 门禁，生产 404。
// oneTimeState:false —— 从没铸过 state cookie，不必下发一条无意义的清除指令。
router.post("/dev-login", async (req, res) => {
  if (!isMockMode()) return res.status(404).json({ error: "not found" });
  const { devUnionid } = req.body || {};
  try {
    const identity = await exchangeIdentity({ devUnionid });
    handleIdentity(req, res, identity, { json: true, oneTimeState: false });
  } catch (e) {
    console.error("[auth] login failed:", e?.message || e);
    res.status(500).json({ error: "login failed" });
  }
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
  try {
    user = register();
  } catch (e) {
    // 不回显 e.message：/register 匿名可达，better-sqlite3 的原始消息会带出 schema 内部信息
    // （如 "UNIQUE constraint failed: users.unionid"）。详情只落服务端日志。
    // 注意这是刻意的 res.json 而非抛出，Task 6 的全局错误中间件管不到这里。
    console.error("[auth] register failed:", e?.message || e);
    return res.status(400).json({ error: "register failed" });
  }
  applyInviteDefaults(user.id, invite);   // 邀请码默认视角落为首个 user_view（Task 5 提供实现）
  const pu = loginExisting(res, user);
  res.json({ data: { user: pu } });
});

// ── 用户名 + 邀请码登录体系（产品负责人 2026-10-21 定的主登录方式，微信扫码保留备用）──
// 首开：有效邀请码 + 自设用户名 → 建号（码过期/达上限/停用只挡新注册，不挡老用户登录）；
// 之后：同 pair 配对登录。身份 = 合成 unionid（"pair-" + sha256(码:用户名)）——
// 天然把「用户名+邀请码」绑成全局唯一键，跨码重名互不冲突（不同码合成不同 unionid）。
// 密码学上邀请码即凭证：暴力破解靠 5 次/分/IP 限速（复用 register 的同一闸门），
// 配对失败一律统一文案，不泄露「用户名存在但码错」这种对半信息。
const pairUnionid = (code, username) =>
  "pair-" + sha256(`${String(code || "").trim().toUpperCase()}:${String(username || "").trim()}`);

// 邀请码通用校验（与 /register 同一口径；注册类端点用，登录类端点**不**校验码状态——
// 「邀请码过期后不可再添加新用户」，存量用户登录权不受码生命周期影响）
const inviteRejectReason = (invite) =>
  !invite ? "invalid invite code"
  : invite.expires_at && db.prepare("SELECT datetime('now') < ? AS ok").get(invite.expires_at).ok !== 1 ? "invite code expired"
  : invite.max_uses != null && invite.used_count >= invite.max_uses ? "invite code exhausted"
  : null;

router.post("/register-pair", (req, res) => {
  const { code, username } = req.body || {};
  if (rateLimited(clientKey(req))) return res.status(429).json({ error: "too many attempts, slow down" });
  const name = String(username || "").trim();
  if (!name || name.length > 30) return res.status(400).json({ error: "username must be 1-30 characters" });
  const invite = db.prepare("SELECT * FROM invite_codes WHERE code = ? AND active = 1").get(String(code || "").trim().toUpperCase());
  const reason = inviteRejectReason(invite);
  if (reason) return res.status(400).json({ error: reason });
  const unionid = pairUnionid(code, name);
  if (findUserByUnionid(unionid)) {
    return res.status(409).json({ error: "this username is already registered with that invite code" });
  }
  const register = db.transaction(() => {
    db.prepare("UPDATE invite_codes SET used_count = used_count + 1 WHERE id = ?").run(invite.id);
    db.prepare(
      `INSERT INTO users (unionid, nickname, role, invited_by_code_id) VALUES (?, ?, ?, ?)`
    ).run(unionid, name, invite.role, invite.id);
    return findUserByUnionid(unionid);
  });
  let user;
  try {
    user = register();
  } catch (e) {
    // 不回显 e.message（匿名可达端点，better-sqlite3 原始消息会带 schema 内部信息），与 /register 同口径
    console.error("[auth] register-pair failed:", e?.message || e);
    return res.status(400).json({ error: "register failed" });
  }
  applyInviteDefaults(user.id, invite);
  const pu = loginExisting(res, user);
  res.status(201).json({ data: { user: pu } });
});

router.post("/login-pair", (req, res) => {
  const { code, username } = req.body || {};
  if (rateLimited(clientKey(req))) return res.status(429).json({ error: "too many attempts, slow down" });
  const name = String(username || "").trim();
  if (!name || !String(code || "").trim()) {
    return res.status(400).json({ error: "username and invite code are required" });
  }
  const user = findUserByUnionid(pairUnionid(code, name));
  if (!user) return res.status(401).json({ error: "invalid username or invite code" });
  if (user.status !== "active") return res.status(403).json({ error: "account disabled" });
  const pu = loginExisting(res, user);
  res.json({ data: { user: pu } });
});

router.get("/me", requireAuth, (req, res) => res.json({ data: { user: req.user } }));

router.post("/logout", requireAuth, (req, res) => {
  destroySession(parseCookieValue(req, SESSION_COOKIE));
  clearSessionCookie(res, PROD);
  res.json({ data: { success: true } });
});

export default router;
