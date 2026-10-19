import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isMockMode, exchangeIdentity, exchangeIdentityWechat, getAuthorizeUrl } from "./identityProvider.js";

const ENV_KEYS = ["AUTH_DEV_MODE", "NODE_ENV", "WECHAT_APP_ID", "WECHAT_APP_SECRET", "WECHAT_REDIRECT_URI"];
let envSnapshot = [];

function snapshotEnv() {
  envSnapshot = ENV_KEYS.map((k) => [k, process.env[k]]);
}

// 无条件恢复：任何一处断言失败都不能把 env 泄漏给同文件的后续用例
function restoreEnv() {
  for (const [k, v] of envSnapshot) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

describe("identityProvider mock mode", () => {
  beforeEach(() => {
    snapshotEnv();
    process.env.AUTH_DEV_MODE = "wechat-mock";
    process.env.NODE_ENV = "test";
  });
  afterEach(() => {
    restoreEnv();
    vi.unstubAllGlobals();
  });

  it("mock mode active only outside production", () => {
    expect(isMockMode()).toBe(true);
    process.env.NODE_ENV = "production";
    expect(isMockMode()).toBe(false);
    process.env.NODE_ENV = "test";
  });

  it("mock exchangeIdentity returns deterministic identity", () => {
    const id = exchangeIdentity({ devUnionid: "dev-u1" });
    expect(id.unionid).toBe("dev-u1");
    expect(id.nickname).toMatch(/^dev-/);
  });

  it("mock exchangeIdentity rejects empty unionid", () => {
    expect(exchangeIdentity({ devUnionid: "" }).error).toBeTruthy();
  });

  it("getAuthorizeUrl returns null in mock mode", () => {
    expect(getAuthorizeUrl("s1")).toBeNull();
  });
});

describe("identityProvider wechat path", () => {
  const APPID = "wx_appid_test";
  const SECRET = "super_secret_do_not_leak";
  const TOKEN_BODY = { access_token: "at_1", openid: "op_1", unionid: "unionid_ABC123" };
  const isTokenCall = (url) => String(url).includes("/sns/oauth2/access_token");

  beforeEach(() => {
    snapshotEnv();
    // 必须非 mock：否则 exchangeIdentity({code}) 会短路进 mock 分支，测到错的代码
    delete process.env.AUTH_DEV_MODE;
    process.env.NODE_ENV = "test";
    process.env.WECHAT_APP_ID = APPID;
    process.env.WECHAT_APP_SECRET = SECRET;
    process.env.WECHAT_REDIRECT_URI = "https://eih.cmyself.cc/api/auth/wechat/callback";
  });
  afterEach(() => {
    restoreEnv();
    vi.unstubAllGlobals();
  });

  it("dispatches to the wechat branch and maps a full profile", async () => {
    expect(isMockMode()).toBe(false);
    const fetchMock = vi.fn(async (url) =>
      isTokenCall(url)
        ? jsonResponse(TOKEN_BODY)
        : jsonResponse({ nickname: "张三", headimgurl: "https://wx.example/a.png" })
    );
    vi.stubGlobal("fetch", fetchMock);

    const id = await exchangeIdentity({ code: "c1" });
    expect(id).toEqual({
      unionid: "unionid_ABC123",
      openid: "op_1",
      nickname: "张三",
      avatar_url: "https://wx.example/a.png"
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("grant_type=authorization_code");
  });

  it("network failure returns {error} instead of throwing, without leaking the secret", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));

    const out = await exchangeIdentity({ code: "c1" });
    expect(out.error).toMatch(/^wechat_exchange_failed: /);
    expect(out.error).toContain("network down");
    expect(out.error).not.toContain(SECRET);
    expect(out.error).not.toContain(APPID);
    expect(out.error).not.toContain("api.weixin.qq.com");
    expect(out.unionid).toBeUndefined();
  });

  it("token step non-2xx is fatal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, { ok: false, status: 502 })));

    const out = await exchangeIdentity({ code: "c1" });
    expect(out.error).toMatch(/^wechat_exchange_failed: /);
    expect(out.error).not.toContain(SECRET);
  });

  it("token errcode surfaces wechat_oauth_failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ errcode: 40029, errmsg: "invalid code" })));

    const out = await exchangeIdentity({ code: "bad_code" });
    expect(out.error).toContain("wechat_oauth_failed");
    expect(out.error).toContain("invalid code");
  });

  it("token without unionid surfaces wechat_unionid_missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ access_token: "at_1", openid: "op_1" })));

    const out = await exchangeIdentity({ code: "c1" });
    expect(out.error).toContain("wechat_unionid_missing");
  });

  it("userinfo is best-effort: any failure still yields an identity with the wx- fallback", async () => {
    const failing = {
      rejects: () => Promise.reject(new Error("profile endpoint down")),
      "non-2xx": async () => jsonResponse({}, { ok: false, status: 500 }),
      "non-JSON body": async () => ({
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError("Unexpected token '<'"); }
      })
    };
    for (const [label, impl] of Object.entries(failing)) {
      vi.stubGlobal("fetch", vi.fn(async (url) => (isTokenCall(url) ? jsonResponse(TOKEN_BODY) : impl())));

      const id = await exchangeIdentityWechat("c1");
      expect(id.error, label).toBeUndefined();
      expect(id.unionid, label).toBe("unionid_ABC123");
      expect(id.openid, label).toBe("op_1");
      expect(id.nickname, label).toBe("wx-ABC123");
      expect(id.avatar_url, label).toBe("");
    }
  });

  it("getAuthorizeUrl builds the qrconnect URL with encoded params", () => {
    expect(getAuthorizeUrl("st/ate=1")).toBe(
      "https://open.weixin.qq.com/connect/qrconnect?appid=wx_appid_test"
      + "&redirect_uri=https%3A%2F%2Feih.cmyself.cc%2Fapi%2Fauth%2Fwechat%2Fcallback"
      + "&response_type=code&scope=snsapi_login&state=st%2Fate%3D1#wechat_redirect"
    );
    delete process.env.WECHAT_REDIRECT_URI;
    expect(getAuthorizeUrl("s1")).toBeNull();
  });
});
