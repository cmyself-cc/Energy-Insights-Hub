import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isMockMode, exchangeIdentity, exchangeIdentityWechat, getAuthorizeUrl } from "./identityProvider.js";
// 刻意**不** import ../testUtils.js。本文件一行 DB 都不写（只桩打向微信上游的 outbound
// fetch），被测模块的唯一 import 是 node:crypto，清理钩子在这里收益为零、耦合为实。
//
// ⚠️ 措辞订正：这里早先写的是「clearAuthTables() → initDb() 会遍历 migrations 跑整套迁移」，
// **机制说错了**（结论不变）。initDb() 对已记录在 _migrations 里的迁移是
// `if (isApplied.get(file)) continue;`（server/db.js:42）直接跳过的 —— 在一个健康的测试库上，
// 它的全部代价就是一次 readdirSync 加 N 条 SELECT。真正的耦合是下面两条：
//   (a) 那个 DB 文件必须能打开；
//   (b) 任何**未记录 / 新加的 / 写坏了的**迁移都会被尝试执行 —— 于是一个与 identityProvider
//       毫不相干的迁移问题，会把这个纯逻辑单测文件搞红，而且失败信息指向错误的地方。
// 规则是「凡是写 auth 表的测试文件才必须 afterAll(clearAuthTables)」，本文件不属于那一类。

// WECHAT_TIMEOUT_MS 也在列：它决定上游 fetch 的 AbortSignal 何时触发，泄漏出去会让
// 「挂死必须被超时打断」那两条用例的耗时随上一个用例的设置漂移。
const ENV_KEYS = ["AUTH_DEV_MODE", "NODE_ENV", "WECHAT_APP_ID", "WECHAT_APP_SECRET", "WECHAT_REDIRECT_URI", "WECHAT_TIMEOUT_MS"];
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

  it("mock mode active only outside production", async () => {
    expect(isMockMode()).toBe(true);
    process.env.NODE_ENV = "production";
    expect(isMockMode()).toBe(false);
    // 端到端钉死生产门禁：production 下即便带着 AUTH_DEV_MODE=wechat-mock 和 devUnionid，
    // 也绝不能铸出身份——否则 devUnionid=ADMIN_UNIONID 就能直接换到 admin 会话。
    // 只断言「没有身份被铸出」（.error 为真），不钉具体文案，避免与未配置分支的措辞耦合。
    const out = await exchangeIdentity({ devUnionid: "attacker" });
    expect(out.unionid).toBeUndefined();
    expect(out.error).toBeTruthy();
    process.env.NODE_ENV = "test";
  });

  it("mock exchangeIdentity returns deterministic identity", async () => {
    const pending = exchangeIdentity({ devUnionid: "dev-u1" });
    expect(pending).toBeInstanceOf(Promise);   // mock 分支也必须是 Promise，await 才是统一强制的
    const id = await pending;
    expect(id.unionid).toBe("dev-u1");
    expect(id.nickname).toMatch(/^dev-/);
  });

  it("mock exchangeIdentity rejects empty unionid", async () => {
    expect((await exchangeIdentity({ devUnionid: "" })).error).toBeTruthy();
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
  // userinfo 失败会 console.warn（见下面那条断言它的用例）。整个 describe 里统一消音，
  // 否则「userinfo is best-effort」的 4 个变体会往全量输出里加 4 个新的 stderr 块。
  let warnSpy;

  beforeEach(() => {
    snapshotEnv();
    // 必须非 mock：否则 exchangeIdentity({code}) 会短路进 mock 分支，测到错的代码
    delete process.env.AUTH_DEV_MODE;
    process.env.NODE_ENV = "test";
    process.env.WECHAT_APP_ID = APPID;
    process.env.WECHAT_APP_SECRET = SECRET;
    process.env.WECHAT_REDIRECT_URI = "https://eih.cmyself.cc/api/auth/wechat/callback";
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    restoreEnv();
    vi.unstubAllGlobals();
    warnSpy.mockRestore();
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

  it("null token body returns {error} instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(null)));

    const out = await exchangeIdentity({ code: "c1" });
    expect(out.error).toMatch(/^wechat_exchange_failed: |^wechat_unionid_missing/);
  });

  it("userinfo is best-effort: any failure still yields an identity with the wx- fallback", async () => {
    const failing = {
      rejects: () => Promise.reject(new Error("profile endpoint down")),
      // 故意带内容的 500：若 infoRes.ok 守卫被删，这个 nickname/avatar 就会泄漏进返回值
      "non-2xx": async () => jsonResponse(
        { nickname: "SHOULD_NOT_BE_USED", headimgurl: "https://bad.example" },
        { ok: false, status: 500 }
      ),
      "non-JSON body": async () => ({
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError("Unexpected token '<'"); }
      }),
      "null body": async () => jsonResponse(null)
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

  it("missing credentials return wechat_not_configured without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const creds = { WECHAT_APP_ID: APPID, WECHAT_APP_SECRET: SECRET };
    for (const key of Object.keys(creds)) {
      // 每轮先回到已知良态再抽掉一个键：这样两个键各自被单独验证。
      // 不手写 process.env[key] = saved —— saved 为 undefined 时会写入字符串 "undefined"；
      // 复原交给 afterEach → restoreEnv()。
      Object.assign(process.env, creds);
      delete process.env[key];
      expect(await exchangeIdentity({ code: "c1" }), key).toEqual({ error: "wechat_not_configured" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // —— 上游超时必须存在：微信 API 挂死时，登录请求原本会无限期挂着 ——
  // 桩要复现真实 fetch 的契约（signal abort 时 reject），否则测到的是桩自己的耐心而不是超时。
  const hangUntilAborted = (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal.reason));
  });

  it("both wechat fetches are handed an AbortSignal", async () => {
    const seen = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      seen.push(init?.signal);
      return isTokenCall(url) ? jsonResponse(TOKEN_BODY) : jsonResponse({ nickname: "张三" });
    }));
    await exchangeIdentityWechat("c1");
    expect(seen).toHaveLength(2);
    expect(seen[0], "token 交换在登录关键路径上，必须有超时").toBeInstanceOf(AbortSignal);
    expect(seen[1], "userinfo 只是装饰，更不该把登录挂住").toBeInstanceOf(AbortSignal);
  });

  // 超时值从 env 读、默认 10s：把它写死成 10s 的话，这条用例就得真等 10 秒——
  // 为一个断言花 10 秒不成比例（同一个理由在 Task 6 的 M11 上已经裁定过一次）。
  // env 配置不是「测试专用后门」：本模块的微信参数（APP_ID / APP_SECRET / REDIRECT_URI）
  // 本来就全部来自 env，超时值属于同一类运维可调项。
  it("a hung token endpoint is aborted by WECHAT_TIMEOUT_MS instead of hanging the login", async () => {
    process.env.WECHAT_TIMEOUT_MS = "50";
    const hung = vi.fn(hangUntilAborted);
    vi.stubGlobal("fetch", hung);

    const started = Date.now();
    const out = await exchangeIdentityWechat("c1");
    const elapsed = Date.now() - started;

    expect(elapsed, "必须被超时打断；挂死意味着登录请求永远不返回").toBeLessThan(3000);
    expect(elapsed).toBeGreaterThanOrEqual(40);   // 证明确实等到了超时，而不是提前短路
    expect(out.error, "超时算交换失败，走既有的 error 通道而不是抛出").toMatch(/^wechat_exchange_failed: /);
    expect(out.error).not.toContain(SECRET);
    expect(out.error).not.toContain("api.weixin.qq.com");
    expect(out.unionid).toBeUndefined();
  }, 8000);

  it("a hung userinfo endpoint degrades to the wx- fallback instead of hanging", async () => {
    process.env.WECHAT_TIMEOUT_MS = "50";
    vi.stubGlobal("fetch", vi.fn((url, init) => (isTokenCall(url) ? jsonResponse(TOKEN_BODY) : hangUntilAborted(url, init))));

    const started = Date.now();
    const id = await exchangeIdentityWechat("c1");
    expect(Date.now() - started).toBeLessThan(3000);
    expect(id.error).toBeUndefined();
    expect(id.unionid).toBe("unionid_ABC123");
    expect(id.nickname).toBe("wx-ABC123");
    expect(id.avatar_url).toBe("");
  }, 8000);

  it("a failed userinfo call leaves a console.warn trace instead of vanishing silently", async () => {
    // 降级是对的（资料只是装饰，不该把用户挡在门外），但**静默**降级不对：
    // 线上出现「所有人头像和昵称都变成 wx-xxxxxx 兜底值」时，没有一行日志就无从判断
    // 是微信资料接口挂了、还是 access_token 权限没开、还是本模块自己写错了。
    // warnSpy 由 describe 的 beforeEach 装（既消音、也让这里可以直接断言）。
    vi.stubGlobal("fetch", vi.fn(async (url) =>
      isTokenCall(url) ? jsonResponse(TOKEN_BODY) : Promise.reject(new Error("profile endpoint down"))));

    const id = await exchangeIdentityWechat("c1");
    expect(id.unionid, "降级路径本身不许被这条改动破坏").toBe("unionid_ABC123");
    expect(id.nickname).toBe("wx-ABC123");
    expect(warnSpy, "userinfo 失败必须留下可查的痕迹").toHaveBeenCalled();
    const msg = warnSpy.mock.calls.flat().join(" ");
    expect(msg).toContain("profile endpoint down");
    // 日志里不许出现 access_token / secret / 上游 URL（其 query 里带凭证）
    expect(msg).not.toContain(SECRET);
    expect(msg).not.toContain("at_1");
    expect(msg).not.toContain("api.weixin.qq.com");
  });
});
