import crypto from "node:crypto";

const WX = {
  TOKEN_URL: "https://api.weixin.qq.com/sns/oauth2/access_token",
  USERINFO_URL: "https://api.weixin.qq.com/sns/userinfo"
};

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
// 契约是 total 的：任何失败都返回 { error }，绝不抛出——server/index.js 未装 4 参错误
// 中间件，抛出会变成 500 text/html 并在非 production 泄漏堆栈。
// 错误信息只取 err.message，不能带请求 URL（其 query 里含 secret=）。
export async function exchangeIdentityWechat(code) {
  const { WECHAT_APP_ID: appid, WECHAT_APP_SECRET: secret } = process.env;
  if (!appid || !secret) return { error: "wechat_not_configured" };

  let token;
  try {
    const tokenRes = await fetch(`${WX.TOKEN_URL}?appid=${appid}&secret=${secret}&code=${encodeURIComponent(code)}&grant_type=authorization_code`);
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
    const infoRes = await fetch(`${WX.USERINFO_URL}?access_token=${token.access_token}&openid=${token.openid}&lang=zh_CN`);
    if (infoRes.ok) info = (await infoRes.json()) || {};
  } catch { /* 降级为兜底昵称 */ }

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
