import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Sidebar from "./Sidebar";
import Header from "./Header";
import LoginGate from "./LoginGate";
import { i18n } from "../constants/i18n";

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

  it("admin 才渲染模型芯片（R1：/api/models 整前缀 requireAdmin）", () => {
    // 静态渲染下 currentModel 恒为 null（它的赋值在 useEffect 里），所以芯片文案固定是
    // 「No model」。这是 R1 唯一能被静态渲染看到的效果：普通用户不该挂载这个消费者，
    // 否则它恒显示 No model、tooltip 还指向普通用户进不去的配置页。
    expect(renderHeader(ADMIN)).toContain("No model");
    expect(renderHeader(USER)).not.toContain("No model");
    expect(renderHeader(null)).not.toContain("No model");
  });

  it("移动端不渲染模型芯片（即便用户是 admin）", () => {
    expect(renderHeader(ADMIN, { isMobile: true })).not.toContain("No model");
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
    // 输入框为空时按钮必须是 disabled，且样式上与可点态可分辨（A4）
    expect(html).toContain("disabled");
    expect(html).toContain("not-allowed");
    expect(html).toContain("opacity:0.45");
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
    // storage.getStoredLanguage() 直接返回 localStorage.getItem，**不校验值域**。
    // 这是登录门：抛异常意味着用户连登录都做不到，也没办法用 UI 把语言改回来。
    // 去掉 `(i18n[language] || i18n.en)` 里的兜底，这条用例会以 TypeError 失败。
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
