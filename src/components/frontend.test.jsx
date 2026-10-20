import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Sidebar from "./Sidebar";
import Header from "./Header";
import LoginGate from "./LoginGate";
import { i18n } from "../constants/i18n";
import { COLORS } from "../constants/theme";
import { storage } from "../utils/storage";

// 这些组件的静态渲染观察者。
//
// 为什么用 renderToStaticMarkup 而不是 jsdom / @testing-library：两者都不在依赖里
// （devDependencies 里 jsdom、happy-dom、@testing-library/* 一个都没有），而 react-dom 是
// **生产依赖**，server 渲染器自带。本文件因此只能观察「首次渲染产出的标记」——
// 这足以钉住下面这些纯 props → 标记的判定：角色可见性、移动端登出入口、admin 徽标、
// 登录门四态文案、语言兜底。
//
// 🔴 诚实说明覆盖边界：静态渲染**不执行 useEffect**，所以以下行为在本文件里没有观察者，
// 只能靠 jsdom 或人工浏览器冒烟：
//   · App.jsx 两个 `if (!userId) return` 的 effect 守卫；
//   · LoginGate 拿到 /auth/config **之后**的三个分支（微信按钮 / dev-login 表单 / notConfigured）；
//   · Header 里 TrackerProgress / getCurrentModel 的实际网络行为（isAdmin 只改变挂载与否）。
// TrackerProgress 与 ReportProgress 在首渲染时 visible 均为 false、直接 return null，
// 所以它们在静态标记里根本不出现——R1 唯一可静态观察的效果是模型芯片。
//
// 本文件不碰数据库，因此**不需要也不应该有** afterAll(clearAuthTables())
// （那条规则只适用于写 auth 表的套件）。

// storage.js 的键名（src/utils/storage.js:1-8）。这里硬编码而不是 import：
// STORAGE_KEYS 没有被导出，而测试要验证的正是「组件通过 storage 读到的值」这条链路。
// （文件末尾那个值域契约 describe 块直接 import 了 `storage` 对象本身 —— 它导出了，
//   而那块要观察的正是它的返回值，不经过组件。）
const LANG_KEY = "energy_insights_language";
const DARK_KEY = "energy_insights_dark_mode";

// vitest 默认跑在 node 环境，没有 window/localStorage。LoginGate 的 useState 惰性初始化器
// 会同步读 window.location.hash 和 storage.getStoredLanguage()，所以必须先桩上。
// ⚠️ localStorage 必须真的可用：storage.js 的每个 getter 都包 try/catch 并在失败时
// console.error —— 桩缺失会往全量测试输出里新增 stderr 块，直接破坏「stderr 停在 12 块」
// 这条硬指标。
// window.matchMedia 也必须桩：useIsMobile.js 的 isMobileViewport() 是
// `typeof window !== "undefined" && window.matchMedia(QUERY).matches`，
// 只桩 window 不桩 matchMedia 会 TypeError。
function installBrowserStub({ hash = "", language, darkMode = false, mobile = false } = {}) {
  const store = new Map();
  if (language !== undefined) store.set(LANG_KEY, language);
  if (darkMode) store.set(DARK_KEY, "true");
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); }
  };
  globalThis.window = {
    location: { hash, pathname: "/login", search: "" },
    history: { replaceState: () => {} },
    matchMedia: () => ({ matches: mobile, addEventListener: () => {}, removeEventListener: () => {} }),
    addEventListener: () => {},
    removeEventListener: () => {}
  };
}

function uninstallBrowserStub() {
  delete globalThis.window;
  delete globalThis.localStorage;
}

// 桩是 per-test 作用域的：beforeEach 装、afterEach 拆。vitest 默认 isolate，跨文件本来就不会
// 泄漏，但显式拆装让「别的套件看到的仍是纯 node 环境」这件事不依赖那个默认值。
beforeEach(() => { installBrowserStub(); });
afterEach(() => { uninstallBrowserStub(); });

// React 把 inline style 序列化成 `prop:value;prop:value` 且**不做**大小写或空格归一化，
// 所以比对前把两边都归一化：转小写 + 抹掉 `;` 与 `:` 周围的空白。这样断言里可以直接写
// theme.js 的 token，而不是抄一份字面值。
function normalizeStyle(styleAttr) {
  return styleAttr.toLowerCase().replace(/\s*([;:])\s*/g, "$1");
}

const noop = () => {};

function renderSidebar(props) {
  return renderToStaticMarkup(
    <Sidebar darkMode={false} language="en" activeTab="intelligence" onTabChange={noop} {...props} />
  );
}

function renderHeader(user, props) {
  return renderToStaticMarkup(
    <Header
      darkMode={false}
      language="en"
      onLanguageToggle={noop}
      activeTab="intelligence"
      onTabChange={noop}
      user={user}
      onLogout={noop}
      {...props}
    />
  );
}

function renderGate(props) {
  return renderToStaticMarkup(<LoginGate onLoggedIn={noop} {...props} />);
}

const ADMIN = { id: 1, unionid: "wx-admin", nickname: "Alice", avatar_url: null, role: "admin", status: "active" };
const USER = { id: 2, unionid: "wx-user", nickname: "Bob", avatar_url: null, role: "user", status: "active" };

describe("Sidebar — 配置入口的角色可见性", () => {
  it("admin 看到 Configuration 入口", () => {
    const html = renderSidebar({ role: "admin" });
    expect(html).toContain("Configuration");
  });

  it("普通用户看不到 Configuration 入口，但另外两个入口仍在", () => {
    const html = renderSidebar({ role: "user" });
    expect(html).not.toContain("Configuration");
    // 反向断言：拦住「filter 把所有项都滤掉」这种把 bug 修过头的变异
    expect(html).toContain("Market Intelligence");
    expect(html).toContain("Reports");
  });

  it("role 完全省略时按 fail-closed 处理（不显示 Configuration）", () => {
    // 安全相关的默认值：/auth/me 降级、老会话、或任何漏传 role 的调用方都必须落到
    // 「看不见配置入口」，而不是「看得见」。
    const html = renderSidebar({});
    expect(html).not.toContain("Configuration");
    expect(html).toContain("Market Intelligence");
  });

  it("role 是未知字符串时同样 fail-closed", () => {
    const html = renderSidebar({ role: "superadmin" });
    expect(html).not.toContain("Configuration");
  });
});

describe("Header — 身份块与登出入口", () => {
  it("桌面端已登录时渲染登出按钮", () => {
    const html = renderHeader(USER);
    expect(html).toContain("Log out");
  });

  it("移动端（isMobile: true）登出按钮**仍然在**", () => {
    // 这条钉住控制器的裁定：移动端没有侧边栏也没有配置页，如果登出跟着 isMobile 一起藏掉，
    // 手机上就再也没有退出登录的入口。它是最容易被日后「整理移动端布局」静默回归的东西。
    const html = renderHeader(USER, { isMobile: true });
    expect(html).toContain("Log out");
    // 移动端收紧的是信息（昵称、admin 徽标），不是操作。
    // 断言用 `>Bob<` 而不是 `Bob`：昵称作为文本只出现在 !isMobile 的 <span> 里，
    // 而首字母圆标的 title 属性在移动端仍然带昵称（那是 hover 提示，不是布局信息）。
    expect(html).not.toContain(">Bob<");
    expect(renderHeader(ADMIN, { isMobile: true })).not.toContain("Admin");
  });

  it("admin 显示管理员徽标，普通用户不显示", () => {
    expect(renderHeader(ADMIN)).toContain("Admin");
    expect(renderHeader(USER)).not.toContain("Admin");
  });

  it("未登录（user=null）时没有登出按钮、也没有身份块", () => {
    const html = renderHeader(null);
    expect(html).not.toContain("Log out");
    expect(html).not.toContain(">U<");
  });

  it("有昵称时用首字母而不是占位的 \"U\"", () => {
    const html = renderHeader({ ...USER, nickname: "Alice" });
    expect(html).toContain("Alice");
    expect(html).not.toContain(">U<");
  });

  it("昵称是非字母数字开头（emoji）时回落到 \"U\" 而不是渲染半个代理对", () => {
    const html = renderHeader({ ...USER, nickname: "🌞 Sunny" });
    expect(html).toContain(">U<");
  });

  it("有微信头像时渲染 <img>，不渲染首字母圆标", () => {
    const html = renderHeader({ ...USER, avatar_url: "https://wx.example/a.jpg" });
    expect(html).toContain("https://wx.example/a.jpg");
    expect(html).not.toContain(">B<");
  });

  // 断言挂在 **title 属性**上，不挂在 "No model" 那段文案上。
  // "No model" 来自 Header.jsx:87 的空态分支，而 server/routes/models.js:81 返回的是
  // `{ name: process.env.LLM_MODEL || "未配置", isActive: true }` —— 恒为真值，所以真实浏览器里
  // currentModel 永远不是 null，那个分支是**死代码**（延后项 #3，已折进 Task 6b）。把观察者挂在
  // 即将消失的代码上，修 models.js 的那天这条断言会跟着一起失效。
  // title 与那段文案在**同一个** `{!isMobile && isAdmin && (...)}` 块里（Header.jsx:75），
  // 观察到的是完全相同的门禁，而它在生产里确实渲染。
  // N-15 已落地（2026-10-21，随 Task 6b）：文案移进 i18n.js 的 competitiveIntelligence
  // .modelChipTitle，这里直接读 i18n —— 测试与实现共用同一来源，改文案不会弄红测试。
  const CHIP_TITLE = i18n.en.competitiveIntelligence.modelChipTitle;

  it("admin 才渲染模型芯片（R1：/api/models 整前缀 requireAdmin）", () => {
    expect(renderHeader(ADMIN)).toContain(CHIP_TITLE);
    expect(renderHeader(USER)).not.toContain(CHIP_TITLE);
    expect(renderHeader(null)).not.toContain(CHIP_TITLE);
  });

  it("移动端不渲染模型芯片（即便用户是 admin）", () => {
    expect(renderHeader(ADMIN, { isMobile: true })).not.toContain(CHIP_TITLE);
  });
});

describe("LoginGate — 四态都必须渲染真文案", () => {
  it("#disabled 渲染标题 + 停用说明", () => {
    installBrowserStub({ hash: "#disabled" });
    const html = renderGate();
    expect(html).toContain("Sign in to Energy Insights Hub");
    expect(html).toContain("This account has been disabled. Please contact the administrator.");
  });

  it("#invite=<ticket> 渲染邀请码表单（说明文字 + 输入框 + 开通按钮）", () => {
    installBrowserStub({ hash: "#invite=abc123" });
    const html = renderGate();
    expect(html).toContain("Enter your invite code to activate");
    expect(html).toContain("Activate");
    expect(html).toContain("<input");
  });

  it("输入框为空时，disabled 属性与「看得出是禁用」的样式由**同一个布尔值**驱动（A4）", () => {
    installBrowserStub({ hash: "#invite=abc123" });
    const html = renderGate();
    expect(html).toContain("disabled");

    // 🔴 只取**带 disabled 属性那个元素**的 style。整页 toContain 会是假阳性：
    // 同页的 <label> 用 color: muted，而浅色模式下 muted 恰好也是 COLORS.text.secondary，
    // 于是「按钮标签色」这条断言即使按钮的 color 分支被删掉也照样通过。
    const offStyle = normalizeStyle(/<button[^>]*\sdisabled[^>]*style="([^"]*)"/.exec(html)?.[1] || "");
    expect(offStyle, "带 disabled 的按钮必须真的存在，且带 style").not.toBe("");
    // 引用 theme.js 的 token 本身，而不是抄一份字面值：日后调 token 不会红，
    // 但在组件里换一个 token 会红。
    expect(offStyle).toContain(`background:${COLORS.background.disabled.toLowerCase()}`);
    expect(offStyle).toContain(`color:${COLORS.text.secondary.toLowerCase()}`);
    expect(offStyle).toContain("cursor:not-allowed");
    // 禁用态不能同时带着启用态的填充色（否则就是「两个分支都写上了」那种变异）
    expect(offStyle).not.toContain(`background:${COLORS.primary.toLowerCase()}`);
    // 标签对比度是这一对的全部意义所在（#555 on #f0f0f0 = 6.54:1，两种配色模式同值）。
    // 白字是旧实现（primary 填充 + opacity 0.45，标签对比只有 2.08:1）的痕迹，必须不再出现。
    expect(offStyle).not.toContain("color:#fff");
    expect(offStyle).not.toContain("opacity");
  });

  it("#state_expired 渲染超时提示，而不是白屏", () => {
    installBrowserStub({ hash: "#state_expired" });
    const html = renderGate();
    expect(html).toContain("Your sign-in timed out. Please scan the QR code again.");
  });

  it("空 hash（waiting 态）也渲染标题，不返回 null", () => {
    installBrowserStub({ hash: "" });
    const html = renderGate();
    expect(html).toContain("Sign in to Energy Insights Hub");
    // config 还没回来（=== null）时是等高占位，不是「未配置」文案
    expect(html).not.toContain("WeChat sign-in is not configured");
  });

  it("中文语言下渲染中文文案", () => {
    installBrowserStub({ hash: "", language: "zh" });
    const html = renderGate();
    expect(html).toContain("登录混沌能源智库");
  });

  it("localStorage 里是不认识的语言值时回落到英文，而不是抛异常（M-1）", () => {
    // ⚠️ 这条用例观察的机制**换过一次**，别按旧描述理解它。
    // 原来它钉的是 LoginGate 自己的 `(i18n[language] || i18n.en)` 兜底；那层兜底已经删掉了，
    // 防御上移到唯一的读取口 —— storage.getStoredLanguage() 现在按 Object.keys(i18n) 校验值域，
    // 不认识的值返回 null，于是 LoginGate 的 `|| "en"` 才真的触发。
    // 所以现在这条用例走的是**真实机制**：把 storage.js 的值域校验去掉，language 会变成
    // "klingon"，`i18n["klingon"]` 是 undefined，`.auth` 抛 TypeError，本条用例红。
    // 变异 S1 已实测证实（见提交信息）。
    installBrowserStub({ hash: "", language: "klingon" });
    const html = renderGate();
    expect(html).toContain("Sign in to Energy Insights Hub");
  });

  it("dev-login 按钮有自己的文案键（M-10）", () => {
    // 🔴 这个按钮本身只在 config.mockMode 为真时渲染，而 config 来自 useEffect，
    // 静态渲染看不到它。所以这里退一步钉住键的契约：en/zh 都有 devLoginSubmit，
    // 且它不再与 devLogin（表单说明）复用同一个键。
    expect(i18n.en.auth.devLoginSubmit).toBe("Sign in");
    expect(i18n.zh.auth.devLoginSubmit).toBe("登录");
    expect(i18n.en.auth.devLoginSubmit).not.toBe(i18n.en.auth.devLogin);
    expect(i18n.zh.auth.devLoginSubmit).not.toBe(i18n.zh.auth.devLogin);
    // 双语对称：控制器会机械校验，这里把它变成一条会红的断言
    expect(Object.keys(i18n.zh.auth).sort()).toEqual(Object.keys(i18n.en.auth).sort());
  });
});


// —— storage.getStoredLanguage() 的值域契约（系统性 locale 兜底）——
//
// 为什么放在这个文件里而不是新建 src/utils/storage.test.js：本轮 allow-list 只批了一个新文件
// （server/testGlobalSetup.js），所以不新建；而这个文件已经有现成的 localStorage 桩。
// 若日后拆分，pinyinIndex.test.js 是「前端非 React 测试」的既有先例。
//
// 为什么光有上面那条 LoginGate 用例不够：那条观察的是「坏值不会让登录门崩」，而这里观察的是
// **契约本身**（坏值 → null）。渲染层分不出这两者 —— 无论 getStoredLanguage() 返回 null
// 还是返回 "en"，LoginGate 都渲染英文标题，两条用例都绿。只有直接断言返回值才钉得住契约。
describe("storage.getStoredLanguage — 值域校验", () => {
  it("存的是受支持的语言时原样返回", () => {
    installBrowserStub({ language: "zh" });
    expect(storage.getStoredLanguage()).toBe("zh");
    installBrowserStub({ language: "en" });
    expect(storage.getStoredLanguage()).toBe("en");
  });

  it("存的是不认识的值时返回 null，而不是把垃圾原样吐出去", () => {
    // 调用方都写 `savedLanguage || "en"`，而任何非空字符串都是真值 —— 兜底不会触发，
    // 垃圾值会一路走到 i18n[language] 变成 undefined。
    for (const junk of ["klingon", "EN", "zh-TW", "", " "]) {
      installBrowserStub({ language: junk });
      expect(storage.getStoredLanguage(), `language=${JSON.stringify(junk)} 必须被判定为不支持`).toBeNull();
    }
  });

  it("从没存过时返回 null，由调用方决定默认值", () => {
    installBrowserStub({});
    expect(storage.getStoredLanguage()).toBeNull();
  });

  it("i18n 的每个顶层键都被 getStoredLanguage 接受", () => {
    // 抄死一份清单的话，日后新增语言会**静默地**被当成垃圾值丢掉：用户存得进去、读不回来，
    // 而且不会有任何报错。这条把「i18n 加了键但支持集没跟上」变成一条会红的断言。
    // ⚠️ 诚实说明它今天强制到什么程度：storage.js 的实现确实是 `Object.keys(i18n)`，
    // 但只要 i18n 仍然只有 en/zh，把它换成硬编码 `["en","zh"]` 是**等价变异体**、
    // 全套件照样绿（评审 G15 实测 SURVIVED）。这条的牙齿要等第三种语言出现才长得出来 ——
    // 它买的是「那一天不会静默漂移」，不是「今天能抓住抄死」。
    const locales = Object.keys(i18n);
    expect(locales.length).toBeGreaterThan(0);
    for (const locale of locales) {
      installBrowserStub({ language: locale });
      expect(storage.getStoredLanguage(), `i18n 的顶层键 ${locale} 必须被接受`).toBe(locale);
    }
  });

  // 🔴 刻意**不**测 localStorage 不可用时那条 catch 分支。理由是价值，不是做不到：
  // 那个分支返回 null，而「返回 null」已经被上面「从没存过时返回 null」那条钉住了 ——
  // 补一条只能证明「换个原因也走到同一个 null」，钉不住任何新行为。
  // （附注：stderr 块不是硬阻塞。触发它确实会走 storage.js 的 console.error、往全量输出
  // 多一个 stderr 块，但仓里已有 4 处 `vi.spyOn(console, "error").mockImplementation(() => {})`
  // 的惯例：views.test.js:188、admin.test.js:387、apiRoutes.test.js:240，以及
  // identityProvider.test.js:94 的 warn 版。真要测，压掉那条日志即可。）
});


// —— theme token 之间的对比度契约（A4 禁用态配色的**理由**）——
//
// 为什么需要这一块：控制器的变异 C-C 把 COLORS.background.disabled 从 #f0f0f0 换成 #555，
// 全量 336 条**全绿**。而 #555 正是评审提出、被控制器否掉的那个候选 —— 它与启用态
// primary(#1a6b3c) 的对比度只有 **1.14:1**，几乎同亮度、只靠色相区分；灰度打印与红绿色盲下
// 「禁用」与「启用」不可分辨，正好把 A4 原本要修的缺陷重造一遍。
// 组件层那几条断言引用 token 而不是抄字面值（这是对的：调 token 不该让测试红），代价就是
// **token 之间的关系无人观察**。这一块补的正是那个关系：断言的是比例，不是色值。
//
// 算法是 WCAG 2.x 的相对亮度 + 对比度，纯算术、零依赖、不需要 jsdom。
// 先自检三个已发表参考值，免得算法本身错了却把结论当证据 —— 本分支已经三次算错对比度：
// 注释里的 4.77 实为 4.627；控制器派发表里的 6.751/6.15/1.16/15.29 实为 6.542/5.737/1.140/14.394
// （根因是手算亮度时对高于阈值的通道误用了线性分支）。
function srgbChannel(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex) {
  const s = hex.replace("#", "");
  const full = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

describe("theme tokens — A4 禁用态配色契约", () => {
  it("算法自检：三个已发表参考值必须先对得上", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21.0, 3);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.5422, 3);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.4781, 3);
    // 3 位 hex 展开必须与 6 位等价（theme.js 里两种写法都有：text.secondary 是 "#555"）
    expect(contrastRatio("#555", "#f0f0f0")).toBeCloseTo(contrastRatio("#555555", "#f0f0f0"), 6);
  });

  it("两种状态的标签都过 WCAG AA 4.5:1，且禁用态那一对与配色模式无关", () => {
    // 禁用态：#555 on #f0f0f0 实测 6.542。这一对里没有任何随 darkMode 变化的量，
    // 所以浅色/深色是同一个数 —— 旧实现（primary 填充 + opacity 0.45）在浅色下只有 2.082。
    expect(contrastRatio(COLORS.text.secondary, COLORS.background.disabled)).toBeGreaterThanOrEqual(4.5);
    // 启用态：白字 on primary 实测 6.537
    expect(contrastRatio("#fff", COLORS.primary)).toBeGreaterThanOrEqual(4.5);
  });

  it("🔴 禁用态填充与启用态填充在**灰度**下可分辨", () => {
    // 阈值 3:1 取自 WCAG 1.4.11 对非文本对比度的下限。今天实测 5.737；被否掉的 #555 候选只有
    // 1.140 —— 那条路会让「禁用」只靠色相表达。要改这个 token，先重算这条比例再改断言。
    // ⚠️ 这条与上面那条的关系，别搞错：C-C 变异体（disabled → #555）**同时**死在②③④三条上，
    // 而②一条就够。事实上「标签是 #555 且填充比 primary 浅」时，②+④在数学上蕴含③
    // （cr(#555,fill)≥4.5 ⇒ L(fill)≥0.5838 ⇒ cr(fill,primary)≥3.946），所以③**今天的边际
    // 价值为零**。但③不是装饰品：它约束的是「填充 vs primary」这一对，与标签色无关，
    // 评审 G22 用 text.secondary→#000 + disabled→#777777 实测只有③红。保留它。
    expect(contrastRatio(COLORS.background.disabled, COLORS.primary)).toBeGreaterThanOrEqual(3);
  });

  it("禁用态填充比启用态**更浅**（「洗掉」的通用视觉语言）", () => {
    // 这是上一条之外独立的性质：#555 的亮度(0.0908)比 primary(0.1106)还低，即使对比度过了 3:1，
    // 「比启用态更暗」也会与 disabled 的通用观感相反。今天 #f0f0f0 的亮度是 0.8714。
    // ⚠️ 这一条是 4 条里唯一编码**品味**而非 WCAG 标准的（②③都有明确出处）。未来若真要
    // 做「更暗的禁用态」，需要刻意推翻的是这一条，不是②③ —— 评审实测可行域：填充调暗到
    // #c9c9c9 仍全绿，更暗则必须同时把标签调深（如 #333 on #c8c8c8 = 7.55 / 灰度 3.91）。
    expect(relativeLuminance(COLORS.background.disabled)).toBeGreaterThan(relativeLuminance(COLORS.primary));
  });

  // 🔴 刻意**不**断言「禁用态填充 vs 卡片轮廓」的下限：浅色下实测只有 1.140，而 WCAG 对
  // inactive 控件豁免（1.4.3 / 1.4.11）。要把它提到 3:1 就必须压暗填充，而压暗会同时压掉上面
  // 那条标签对比 —— 两个目标互相打架，所以这里选择保住标签可读性。深色下同一对是 14.394，
  // 即这个豁免只在浅色模式里真正起作用。这个取舍是有意的，别当缺陷「顺手修」。
});
