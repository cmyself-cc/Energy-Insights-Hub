import { useEffect, useState, useRef } from "react";
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
  // ── 用户名+邀请码体系（产品负责人 2026-10-21，替代微信扫码成为主登录方式）──
  const [pairMode, setPairMode] = useState("login");       // "login" | "register"
  const [username, setUsername] = useState("");
  const [pairCode, setPairCode] = useState("");
  // 注册成功后的「保存提醒」屏：{ user, code, username }。点「进入应用」才 finish ——
  // 提醒必须在用户离开登录门之前被看见（finish 后整个 LoginGate 就被 App 替换了）。
  const [regReminder, setRegReminder] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // 语言与暗色只能在这里自决：App 的 language/darkMode state 还没建立（它被本组件挡在外面）。
  // 下面这个表达式与 App.jsx 挂载 effect 里的
  // `setLanguage(isMobileViewport() ? "zh" : (savedLanguage || "en"))` **逐字相同**（同一个
  // storage.getStoredLanguage()、同一个 || "en"），否则登录门与登录后的界面会闪一次语言。
  // ⚠️ 措辞订正：这里早先写的是「与 App.jsx 的**初始值**逐字一致」，不准确 —— App 的
  // useState 种子是 `isMobileViewport() ? "zh" : "en"`（不读 storage），读 storage 发生在
  // 它挂载后的 effect 里。两边最终收敛到同一个值，但「初始值」不是同一个表达式。
  // 配色同理：darkMode 两边都是 useState(() => storage.getDarkMode()) 的惰性初始化。
  const [language] = useState(() => (isMobileViewport() ? "zh" : (storage.getStoredLanguage() || "en")));
  const [darkMode] = useState(() => storage.getDarkMode());

  // 这里**不需要** `|| i18n.en` 兜底 —— 防御已经上移到唯一的读取口：
  // storage.getStoredLanguage() 的契约是「受支持的语言，或 null」（它按 Object.keys(i18n)
  // 校验值域），所以上面那个 `|| "en"` 之后 language 必然是 i18n 的一个真键。
  // 早先这里写的是 `(i18n[language] || i18n.en).auth`，那只是把崩溃从登录门挪到了鉴权墙之后：
  // App.jsx 用同样的 `savedLanguage || "en"`，而 "klingon" 是真值、兜底不触发，于是
  // Header.jsx 的 `i18n[language].auth` 照样抛 TypeError、整个 App 进 ErrorBoundary，
  // 而语言切换按钮就在崩溃的那棵树里，用户没法用 UI 自救。在消费点逐个补兜底是打地鼠
  // （仓里一度同时存在两种写法：LoginGate 防、Header/App 不防），校验值域只需一处。
  const t = i18n[language].auth;

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

  // 本地记住的 pair 优先静默免登（默认不用再次登录）。StrictMode 双跑守卫：
  // 该 effect  deps 为 []，开发模式会执行两次，没有 ref 就会发两条 login-pair。
  const pairTriedRef = useRef(false);
  useEffect(() => {
    if (pairTriedRef.current) return;
    const stored = storage.getPairLogin();
    if (!stored) return;
    pairTriedRef.current = true;
    let cancelled = false;
    backendApi.loginPair(stored.code, stored.username)
      .then((res) => { if (!cancelled && res?.data?.user) finish(res.data.user); })
      .catch((err) => {
        if (cancelled) return;
        // 免登失败 = 记忆失效（用户被禁用 / 凭证对不上）：清掉本机记忆、回填表单让用户手输。
        // 403 走既有 #disabled 页，不在这里覆盖。
        storage.clearPairLogin();
        if (err?.status === 403) { window.location.hash = "#disabled"; return; }
        setUsername(stored.username);
        setPairCode(stored.code);
        setError(err?.status === 429 ? t.rateLimited : t.pairLoginFailed);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finish/t 随挂载定型；storage 读一次
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

  // pair 登录：成功后把 pair 写进本机记忆（默认下次免登），再 finish。
  const handlePairLogin = async (e) => {
    e.preventDefault();
    const u = username.trim();
    const c = pairCode.trim();
    if (!u || !c || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await backendApi.loginPair(c, u);
      if (res?.data?.user) {
        storage.setPairLogin(u, c);
        finish(res.data.user);
      }
    } catch (err) {
      console.error("[LoginGate] pair login failed:", err?.message || err);
      if (err?.status === 403) { window.location.hash = "#disabled"; return; }
      setError(err?.status === 429 ? t.rateLimited : t.pairLoginFailed);
    } finally {
      setBusy(false);
    }
  };

  // pair 开通：成功**不立刻 finish** —— 先停在保存提醒屏（提醒用户保存码+用户名）。
  const handlePairRegister = async (e) => {
    e.preventDefault();
    const u = username.trim();
    const c = pairCode.trim();
    if (!u || !c || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await backendApi.registerPair(c, u);
      if (res?.data?.user) setRegReminder({ user: res.data.user, code: c, username: u });
    } catch (err) {
      // register-pair 的 400 是 ApiError 风格的人话（invalid/expired/exhausted），直接显示
      console.error("[LoginGate] pair register failed:", err?.message || err);
      setError(err?.status === 429 ? t.rateLimited : (err?.message || t.inviteError));
    } finally {
      setBusy(false);
    }
  };

  const bg = darkMode ? COLORS.background.dark : "#f8f8fc";
  const cardBg = darkMode ? COLORS.background.cardDark : COLORS.background.card;
  const text = darkMode ? "#e8e8e8" : COLORS.text.primary;
  // 用 secondary(#555) 而不是 tertiary(#888)：#888 在白底上是 3.54:1（实测 3.5449），
  // 低于 WCAG AA 的 4.5:1。暗色下 #888 对 cardDark(#1c1f2b) 实测是 **4.627:1**
  // （此前这里写的「4.77」是算错的），仍然过线，所以保持不动 —— 但余量只有 **0.127**：
  // cardDark 稍微调亮一点就会掉出 AA。改那个 token 时必须重算这一对。
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
  // 而 inline style 又表达不了伪类，所以由调用方把 disabled 的**同一个**布尔值传进来 ——
  // 「disabled 属性与样式由同一个布尔值驱动」才是真正的不变量，别把两者拆开各算一遍。
  //
  // 换底色 + 换标签色，而不是压 opacity。原来那版（background 恒为 primary、opacity 0.45）
  // 的问题出在标签：白字落在「α=0.45 的 primary 与浅色卡片合成」出来的 #98bca7 上只有
  // **2.08:1**，远低于 WCAG AA 的 4.5:1。而「#555 填充 + 白字」那个候选更糟：#555 与
  // primary(#1a6b3c) 的对比度只有 **1.14:1**，两者几乎同亮度、只靠色相区分 —— 灰度与红绿色盲下
  // 等于没区分，正好把 A4 原本的缺陷重造一遍。
  // 现在这一对（background.disabled #f0f0f0 填充 + text.secondary #555 标签）：标签对比
  // **6.54:1**，且这一对里没有任何随 darkMode 变化的量，所以两种配色模式下是同一个数；
  // 与启用态填充的对比度 **5.74:1**（1.4.11 非文本下限 3:1），灰度下依然分得清。两个值都是 theme.js 的 token。
  // transition 也从 opacity 改成 background-color：opacity 已经不是那个变化量了。
  const primaryBtn = (off) => ({
    width: "100%",
    padding: "11px 16px",
    borderRadius: BORDER_RADIUS.md,
    border: "none",
    background: off ? COLORS.background.disabled : COLORS.primary,
    color: off ? COLORS.text.secondary : "#fff",
    fontSize: FONT_SIZES.base,
    fontWeight: 600,
    cursor: off ? "not-allowed" : "pointer",
    textDecoration: "none",
    display: "block",
    textAlign: "center",
    boxSizing: "border-box",
    transition: `background-color ${TRANSITIONS.fast}`
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
            ) : regReminder ? (
              <PairSaveReminder
                code={regReminder.code}
                username={regReminder.username}
                t={t}
                text={text}
                muted={muted}
                warnColor={COLORS.status.error}
                onEnter={() => {
                  // 进入应用时才写本机记忆：用户在提醒屏上还没答应「保存」，先把pair写进
                  // localStorage 会让「提醒」失去意义。
                  storage.setPairLogin(regReminder.username, regReminder.code);
                  finish(regReminder.user);
                }}
              />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <PairLoginForm
                  mode={pairMode}
                  username={username}
                  code={pairCode}
                  busy={busy}
                  t={t}
                  text={text}
                  muted={muted}
                  border={border}
                  darkMode={darkMode}
                  onUsernameChange={setUsername}
                  onCodeChange={setPairCode}
                  onSubmit={pairMode === "login" ? handlePairLogin : handlePairRegister}
                  onToggleMode={() => setPairMode(pairMode === "login" ? "register" : "login")}
                />

                {/* 微信扫码：仅在真实模式配好凭证时存在（产品负责人 2026-10-21：保留备用） */}
                {config?.authorizeUrl && (
                  <a href={config.authorizeUrl} style={{ ...primaryBtn(false), marginTop: 4 }}>{t.wechatLogin}</a>
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

// 用户名+邀请码表单（纯展示组件，抽出给静态渲染测试观察三态）：
//   login    ：用户名 → 邀请码 → 登录 + 「首次使用？」切换
//   register ：邀请码 → 用户名 → 开通 + 保存提醒常驻文案 + 「已有账号？」切换
// 🔴 两态的字段顺序**不同**是产品语义：首开先验码（码决定角色与能否注册）、登录先人（人为主键）。
// disabled 遵循 A4 不变量：属性与样式由同一个布尔值驱动。
export function PairLoginForm({ mode, username, code, busy, t, text, muted, border, darkMode, onUsernameChange, onCodeChange, onSubmit, onToggleMode }) {
  const inputStyle = {
    width: "100%", boxSizing: "border-box", padding: "10px 12px",
    borderRadius: BORDER_RADIUS.md, border: `1px solid ${border}`,
    background: darkMode ? COLORS.background.dark : "#fff",
    color: text, fontSize: FONT_SIZES.base, outline: "none"
  };
  const primaryBtn = (off) => ({
    width: "100%", padding: "11px 16px", borderRadius: BORDER_RADIUS.md, border: "none",
    background: off ? COLORS.background.disabled : COLORS.primary,
    color: off ? COLORS.text.secondary : "#fff",
    fontSize: FONT_SIZES.base, fontWeight: 600,
    cursor: off ? "not-allowed" : "pointer",
    boxSizing: "border-box", textAlign: "center",
    transition: `background-color ${TRANSITIONS.fast}`
  });
  const off = busy || !username.trim() || !code.trim();
  const fields = mode === "login"
    ? [
        { key: "u", label: t.pairUsername, value: username, onChange: onUsernameChange },
        { key: "c", label: t.pairCode, value: code, onChange: onCodeChange }
      ]
    : [
        { key: "c", label: t.pairCode, value: code, onChange: onCodeChange },
        { key: "u", label: t.pairUsername, value: username, onChange: onUsernameChange }
      ];
  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label style={{ fontSize: FONT_SIZES.sm, color: muted, fontWeight: 500 }}>
        {mode === "login" ? t.pairTitle : t.pairRegisterTitle}
      </label>
      {fields.map((f) => (
        <input
          key={f.key}
          type="text"
          value={f.value}
          onChange={(e) => f.onChange(e.target.value)}
          placeholder={f.label}
          aria-label={f.label}
          autoComplete="off"
          style={inputStyle}
        />
      ))}
      {/* 注册态常驻提醒：保存码+用户名是唯一的找回路径（产品负责人明确要求） */}
      {mode === "register" && (
        <p style={{ margin: 0, fontSize: FONT_SIZES.sm, color: muted, lineHeight: 1.6 }}>{t.pairSaveReminder}</p>
      )}
      <button type="submit" disabled={off} style={primaryBtn(off)}>
        {mode === "login" ? t.pairSubmit : t.inviteSubmit}
      </button>
      <button
        type="button"
        onClick={onToggleMode}
        style={{ border: "none", background: "transparent", color: text, fontSize: FONT_SIZES.sm, cursor: "pointer", textAlign: "center", padding: "4px 0" }}
      >
        {mode === "login" ? t.pairToRegister : t.pairToLogin}
      </button>
    </form>
  );
}

// 注册成功后的保存提醒屏（纯展示）：把码与用户名大字呈现，用户点「进入」才离开登录门。
export function PairSaveReminder({ code, username, t, text, muted, warnColor, onEnter }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ margin: 0, fontSize: FONT_SIZES.base, color: warnColor, lineHeight: 1.6, fontWeight: 600 }}>
        {t.pairSaveReminder}
      </p>
      <div style={{ padding: "12px 14px", borderRadius: BORDER_RADIUS.md, background: "rgba(245,197,24,0.12)", border: "1px solid #f5c518" }}>
        <div style={{ fontSize: FONT_SIZES.sm, color: muted, marginBottom: 6 }}>{t.pairUsername}</div>
        <code style={{ fontSize: FONT_SIZES.lg, fontWeight: 700, color: text }}>{username}</code>
        <div style={{ fontSize: FONT_SIZES.sm, color: muted, margin: "10px 0 6px" }}>{t.pairCode}</div>
        <code style={{ fontSize: FONT_SIZES.lg, fontWeight: 700, color: text, letterSpacing: 1 }}>{code}</code>
      </div>
      <button onClick={onEnter} style={{
        width: "100%", padding: "11px 16px", borderRadius: BORDER_RADIUS.md, border: "none",
        background: COLORS.primary, color: "#fff", fontSize: FONT_SIZES.base, fontWeight: 600,
        cursor: "pointer", boxSizing: "border-box"
      }}>
        {t.pairSubmit}
      </button>
    </div>
  );
}
