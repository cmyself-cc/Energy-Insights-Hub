import { useEffect, useState } from "react";
import { backendApi } from "../utils/backendApi";
import { i18n } from "../constants/i18n";
import { storage } from "../utils/storage";
import { isMobileViewport } from "../hooks/useIsMobile";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";

// 登录门：App 在 /api/auth/me 确认身份之前挂这个组件，它替代整个应用外壳。
//
// 四态都必须真渲染出可读的界面，**任何一态都不许 return null** —— 白屏与「还在加载」
// 在用户眼里是同一件事，而这里的每一态都对应一个服务端已经做出决定的结果。
//
// 状态由 location.hash 驱动，因为服务端的 GET 回跳就是用 hash 传结果的
// （auth.js: "/"、"/login#invite=<ticket>"、"/login#disabled"、"/login#state_expired"）。
// ⚠️ hash 必须放进 state 并监听 hashchange，不能在 render 里直接读 window.location.hash：
// 本组件自己也会写 hash（mock 模式的 dev-login 走 JSON，拿到 need_invite 后要切到邀请态），
// 而给 window.location.hash 赋值**不会触发 React 重渲染**，直接读的话界面会永远停在等待态。
export default function LoginGate({ onLoggedIn }) {
  const [hash, setHash] = useState(() => window.location.hash);
  // null = /auth/config 还没回来。此时渲染微信按钮会拿到 undefined 的 href，
  // 所以 waiting 态要区分「加载中」与「加载完但没配」。
  const [config, setConfig] = useState(null);
  const [code, setCode] = useState("");
  const [devUnionid, setDevUnionid] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // 语言与暗色只能在这里自决：App 的 language/darkMode state 还没建立（它被本组件挡在外面）。
  // 取值逻辑与 App.jsx 的初始值逐字一致，否则登录门与登录后的界面会闪一次语言/配色。
  const [language] = useState(() => (isMobileViewport() ? "zh" : (storage.getStoredLanguage() || "en")));
  const [darkMode] = useState(() => storage.getDarkMode());

  // || i18n.en 这层兜底不能省：storage.getStoredLanguage() 直接返回 localStorage.getItem，
  // **不校验值域**。里面只要有一个不认识的值（手工改过、浏览器扩展写过、或某个曾经存在过的
  // 语言被移除后留下的陈旧值），i18n[language] 就是 undefined，而这是**登录门** —— 抛异常
  // 意味着用户连登录都做不到，也没办法用 UI 把语言改回来。仓里已有 4 处同样的防御写法
  // （ContentFiltersPage / InsightsGenerator / TrackerSettingsPage ×2），这里沿用惯例。
  const t = (i18n[language] || i18n.en).auth;

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    // StrictMode 下 effect 跑两次 → 两个并发 /auth/config。服务端已把该端点做成幂等
    // （已有合法 state cookie 就复用），所以两次拿到的是同一个 state；cancelled 只用于
    // 丢弃第一次的 setState，避免卸载后写入。
    let cancelled = false;
    backendApi.getAuthConfig()
      .then((res) => { if (!cancelled) setConfig(res.data || { mockMode: false, authorizeUrl: null }); })
      .catch((e) => {
        console.error("[LoginGate] failed to load auth config:", e?.message || e);
        // 拿不到 config 也要落地成一个可渲染的态，而不是永远停在加载中：
        // 回落到「未配置」，用户至少看得见一句人话。
        if (!cancelled) setConfig({ mockMode: false, authorizeUrl: null });
      });
    return () => { cancelled = true; };
  }, []);

  const ticket = hash.startsWith("#invite=") ? hash.slice("#invite=".length) : null;
  const inviteMode = Boolean(ticket);
  const disabledMode = hash === "#disabled";
  // state_expired 归到 waiting 态：重试入口（微信按钮）就在下面，不必多做一个态。
  const stateExpired = hash === "#state_expired";
  const banner = stateExpired ? t.stateExpired : error;

  // 登录成功后先把 hash 摘掉再交给 App。不清的话，用户登出后重新挂载 LoginGate，
  // 会被自己留下的 #invite=<已消费的 ticket> 直接带回邀请态，而那张 ticket 已经失效。
  const finish = (user) => {
    const target = window.location.pathname === "/login"
      ? "/"
      : window.location.pathname + window.location.search;
    window.history.replaceState(null, "", target);
    setHash("");
    onLoggedIn(user);
  };

  // handleIdentity 的 JSON 出口只有三种 status（active / need_invite / disabled），
  // 与 GET 回跳的三个 location 一一对应。落到 default 说明服务端契约变了，
  // 这里没有合适的文案可以谎报，只留一条可查的日志、界面停在原态让用户重试。
  const applyAuthResult = (data) => {
    if (data?.status === "active" && data.user) return finish(data.user);
    if (data?.status === "need_invite" && data.ticket) { window.location.hash = `#invite=${data.ticket}`; return; }
    if (data?.status === "disabled") { window.location.hash = "#disabled"; return; }
    console.error("[LoginGate] unexpected auth status:", data?.status);
  };

  const handleInviteSubmit = async (e) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || !ticket || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await backendApi.registerWithInvite(ticket, trimmed);
      if (res?.data?.user) finish(res.data.user);
      else {
        console.error("[LoginGate] register returned no user");
        setError(t.inviteError);
      }
    } catch (err) {
      // /register 匿名可达且带限速，429 与「邀请码错」必须给不同的话：
      // 前者再试一次就好，后者要去找管理员要新码。区分依据是状态码，不是错误文案。
      console.error("[LoginGate] register failed:", err?.message || err);
      setError(err?.status === 429 ? t.rateLimited : t.inviteError);
    } finally {
      setBusy(false);
    }
  };

  // 仅 mock 模式可见（config.mockMode 由服务端按 AUTH_DEV_MODE + NODE_ENV 判定）。
  const handleDevLogin = async (e) => {
    e.preventDefault();
    const trimmed = devUnionid.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await backendApi.devLogin(trimmed);
      applyAuthResult(res.data);
    } catch (err) {
      console.error("[LoginGate] dev login failed:", err?.message || err);
      // 这里直接把服务端给的固定字符串显示出来：它是开发者入口，服务端那些文案
      // （dev_unionid_required / not found / invalid state）本身就是写给开发者看的，
      // 翻译成用户话术反而丢信息。用户可见的微信路径不走这个分支。
      setError(err?.status === 429 ? t.rateLimited : (err?.message || t.notConfigured));
    } finally {
      setBusy(false);
    }
  };

  const bg = darkMode ? COLORS.background.dark : "#f8f8fc";
  const cardBg = darkMode ? COLORS.background.cardDark : COLORS.background.card;
  const text = darkMode ? "#e8e8e8" : COLORS.text.primary;
  // 用 secondary(#555) 而不是 tertiary(#888)：#888 在白底上是 3.54:1，低于 WCAG AA 的 4.5:1。
  // 暗色下 #888 对 cardDark(#1c1f2b) 是 4.77:1，本来就过线，保持不动。
  const muted = darkMode ? "#888" : COLORS.text.secondary;
  const border = darkMode ? COLORS.border.dark : COLORS.border.light;

  const inputStyle = {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    borderRadius: BORDER_RADIUS.md,
    border: `1px solid ${border}`,
    background: darkMode ? COLORS.background.dark : "#fff",
    color: text,
    fontSize: FONT_SIZES.base,
    outline: "none"
  };
  // off = 按钮处于 disabled（busy 或输入为空）。
  // ⚠️ disabled 态必须在**视觉上**可分辨：只有 disabled 属性、样式却与可点时逐像素相同的话，
  // 用户看不出「为什么点了没反应」，会以为页面卡了。responsive.css 里没有 button:disabled 规则，
  // 而 inline style 又表达不了伪类，所以由调用方把 disabled 的同一个布尔值传进来。
  // 用 opacity 而不是换 background：换色会引入 theme.js 之外的字面值，而 disabled 控件本来就
  // 不受 WCAG 对比度约束，压暗是最省事也最不会与主题打架的做法。
  const primaryBtn = (off) => ({
    width: "100%",
    padding: "11px 16px",
    borderRadius: BORDER_RADIUS.md,
    border: "none",
    background: COLORS.primary,
    color: "#fff",
    fontSize: FONT_SIZES.base,
    fontWeight: 600,
    cursor: off ? "not-allowed" : "pointer",
    opacity: off ? 0.45 : 1,
    textDecoration: "none",
    display: "block",
    textAlign: "center",
    boxSizing: "border-box",
    transition: `opacity ${TRANSITIONS.fast}`
  });
  // 与下面 button 的 disabled 用同一个布尔值，避免「属性说禁用了、样式说能点」这种分叉
  const inviteOff = busy || !code.trim();
  const devOff = busy || !devUnionid.trim();

  return (
    <div style={{
      minHeight: "100vh",
      background: bg,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      boxSizing: "border-box",
      fontFamily: "'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    }}>
      <div style={{
        width: "100%",
        maxWidth: 380,
        background: cardBg,
        border: `1px solid ${border}`,
        borderRadius: BORDER_RADIUS["2xl"],
        padding: 28,
        boxSizing: "border-box",
        boxShadow: "0 2px 12px rgba(0,0,0,0.05)"
      }}>
        <img src="/logo.jpg" alt="logo" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", display: "block", marginBottom: 14 }} />

        {disabledMode ? (
          <>
            <h1 style={{ margin: "0 0 10px", fontSize: FONT_SIZES["2xl"], fontWeight: 700, color: text }}>{t.loginTitle}</h1>
            <p style={{ margin: 0, fontSize: FONT_SIZES.base, color: COLORS.status.error, lineHeight: 1.6 }}>{t.disabled}</p>
          </>
        ) : (
          <>
            <h1 style={{ margin: "0 0 18px", fontSize: FONT_SIZES["2xl"], fontWeight: 700, color: text }}>{t.loginTitle}</h1>

            {banner && (
              <div style={{
                marginBottom: 14,
                padding: "9px 12px",
                borderRadius: BORDER_RADIUS.md,
                border: `1px solid ${COLORS.status.error}`,
                background: darkMode ? "rgba(204,0,0,0.12)" : "rgba(204,0,0,0.05)",
                color: COLORS.status.error,
                fontSize: FONT_SIZES.sm,
                lineHeight: 1.5
              }}>
                {banner}
              </div>
            )}

            {inviteMode ? (
              <form onSubmit={handleInviteSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={{ fontSize: FONT_SIZES.sm, color: muted, fontWeight: 500 }}>{t.inviteTitle}</label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={t.invitePlaceholder}
                  autoComplete="off"
                  autoFocus
                  style={inputStyle}
                />
                <button type="submit" disabled={inviteOff} style={primaryBtn(inviteOff)}>{t.inviteSubmit}</button>
              </form>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {config === null ? (
                  <div style={{ height: 40 }} />
                ) : config.authorizeUrl ? (
                  <a href={config.authorizeUrl} style={primaryBtn(false)}>{t.wechatLogin}</a>
                ) : (
                  <p style={{ margin: 0, fontSize: FONT_SIZES.sm, color: muted, lineHeight: 1.6 }}>{t.notConfigured}</p>
                )}

                {config?.mockMode && (
                  <form onSubmit={handleDevLogin} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8, paddingTop: 14, borderTop: `1px solid ${border}` }}>
                    <label style={{ fontSize: FONT_SIZES.sm, color: muted, fontWeight: 500 }}>{t.devLogin}</label>
                    <input
                      type="text"
                      value={devUnionid}
                      onChange={(e) => setDevUnionid(e.target.value)}
                      placeholder={t.devPlaceholder}
                      autoComplete="off"
                      style={inputStyle}
                    />
                    {/* label 与按钮不再复用同一个键：t.devLogin 是这块表单的说明（「本地开发登录（仅测试）」），
                        按钮是动作。同一句话在一个表单里出现两次没有信息量。 */}
                    <button type="submit" disabled={devOff} style={primaryBtn(devOff)}>{t.devLoginSubmit}</button>
                  </form>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
