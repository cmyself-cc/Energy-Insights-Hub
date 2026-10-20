import crypto from "node:crypto";

const WX = {
  TOKEN_URL: "https://api.weixin.qq.com/sns/oauth2/access_token",
  USERINFO_URL: "https://api.weixin.qq.com/sns/userinfo"
};

// 上游超时可由 env 调，默认 10s。做成可配置不是给测试开后门：本模块的微信参数
// （APP_ID / APP_SECRET / REDIRECT_URI）本来就全部来自 env，超时属于同一类运维可调项；
// 顺带让「挂死必须被打断」这类断言能在 50ms 内跑完，而不是每次真等 10 秒。
//
// 回落口径（以 Number() 的实际语义为准，不是「看起来像数字就收」）：
//   回落默认值的：undefined（未设置）/ ""（Number("") === 0，被 n > 0 挡掉）/ "0" / "-5" /
//                "abc"（NaN）/ "Infinity"（Number.isFinite 为假）。
//   **会**被接受的：   "1e3" → 1000、"  50  " → 50。Number() 会 trim 首尾空白并接受指数记法，
//                这两种写法都是合法数值字面量，不是 bug，别「顺手收紧」。
// ⚠️ 本函数无直接测试覆盖：upstreamTimeout 未导出，返回值也无法从 AbortSignal 上读回来，
// 间接断言只能靠真的等满 10s。Task 6 的 M11 已就同一权衡裁定过——保持现状，不在此处补测试。
const DEFAULT_TIMEOUT_MS = 10_000;

function upstreamTimeout() {
  const n = Number(process.env.WECHAT_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

export function isMockMode() {
  return process.env.AUTH_DEV_MODE === "wechat-mock" && process.env.NODE_ENV !== "production";
}

export function getAuthorizeUrl(state) {
  if (isMockMode()) return null;
  const { WECHAT_APP_ID: appid, WECHAT_REDIRECT_URI: redirect } = process.env;
  if (!appid || !redirect) return null;
  return "https://open.weixin.qq.com/connect/qrconnect?appid=" + encodeURIComponent(appid)
    + "&redirect_uri=" + encodeURIComponent(redirect)
    + "&response_type=code&scope=snsapi_login&state=" + encodeURIComponent(state) + "#wechat_redirect";
}

// 真实微信：code -> access_token -> userinfo(unionid)。同步路由用 async handler。
// 契约是 total 的：任何失败都返回 { error }，绝不抛出。
//
// ⚠️ 这条契约的**理由**在 Task 6 之后变了，别照抄旧说法：server/apiRoutes.js 如今**已经**装了
// 4 参中央 JSON 错误中间件（jsonErrorHandler），同步抛出会被它接住变成 JSON 500，不再泄漏堆栈。
// 但那个中间件对本函数依然无效——这里是 async，三个调用方（auth.js 的 GET/POST 回跳与
// dev-login）也都是 async handler，而 express 4.x 不把逃逸的 rejected promise 转给 next(err)，
// 中间件根本看不见它。逃逸的后果不是「难看的 500」，而是**进程级 unhandled rejection**：
// 客户端连一个响应都收不到。所以 total 契约仍然必须守，只是守的是另一条理由。
//
// 错误信息只取 err.message，不能带请求 URL（其 query 里含 secret=）。
export async function exchangeIdentityWechat(code) {
  const { WECHAT_APP_ID: appid, WECHAT_APP_SECRET: secret } = process.env;
  if (!appid || !secret) return { error: "wechat_not_configured" };

  const timeout = upstreamTimeout();
  let token;
  try {
    // AbortSignal：微信 API 挂死时，没有超时的 fetch 会让整个登录请求无限期挂着——既占着连接，
    // 也让扫码的用户永远停在等待态。abort 让 fetch reject，落到下面既有的 catch 走
    // wechat_exchange_failed 通道；AbortSignal.timeout 的 reason 是 TimeoutError DOMException，
    // 其 message 不含 URL，所以不会把 query 里的 secret 带进错误串。
    const tokenRes = await fetch(
      `${WX.TOKEN_URL}?appid=${appid}&secret=${secret}&code=${encodeURIComponent(code)}&grant_type=authorization_code`,
      { signal: AbortSignal.timeout(timeout) }
    );
    if (!tokenRes.ok) return { error: `wechat_exchange_failed: HTTP ${tokenRes.status}` };
    token = (await tokenRes.json()) || {};
  } catch (err) {
    return { error: `wechat_exchange_failed: ${err?.message || "unknown"}` };
  }
  if (token.errcode) return { error: `wechat_oauth_failed: ${token.errmsg}` };
  if (!token.unionid) return { error: "wechat_unionid_missing: 应用未绑定开放平台账号" };

  // 资料只是装饰、unionid 才是身份锚点：userinfo 失败（拒绝 / 非 2xx / 非 JSON）一律降级，
  // 不能让微信资料接口抖动把用户挡在门外。
  let info = {};
  try {
    const infoRes = await fetch(
      `${WX.USERINFO_URL}?access_token=${token.access_token}&openid=${token.openid}&lang=zh_CN`,
      { signal: AbortSignal.timeout(timeout) }
    );
    if (infoRes.ok) info = (await infoRes.json()) || {};
  } catch (err) {
    // 降级本身是对的（资料接口抖动不该挡人登录），静默不对：线上出现「一批用户昵称都变成
    // wx-xxxxxx」时，没有这行日志就无法区分是资料接口挂了还是 unionid 真的取不到资料。
    // 只记 message，不记 err 本身——err 的 cause/stack 可能带上 URL，而 URL 里含 access_token。
    console.warn("[identityProvider] wechat profile endpoint down, falling back to default nickname:", err?.message || err);
  }

  return {
    unionid: token.unionid,
    openid: token.openid,
    nickname: info.nickname || `wx-${String(token.unionid).slice(-6)}`,
    avatar_url: info.headimgurl || ""
  };
}

// 两个分支一律返回 Promise，调用方必须 await。若 mock 分支同步返回对象、真实微信返回
// Promise，漏掉的 await 只会在生产（真实微信）暴露：mock 下测试全绿，线上 identity.unionid
// 读到 undefined，登录静默失败。
export async function exchangeIdentity({ code, devUnionid } = {}) {
  if (isMockMode()) {
    const unionid = String(devUnionid || "").trim();
    if (!unionid) return { error: "dev_unionid_required" };
    return {
      unionid,
      openid: "mock-" + crypto.createHash("sha256").update(unionid).digest("hex").slice(0, 16),
      nickname: `dev-${unionid}`,
      avatar_url: ""
    };
  }
  return exchangeIdentityWechat(code);
}
