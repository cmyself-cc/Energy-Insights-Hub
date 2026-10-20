import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ConfigurationPage from "../ConfigurationPage";
import UsersPage, { UserRow, UsersList } from "./UsersPage";
import InviteCodesPage, { InviteForm, InviteRow, InviteList, UsagesPanel } from "./InviteCodesPage";
import { i18n } from "../../constants/i18n";
import { COLORS } from "../../constants/theme";
import { buildInvitePayload, backendApi } from "../../utils/backendApi";

// Task 7b（PRD 的 ADM-1 / ADM-2）的静态渲染观察者。
//
// 手法与 src/components/frontend.test.jsx 一致：react-dom 是**生产依赖**，`react-dom/server`
// 的 renderToStaticMarkup 自带，所以不需要 jsdom / @testing-library / happy-dom（三者都不在
// devDependencies 里，控制器明令禁止引入）。vitest.config.js 没有 React 插件，esbuild 直接吃
// .jsx，node 环境，单条 ~5ms。
//
// 🔴 诚实说明覆盖边界 —— renderToStaticMarkup **不执行 useEffect、不派发事件**，所以以下行为
// 在本文件里**没有观察者**，只能靠浏览器人工冒烟：
//   · UsersPage / InviteCodesPage 挂载时那两个 fetch，以及 `cancelled` 竞态标志；
//   · 所有事件处理器：patch（切角色 / 启停）、create、toggleActive、toggleUsages；
//   · 🔴 **「校验失败就不发请求」这条因果**：本文件能测到 buildInvitePayload 返回 { ok:false }
//     （纯函数，见下面 e/f/g 三组），也能测到 InviteForm 会把 err 文本渲染出来，但测不到
//     InviteCodesPage.create() 里那个 early return —— 它在 handler 里，静态渲染够不着；
//   · 409「cannot demote or disable the last active admin」的服务端文案回显；
//   · 失效态在真实浏览器里的观感（下面只钉住可机检的部分：文字色两态相同、底色两态不同、
//     显式文字徽标存在、markup 里没有 opacity、对比度过 4.5）。
//
// 🔴 角色门禁与配色**都不是安全属性**：服务端 /api/admin 整前缀 requireAdmin
// （server/apiRoutes.js + server/lib/authMiddleware.js）才是边界。下面 a 组测的是「非 admin
// 不会看到两个白打的 403 请求和一屏 console 噪音」，不是「非 admin 被挡住了」。
//
// 本文件不碰数据库，因此**不需要也不应该有** afterAll(clearAuthTables())
// （那条规则只适用于写 5 张 auth 表的套件；clearAuthTables 在 server/testUtils.js:43 会调
//   initDb() 跑整套迁移，挂上来等于把纯渲染测试绑到迁移健康度上 —— 控制器派发注记 4）。

// —— WCAG 2.x 相对亮度 + 对比度（纯算术、零依赖、不需要 jsdom）——
// 放在文件顶部是因为下面的「生效态 vs 失效态」组也要用它（函数声明会提升，但定义在使用点
// 之前更好读）。算法先自检三个已发表参考值，免得算法本身错了却把结论当证据：本分支已经
// 三次算错对比度（注释里的 4.77 实为 4.627；控制器派发表里的 6.751/6.15/1.16/15.29 实为
// 6.542/5.737/1.140/14.394 —— 根因是手算亮度时对高于阈值的通道误用了线性分支）。
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

// —— 浏览器桩 ——
// vitest 默认跑在 node 环境。ConfigurationPage.jsx:41 的 useState 初始化器会同步读
// localStorage（经 storage.js），而 storage.js 的每个 getter 都包 try/catch 并在失败时
// console.error —— 桩缺失会往全量输出里**新增 stderr 块**，直接破坏「stderr 停在 12 块」
// 这条硬指标。window.matchMedia 也必须桩（useIsMobile.js 的 isMobileViewport() 会调它）。
const LANG_KEY = "energy_insights_language";
let originalFetch;

function installBrowserStub({ language } = {}) {
  const store = new Map();
  if (language !== undefined) store.set(LANG_KEY, language);
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); }
  };
  globalThis.window = {
    location: { hash: "", pathname: "/config", search: "" },
    history: { replaceState: () => {} },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  // 静态渲染不该发生任何网络请求（effect 不跑）。真被调到就让测试**响亮地**失败，
  // 而不是悄悄打真接口、或挂在一个永不 settle 的 promise 上。
  originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("adminPages.test.jsx 是纯静态渲染测试，不该发生网络请求");
  };
}

function uninstallBrowserStub() {
  delete globalThis.window;
  delete globalThis.localStorage;
  if (originalFetch !== undefined) { globalThis.fetch = originalFetch; originalFetch = undefined; }
}

beforeEach(() => { installBrowserStub(); });
afterEach(() => { uninstallBrowserStub(); vi.restoreAllMocks(); });

// —— 样式归一化与提取 ——
// React 把 inline style 序列化成 `prop:value;prop:value`，不做大小写/空格归一化，
// 所以比对前两边都归一化（照 frontend.test.jsx:76 的写法）。
function normalizeStyle(s) {
  return s.toLowerCase().replace(/\s*([;:])\s*/g, "$1");
}
function colorOf(style) { return (normalizeStyle(style).match(/(?:^|;)color:([^;"]*)/) || [])[1] || ""; }
function bgOf(style) { return (normalizeStyle(style).match(/(?:^|;)background:([^;"]*)/) || [])[1] || ""; }
function borderOf(style) { return (normalizeStyle(style).match(/(?:^|;)border:1px solid ([^;"]*)/) || [])[1] || ""; }

function styleOf(re, html) {
  const m = re.exec(html);
  expect(m, `正则 ${re} 必须在这段 markup 里命中`).not.toBeNull();
  return m[1];
}

// 第一个带 background 的 <div> 就是「行 / 卡片」那一层：InviteRow 的外层 wrapper 只有
// display/flex-direction/gap，UsersPage 与 InviteCodesPage 的根 div 同样没有底色。
const ROW_STYLE = /<div style="([^"]*background:[^"]*)"/;
// 只有说明文字那个 span 的内容里带「已用 / 上限」，所以这个正则唯一命中它 ——
// 角色徽标（"User"）与状态徽标（"Active"/"Deactivated"）都不含数字。
const META_STYLE = /<span style="([^"]*)">[^<]*\d+\s*\/\s*/;
const CODE_STYLE = /<code style="([^"]*)"/;

// —— palette 镜像 ——
// 🔴 这是本文件唯一一处「抄实现」：UsersPage / InviteCodesPage 里的 palette(darkMode) 是
// 模块私有函数，无法导出 —— react-refresh/only-export-components 对「混合导出的组件文件」里
// 任何**对象/数组**导出都会 warn（大写命名也救不了：实测 `export const UPPER_OBJ = {}` 照样
// warn，只有大写开头的**函数**和小写的字符串/数字字面量放过），而 npm run lint 带
// --max-warnings 0，warn 即失败。把 palette 挪进独立的 .js 文件能绕开，但那个文件不在
// 本轮 allow-list 内。
//
// 所以镜像的完整性由下面两组断言钉住，不是靠「相信它抄对了」：
//   · 「palette 镜像完整性」组：从 InviteCodesPage 的**真实渲染结果**里反查 text / muted /
//     cardBg / border / fieldBg 五项，逐项与镜像比对（明暗各一次）；
//   · 「行底色两态不同」断言：生效行底色必须等于卡片底色 token，失效行底色必须落在
//     { background.disabled, background.dark } 这个集合里。
// ⚠️ 残留缺口（诚实标注）：palette().inactiveBg 这一行本身没有直接观察者 —— 它只在非空列表
// 的行上出现，而默认页面渲染出的列表恒为空。上面第二条把它的**取值范围**收窄到两个 token
// （换成别的颜色会红），但在这两个之间对调不会红。
const LIGHT = {
  text: COLORS.text.primary, muted: COLORS.text.secondary,
  cardBg: COLORS.background.card, inactiveBg: COLORS.background.disabled,
  border: COLORS.border.light, fieldBg: COLORS.background.card
};
const DARK = {
  text: "#e8e8e8", muted: "#888",
  cardBg: COLORS.background.cardDark, inactiveBg: COLORS.background.dark,
  border: COLORS.border.dark, fieldBg: "#141722"
};

const noop = () => {};
// 🔴 组件的 `t` 契约是**整个 locale 对象**（组件内部再取 `t.admin.xxx`），
// 所以下面这些渲染 helper 的默认值必须是 LEN/LZH；TEN/TZH 只用于写断言。
const LEN = i18n.en;
const LZH = i18n.zh;
const TEN = LEN.admin;
const TZH = LZH.admin;

// —— 固定数据 ——
// 字段名与形状照服务端真实响应，不是凭空造的：
//   GET /admin/users                   → { data: [adminUser(u)] }，resource_counts 恒存在，
//       其中 reports / templates 在 Task 8 的 024 迁移之前会因 "no such column" 被 countSafe
//       降级成 **null**（键在、值是 null，不是缺失）—— 这就是组件必须用 `?? 0` 而不是 `?.`
//       的原因（server/routes/admin.js:23-42）
//   GET /admin/invite-codes            → { data: rows }，SELECT * 原样，active 是 INTEGER 0/1
//   GET /admin/invite-codes/:id/usages → { data: [{ id, unionid, nickname, created_at }] }
const USER_ROW = {
  id: 7, unionid: "wx-1", nickname: "Alice", avatar_url: null,
  role: "admin", status: "active", invited_by_code_id: 3,
  created_at: "2026-01-02 03:04:05", last_login_at: null,
  resource_counts: { reports: null, templates: null, views: 2 }
};
// 一个「什么可选字段都没有」的用户：resource_counts 整个缺失、时间戳为 null、没有邀请码，
// 且 nickname / unionid 都是 null（ADMIN_USER_FIELDS 用 `?? null` 白名单，所以是「键在值为
// null」而不是「键缺失」）—— 显示名因此必须一路回落到 `#8`。
const SPARSE_USER = {
  id: 8, unionid: null, nickname: null, avatar_url: null,
  role: "user", status: "active", invited_by_code_id: null,
  created_at: null, last_login_at: null
};
const INVITE = {
  id: 3, code: "TEST01", label: "L", role: "user",
  used_count: 2, max_uses: null, expires_at: "2026-12-31 23:59:59",
  note: "n", active: 1, created_at: "2026-01-01 00:00:00"
};
// 一张「什么可选字段都没有」的码：used_count 也缺失。
const SPARSE_INVITE = {
  id: 4, code: "TESTADM", label: null, role: "admin",
  expires_at: null, note: null, active: 0
};
const BLANK_FORM = { code: "", label: "", role: "user", max_uses: "", expires_at: "", note: "", default_view: "" };

function renderConfig(user, language = "en", darkMode = false) {
  return renderToStaticMarkup(
    <ConfigurationPage darkMode={darkMode} language={language} onTrackerComplete={noop} user={user} />
  );
}
function renderUserRow(u, { t = LEN, p = LIGHT, codes = [INVITE], codesLoaded = true } = {}) {
  return renderToStaticMarkup(
    <UserRow u={u} codes={codes} codesLoaded={codesLoaded} t={t} p={p} onPatch={noop} />
  );
}
function renderUsersList(users, { t = LEN, p = LIGHT, err = "", codes = [INVITE], codesLoaded = true } = {}) {
  return renderToStaticMarkup(
    <UsersList users={users} codes={codes} codesLoaded={codesLoaded} err={err} t={t} p={p} onPatch={noop} />
  );
}
function renderInviteRow(c, { t = LEN, p = LIGHT, usagesOpen = false, usages = [] } = {}) {
  return renderToStaticMarkup(
    <InviteRow c={c} t={t} p={p} onToggleActive={noop} onToggleUsages={noop}
      usagesOpen={usagesOpen} usages={usages} />
  );
}
function renderInviteList(codes, { t = LEN, p = LIGHT, usagesFor = null, usages = [] } = {}) {
  return renderToStaticMarkup(
    <InviteList codes={codes} t={t} p={p} onToggleActive={noop} onToggleUsages={noop}
      usagesFor={usagesFor} usages={usages} />
  );
}
function renderInviteForm(form = BLANK_FORM, { t = LEN, p = LIGHT, err = "" } = {}) {
  return renderToStaticMarkup(
    <InviteForm form={form} onChange={noop} err={err} t={t} p={p} onCreate={noop} />
  );
}
function countOf(haystack, needle) { return haystack.split(needle).length - 1; }

// =====================================================================================
// a) ConfigurationPage —— 两个管理子标签的角色门禁（真实接线，不是抽出来的辅助函数）
// =====================================================================================
// 为什么直接渲染 ConfigurationPage，而不是把 tabsFor(user) 导出成纯函数来测：
// ① 导出小写函数会触发 react-refresh/only-export-components（warn 即 lint 失败）；
// ② 更重要的是，渲染真实组件测到的是**接线本身** ——「TABS 加了 adminOnly 标记」与
//    「渲染处真的改成了 tabsFor(user).map」是两件事，只测辅助函数抓不住第二件漏改。
// 断言挂在图标而不是标签文本上：图标与语言无关，且每个 tab 恰好渲染一次（下面用计数钉住）。
const TAB_ICONS = ["◎", "▣", "◇", "✦", "⚙", "⊙", "☺", "⌘"];
const BASE_ICONS = TAB_ICONS.slice(0, 6);
const ADMIN_ICONS = TAB_ICONS.slice(6);   // ☺ = users, ⌘ = invites

describe("ConfigurationPage — 管理子标签的角色门禁", () => {
  it("admin 看到全部 8 个标签，每个图标恰好出现一次", () => {
    const html = renderConfig({ id: 1, role: "admin", status: "active" });
    for (const icon of TAB_ICONS) {
      expect(countOf(html, icon), `admin 下图标 ${icon} 应恰好出现 1 次`).toBe(1);
    }
  });

  it("admin 看到两个管理标签的文案（en/zh）", () => {
    const en = renderConfig({ role: "admin" }, "en");
    expect(en).toContain(i18n.en.competitiveIntelligence.usersTab);
    expect(en).toContain(i18n.en.competitiveIntelligence.invitesTab);
    const zh = renderConfig({ role: "admin" }, "zh");
    expect(zh).toContain("用户管理");
    expect(zh).toContain("邀请码");
  });

  // fail-closed：判定写成 `user?.role === "admin"`，所以缺省 / null / 空对象 / 未知字符串 /
  // 大小写不对一律落到「看不见」这一侧，与 Sidebar 的 Configuration 入口、Header 的模型芯片
  // 用的是同一个口径。
  const NON_ADMIN = [
    ["role 是 user", { id: 2, role: "user", status: "active" }],
    ["user 完全省略", undefined],
    ["user 是 null", null],
    ["user 是空对象", {}],
    ["role 是未知字符串", { role: "superadmin" }],
    ["role 大小写不对", { role: "Admin" }]
  ];

  it.each(NON_ADMIN)("非 admin（%s）看不到两个管理标签，但 6 个基础标签一个不少", (_label, user) => {
    const html = renderConfig(user);
    for (const icon of ADMIN_ICONS) {
      expect(countOf(html, icon), `管理图标 ${icon} 不该出现`).toBe(0);
    }
    // 反向断言：拦住「filter 把所有项都滤掉」这种把 bug 修过头的变异
    for (const icon of BASE_ICONS) {
      expect(countOf(html, icon), `基础图标 ${icon} 应恰好出现 1 次`).toBe(1);
    }
    expect(html).toContain(i18n.en.competitiveIntelligence.sources);
    expect(html).toContain(i18n.en.competitiveIntelligence.globalConfigTab);
  });

  it("默认落在 sources 标签：两个管理页的内容都没被渲染", () => {
    // 钉住「分支是按 tab 走的，不是无条件渲染 + CSS 藏起来」。后者会把 UsersPage 的挂载
    // effect 一起触发 —— 非 admin 就会白打两个 403，正是门禁想省掉的东西。
    // ⚠️ 断言挂在 usersTitle / fieldDefaultView / actionCreate 上，**不能**挂在 invitesTitle
    // 上：en 的 admin.invitesTitle 与 competitiveIntelligence.invitesTab 都是 "Invite Codes"，
    // 而后者作为标签文本恒在 markup 里，用前者会得到一条恒红的断言。
    const admin = renderConfig({ role: "admin" }, "en");
    expect(admin).not.toContain(TEN.usersTitle);
    expect(admin).not.toContain(TEN.fieldDefaultView);
    expect(admin).not.toContain(TEN.actionCreate);
    expect(admin).not.toContain(TEN.colInvitedBy);
  });

  it("darkMode 下管理标签同样只对 admin 可见（门禁不受配色模式影响）", () => {
    const dark = renderConfig({ role: "admin" }, "en", true);
    for (const icon of ADMIN_ICONS) expect(countOf(dark, icon)).toBe(1);
    const darkUser = renderConfig({ role: "user" }, "en", true);
    for (const icon of ADMIN_ICONS) expect(countOf(darkUser, icon)).toBe(0);
  });
});

// =====================================================================================
// b) UserRow / UsersList —— ADM-1 用户行
// =====================================================================================
describe("UserRow — 身份、角色、状态", () => {
  it("显示名回落到 unionid，再回落到 #id（绝不渲染空名字）", () => {
    expect(renderUserRow(USER_ROW)).toContain("Alice");
    expect(renderUserRow({ ...USER_ROW, nickname: "" })).toContain("wx-1");
    expect(renderUserRow({ ...USER_ROW, nickname: "", unionid: "" })).toContain("#7");
    // nickname / unionid 都是 null：ADMIN_USER_FIELDS 用 `?? null` 白名单，所以是「键在值为 null」
    expect(renderUserRow(SPARSE_USER)).toContain("#8");
  });

  it("角色徽标与「切换角色」按钮文案跟着 role 翻转", () => {
    const admin = renderUserRow(USER_ROW);
    expect(admin).toContain(TEN.roleAdmin);
    expect(admin).toContain(TEN.actionMakeUser);      // 已是 admin → 按钮是「设为普通用户」
    expect(admin).not.toContain(TEN.actionMakeAdmin);

    const user = renderUserRow({ ...USER_ROW, role: "user" });
    expect(user).toContain(TEN.roleUser);
    expect(user).toContain(TEN.actionMakeAdmin);
    expect(user).not.toContain(TEN.roleAdmin);
  });

  it("中文下角色与按钮文案是中文", () => {
    const html = renderUserRow(USER_ROW, { t: LZH });
    expect(html).toContain(TZH.roleAdmin);
    expect(html).toContain(TZH.actionMakeUser);
    expect(html).not.toContain(TEN.roleAdmin);
  });

  it("status=disabled 时多一个停用徽标，且启停按钮翻转；active 行没有停用徽标", () => {
    const off = renderUserRow({ ...USER_ROW, status: "disabled" });
    expect(off).toContain(TEN.statusDisabled);        // "Disabled"
    expect(off).toContain(TEN.actionEnable);          // "Enable"
    // ⚠️ "Disable" 是 "Disabled" 的子串，所以「不含 actionDisable」只能在 active 行上断言
    expect(off).not.toContain(">" + TEN.actionDisable + "<");

    const on = renderUserRow(USER_ROW);
    expect(on).not.toContain(TEN.statusDisabled);
    expect(on).toContain(TEN.actionDisable);
    expect(on).not.toContain(TEN.actionEnable);
  });

  it("中文下停用徽标同样出现（已停用 / 启用）", () => {
    const off = renderUserRow({ ...USER_ROW, status: "disabled" }, { t: LZH });
    expect(off).toContain(TZH.statusDisabled);        // 已停用
    expect(off).toContain(TZH.actionEnable);          // 启用
    expect(renderUserRow(USER_ROW, { t: LZH })).not.toContain(TZH.statusDisabled);
  });

  it("status 是别的值时按「未停用」渲染（不凭空造出停用徽标）", () => {
    for (const status of ["active", "unknown", null, undefined]) {
      const html = renderUserRow({ ...USER_ROW, status });
      expect(html, `status=${JSON.stringify(status)}`).not.toContain(TEN.statusDisabled);
    }
  });

  it("停用行的底色换成「更沉」的那个 token，且不用 opacity", () => {
    const on = renderUserRow(USER_ROW);
    const off = renderUserRow({ ...USER_ROW, status: "disabled" });
    expect(bgOf(styleOf(ROW_STYLE, on))).toBe(COLORS.background.card.toLowerCase());
    expect(bgOf(styleOf(ROW_STYLE, off))).toBe(COLORS.background.disabled.toLowerCase());
    expect(on).not.toContain("opacity");
    expect(off).not.toContain("opacity");
  });
});

describe("UserRow — 资源计数与时间戳", () => {
  it("计数为 null（Task 8 之前 reports/templates 的真实降级值）时显示 0，不是 undefined", () => {
    // 🔴 这条钉的是 `?? 0` 而不是 `?.`：服务端 countSafe 在 "no such column" 时返回 **null**，
    // 键是存在的，可选链挡不住。
    const html = renderUserRow(USER_ROW);
    expect(html).toContain(`Resources: 0 ${TEN.countReports} · 0 ${TEN.countTemplates} · 2 ${TEN.countViews}`);
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
    expect(html).not.toContain("NaN");
  });

  it("整个 resource_counts 缺失时也显示 0", () => {
    const html = renderUserRow(SPARSE_USER);
    expect(html).toContain(`Resources: 0 ${TEN.countReports} · 0 ${TEN.countTemplates} · 0 ${TEN.countViews}`);
    expect(html).not.toContain("undefined");
  });

  it("真实计数原样显示（en/zh 各自的量词）", () => {
    const counts = { reports: 4, templates: 1, views: 9 };
    expect(renderUserRow({ ...USER_ROW, resource_counts: counts }))
      .toContain(`Resources: 4 ${TEN.countReports} · 1 ${TEN.countTemplates} · 9 ${TEN.countViews}`);
    expect(renderUserRow({ ...USER_ROW, resource_counts: counts }, { t: LZH }))
      .toContain(`${TZH.colResources}: 4 ${TZH.countReports} · 1 ${TZH.countTemplates} · 9 ${TZH.countViews}`);
  });

  it("created_at 截到分钟显示，完整 UTC 原值放进 title 供 hover 核对", () => {
    const html = renderUserRow(USER_ROW);
    expect(html).toContain(`${TEN.colRegistered}: 2026-01-02 03:04`);
    expect(html).toContain('title="2026-01-02 03:04:05 UTC"');
  });

  it("last_login_at 为 null 时显示「never」而不是空白或 null", () => {
    const html = renderUserRow(USER_ROW);
    expect(html).toContain(`${TEN.colLastLogin}: ${TEN.never}`);
    expect(html).toContain('title=""');
    expect(renderUserRow(USER_ROW, { t: LZH })).toContain(`${TZH.colLastLogin}: ${TZH.never}`);
  });

  it("last_login_at 有值时同样截到分钟", () => {
    const html = renderUserRow({ ...USER_ROW, last_login_at: "2026-03-04 05:06:07" });
    expect(html).toContain(`${TEN.colLastLogin}: 2026-03-04 05:06`);
    expect(html).toContain('title="2026-03-04 05:06:07 UTC"');
  });

  it("created_at 也为 null 时（SPARSE_USER）两个时间戳都显示 never，不留空 title 之外的垃圾", () => {
    const html = renderUserRow(SPARSE_USER);
    expect(countOf(html, TEN.never)).toBe(2);
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });
});

// =====================================================================================
// c) 注册来源邀请码 —— users.invited_by_code_id 是整数 id，必须 join 成码文本
// =====================================================================================
describe("UserRow — 注册来源邀请码的三种回落", () => {
  it("join 命中时显示码文本", () => {
    expect(renderUserRow(USER_ROW)).toContain(`${TEN.colInvitedBy}: TEST01`);
    expect(renderUserRow(USER_ROW, { t: LZH })).toContain(`${TZH.colInvitedBy}: TEST01`);
  });

  it("列表里找不到该 id 时说明「码已不存在」并带上 id（不假装是「无」）", () => {
    const html = renderUserRow(USER_ROW, { codes: [{ id: 9, code: "OTHER" }] });
    expect(html).toContain(`${TEN.colInvitedBy}: ${TEN.invitedByMissing} #3`);
    expect(html).not.toContain("OTHER");
    expect(renderUserRow(USER_ROW, { codes: [], t: LZH })).toContain(`${TZH.colInvitedBy}: ${TZH.invitedByMissing} #3`);
  });

  it("invited_by_code_id 为 null 时显示「无」（seed 出来的管理员 / 早于邀请码机制的账号）", () => {
    // 🔴 断言必须带 `${colInvitedBy}: ` 前缀：TEN.invitedByNone 是 "none"，而 markup 里到处
    // 是 `border:none`，裸 toContain("none") 是恒真的假阳性。
    expect(renderUserRow({ ...USER_ROW, invited_by_code_id: null }))
      .toContain(`${TEN.colInvitedBy}: ${TEN.invitedByNone}`);
    expect(renderUserRow(SPARSE_USER, { t: LZH }))
      .toContain(`${TZH.colInvitedBy}: ${TZH.invitedByNone}`);
  });

  it("邀请码列表还没加载完时只显示 #id，不谎称「码已不存在」", () => {
    const html = renderUserRow(USER_ROW, { codes: [], codesLoaded: false });
    expect(html).toContain(`${TEN.colInvitedBy}: #3`);
    expect(html).not.toContain(TEN.invitedByMissing);
  });

  it("id 为 0 这种边界值走「找不到」分支，不被 == null 吞掉", () => {
    // invited_by_code_id 是自增主键的外键，0 不该出现；但 `id == null` 对 0 是 false，
    // 所以它会落到 find 分支 → 找不到 → 「码已不存在 #0」。这条钉住这个行为是有意的：
    // 把 == null 改成 !id 会让 0 显示成「无」，那是一句假话。
    expect(renderUserRow({ ...USER_ROW, invited_by_code_id: 0 }, { codes: [] }))
      .toContain(`${TEN.invitedByMissing} #0`);
  });
});

describe("UsersList — 空态与错误态", () => {
  it("空列表渲染空态文案，不渲染任何行", () => {
    const html = renderUsersList([]);
    expect(html).toContain(TEN.usersEmpty);
    expect(html).not.toContain("Alice");
    expect(renderUsersList([], { t: LZH })).toContain(TZH.usersEmpty);
  });

  it("错误态渲染错误文案，**并且仍然渲染已经拿到的行**", () => {
    // 拉列表失败时不该把已有数据一起抹掉：管理员可能是切角色时吃了个 409
    // （「不能降级或停用最后一个在岗管理员」），此时列表还在、只是这次改动没成。
    const html = renderUsersList([USER_ROW], { err: "cannot demote the last active admin" });
    expect(html).toContain("cannot demote the last active admin");
    expect(html).toContain("Alice");
  });

  it("错误态的提示块用不冲淡文字的配色（#c00 on #fff0f0），且两种配色模式同值", () => {
    for (const p of [LIGHT, DARK]) {
      const html = renderUsersList([], { err: "boom", p });
      const style = normalizeStyle(styleOf(/<p style="([^"]*)"/, html));
      expect(style).toContain("background:#fff0f0");
      expect(style).toContain("color:#c00");
      expect(style).not.toContain("opacity");
      expect(contrastRatio("#c00", "#fff0f0")).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("多行全部渲染，各一行", () => {
    const html = renderUsersList([USER_ROW, SPARSE_USER]);
    expect(countOf(html, "Alice")).toBe(1);
    expect(html).toContain("#8");
  });
});

describe("UsersPage — 默认（effect 未跑）渲染", () => {
  it("渲染标题与空态，且不抛异常（en/zh × 明暗）", () => {
    for (const language of ["en", "zh"]) {
      for (const darkMode of [false, true]) {
        const html = renderToStaticMarkup(<UsersPage darkMode={darkMode} language={language} />);
        expect(html).toContain(i18n[language].admin.usersTitle);
        expect(html).toContain(i18n[language].admin.usersEmpty);
        expect(html).not.toContain("undefined");
      }
    }
  });
});

// =====================================================================================
// d) InviteRow / InviteList / InviteForm / UsagesPanel —— ADM-2
// =====================================================================================
describe("InviteRow — 码面信息", () => {
  it("max_uses 为 null 时显示「不限」而不是 null / ∞", () => {
    const html = renderInviteRow(INVITE);
    expect(html).toContain(`2 / ${TEN.unlimited}`);
    expect(html).not.toContain("null");
    expect(renderInviteRow(INVITE, { t: LZH })).toContain(`2 / ${TZH.unlimited}`);
  });

  it("max_uses 有值时显示 已用 / 上限", () => {
    expect(renderInviteRow({ ...INVITE, max_uses: 5 })).toContain("2 / 5");
  });

  it("used_count 为 null / 缺失时按 0 显示", () => {
    expect(renderInviteRow({ ...INVITE, used_count: null })).toContain(`0 / ${TEN.unlimited}`);
    expect(renderInviteRow(SPARSE_INVITE)).toContain(`0 / ${TEN.unlimited}`);
  });

  it("expires_at 截到日期显示（库里存的是 'YYYY-MM-DD HH:MM:SS'）", () => {
    const html = renderInviteRow(INVITE);
    expect(html).toContain(`${TEN.expiresLabel} 2026-12-31`);
    expect(html).not.toContain("23:59:59");
    expect(renderInviteRow(INVITE, { t: LZH })).toContain(`${TZH.expiresLabel} 2026-12-31`);
  });

  it("expires_at 为 null 时显示「长期有效」", () => {
    expect(renderInviteRow({ ...INVITE, expires_at: null })).toContain(TEN.neverExpires);
    expect(renderInviteRow(SPARSE_INVITE, { t: LZH })).toContain(TZH.neverExpires);
  });

  it("label / note 缺省时不留下悬空的分隔符", () => {
    const html = renderInviteRow(SPARSE_INVITE);
    expect(html).not.toContain(" ·  · ");
    expect(html).not.toContain(">· ");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
    expect(html).not.toContain("NaN");
  });

  it("role 徽标区分 admin 码与 user 码", () => {
    expect(renderInviteRow({ ...INVITE, role: "admin" })).toContain(TEN.roleAdmin);
    const user = renderInviteRow(INVITE);
    expect(user).toContain(TEN.roleUser);
    expect(user).not.toContain(TEN.roleAdmin);
  });

  it("active 判定用严格 === 1：0 / 缺失 / 字符串 \"1\" 一律落到「已停用」侧（fail-closed）", () => {
    // 库里 active 是 INTEGER NOT NULL DEFAULT 1，只会是 0 或 1。用严格等于的意义在于：
    // 字段异常时宁可把一张其实还活着的码显示成已停用，也不要让一张已停用的码看起来还活着。
    expect(renderInviteRow({ ...INVITE, active: 1 })).toContain(TEN.badgeActive);
    for (const active of [0, "1", null, undefined, true]) {
      const html = renderInviteRow({ ...INVITE, active });
      expect(html, `active=${JSON.stringify(active)}`).toContain(TEN.badgeInactive);
      expect(html).not.toContain(TEN.badgeActive);
    }
  });

  it("整行 markup 里不出现 undefined / null / NaN（含最稀疏的那张码）", () => {
    for (const c of [INVITE, SPARSE_INVITE, { ...INVITE, used_count: null, max_uses: 5 }]) {
      const html = renderInviteRow(c);
      expect(html).not.toContain("undefined");
      expect(html).not.toContain("null");
      expect(html).not.toContain("NaN");
    }
  });
});

// —— 🔴 控制器派发注记 9：失效态不许用 opacity 冲淡文字 ——
// brief 样例代码写的是 `opacity: c.active ? 1 : 0.5`，那会把整行**文字**一起冲淡
// （实测浅色卡上 #555 说明文字 7.4552 → 2.3231、<code> 18.8831 → 3.5449，暗色卡上
//  1.4475 / 1.0796，全部低于 WCAG AA 正文下限 4.5），正是 Task 7 Round 3 刚修掉的 A4 缺陷。
// 本组的实现要求：文字颜色两态**完全相同**，失效只由①更沉的行底色 ②显式文字徽标
// ③按钮从「停用」变「重新启用」这三个**不冲淡文字**的通道表达。
describe("InviteRow — 生效态 vs 失效态（注记 9）", () => {
  const ON = renderInviteRow({ ...INVITE, active: 1 });
  const OFF = renderInviteRow({ ...INVITE, active: 0 });

  it("两态的 markup 里都没有 opacity", () => {
    expect(ON).not.toContain("opacity");
    expect(OFF).not.toContain("opacity");
  });

  it("文字颜色两态逐字相同（<code> 与说明 span 都不随状态变淡）", () => {
    const onCode = colorOf(styleOf(CODE_STYLE, ON));
    const offCode = colorOf(styleOf(CODE_STYLE, OFF));
    const onMeta = colorOf(styleOf(META_STYLE, ON));
    const offMeta = colorOf(styleOf(META_STYLE, OFF));
    // 先确认提取本身没失手（正则落空会得到 ""，那样下面两条相等断言会恒真）
    expect(onCode).not.toBe("");
    expect(onMeta).not.toBe("");
    expect(offCode).toBe(onCode);
    expect(offMeta).toBe(onMeta);
  });

  it("行底色两态**不同**：失效态必须有一个不依赖文字颜色的可分辨差异", () => {
    const onBg = bgOf(styleOf(ROW_STYLE, ON));
    const offBg = bgOf(styleOf(ROW_STYLE, OFF));
    expect(onBg).not.toBe("");
    expect(offBg).not.toBe(onBg);
    // 生效行底色就是卡片底色 token；失效行底色落在「更沉」的那两个 token 里
    expect(onBg).toBe(COLORS.background.card.toLowerCase());
    expect([COLORS.background.disabled.toLowerCase(), COLORS.background.dark.toLowerCase()]).toContain(offBg);
  });

  it("失效态的**承重**通道是显式文字徽标（灰度打印 / 色盲 / 读屏软件都拿得到）", () => {
    expect(OFF).toContain(TEN.badgeInactive);
    expect(ON).not.toContain(TEN.badgeInactive);
    expect(ON).toContain(TEN.badgeActive);
    // ⚠️ en 的 badgeInactive("Deactivated") 不含子串 "Active"（大写 A），所以这条不是恒真
    expect(OFF).not.toContain(TEN.badgeActive);
    expect(renderInviteRow({ ...INVITE, active: 0 }, { t: LZH })).toContain(TZH.badgeInactive);
    expect(renderInviteRow({ ...INVITE, active: 1 }, { t: LZH })).toContain(TZH.badgeActive);
  });

  it("主操作按钮跟着状态翻转：停用 ↔ 重新启用", () => {
    // ⚠️ 必须用 `>…<` 边界形式断言 actionDeactivate：en 的 badgeInactive 是 "Deactivated"，
    // 它**包含**子串 "Deactivate"，所以失效行的 markup 里天然有 "Deactivate" 这七个字母 ——
    // 裸 toContain 会得到一条恒红的断言（本轮实测踩到）。按钮文本是被 > < 夹住的，
    // 徽标文本同样被夹住但值是 "Deactivated"，边界形式才能把两者分开。
    expect(ON).toContain(`>${TEN.actionDeactivate}<`);
    expect(ON).not.toContain(TEN.actionReactivate);
    expect(OFF).toContain(`>${TEN.actionReactivate}<`);
    expect(OFF).not.toContain(`>${TEN.actionDeactivate}<`);
    const offZh = renderInviteRow({ ...INVITE, active: 0 }, { t: LZH });
    expect(offZh).toContain(`>${TZH.actionReactivate}<`);
    expect(offZh).not.toContain(`>${TEN.actionDeactivate}<`);
    // zh 侧同样有子串陷阱：actionDeactivate「停用」是 badgeInactive「已停用」的子串
    expect(offZh).toContain(TZH.badgeInactive);
  });

  it("两态的 <code> 与说明文字都对各自底色过 WCAG AA 4.5:1（明暗各一次）", () => {
    for (const p of [LIGHT, DARK]) {
      for (const active of [1, 0]) {
        const html = renderInviteRow({ ...INVITE, active }, { p });
        const bg = bgOf(styleOf(ROW_STYLE, html));
        const code = colorOf(styleOf(CODE_STYLE, html));
        const meta = colorOf(styleOf(META_STYLE, html));
        const tag = `darkMode=${p === DARK} active=${active}`;
        expect(contrastRatio(code, bg), `${tag} <code> ${code} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(meta, bg), `${tag} 说明 ${meta} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("失效徽标那一对（#c00 on #fff0f0）也过 4.5:1，且不随配色模式变化", () => {
    for (const p of [LIGHT, DARK]) {
      const html = renderInviteRow({ ...INVITE, active: 0 }, { p });
      const badge = normalizeStyle(styleOf(/<span style="([^"]*background:#fff0f0[^"]*)"/, html));
      expect(badge).toContain("color:#c00");
      expect(badge).not.toContain("opacity");
    }
    expect(contrastRatio("#c00", "#fff0f0")).toBeGreaterThanOrEqual(4.5);
  });

  it("usagesOpen 时展开使用记录面板，按钮文案变成「收起」", () => {
    const closed = renderInviteRow(INVITE);
    expect(closed).toContain(TEN.actionUsages);
    expect(closed).not.toContain(TEN.usagesTitle);

    const open = renderInviteRow(INVITE, {
      usagesOpen: true,
      usages: [{ id: 11, unionid: "wx-9", nickname: "Bob", created_at: "2026-02-03 04:05:06" }]
    });
    expect(open).toContain(TEN.usagesTitle);
    expect(open).toContain(TEN.actionUsagesHide);
    expect(open).toContain("Bob · 2026-02-03 04:05");
  });
});

describe("InviteList / UsagesPanel — 列表与使用记录", () => {
  it("空列表渲染空态文案", () => {
    const html = renderInviteList([]);
    expect(html).toContain(TEN.invitesEmpty);
    expect(html).not.toContain("TEST01");
    expect(renderInviteList([], { t: LZH })).toContain(TZH.invitesEmpty);
  });

  it("多张码全部渲染，各自一张行", () => {
    const html = renderInviteList([INVITE, SPARSE_INVITE]);
    expect(countOf(html, "TEST01")).toBe(1);
    expect(countOf(html, "TESTADM")).toBe(1);
  });

  it("只有 usagesFor 命中的那一行展开使用记录面板", () => {
    const html = renderInviteList([INVITE, SPARSE_INVITE], {
      usagesFor: 4,
      usages: [{ id: 11, unionid: "wx-9", nickname: "Bob", created_at: "2026-02-03 04:05:06" }]
    });
    expect(countOf(html, TEN.usagesTitle)).toBe(1);
    expect(html).toContain("Bob");
    expect(html).toContain("2026-02-03 04:05");
    expect(html).toContain(TEN.actionUsagesHide);   // 展开的那行按钮变成「收起」
    expect(countOf(html, TEN.actionUsages)).toBe(1);
    expect(html).toContain(TEN.actionUsages);       // 另一行仍是「查看使用记录」
  });

  it("使用记录为空时渲染空态，而不是一个空面板", () => {
    const html = renderToStaticMarkup(<UsagesPanel rows={[]} t={LEN} p={LIGHT} />);
    expect(html).toContain(TEN.usagesTitle);
    expect(html).toContain(TEN.usagesEmpty);
    expect(renderToStaticMarkup(<UsagesPanel rows={[]} t={LZH} p={LIGHT} />)).toContain(TZH.usagesEmpty);
  });

  it("使用记录里的名字同样有 unionid → #id 两级回落，created_at 缺失时不留悬空分隔符", () => {
    const html = renderToStaticMarkup(
      <UsagesPanel t={LEN} p={LIGHT} rows={[
        { id: 12, unionid: "", nickname: "", created_at: null },
        { id: 13, unionid: "wx-x", nickname: null, created_at: "" }
      ]} />
    );
    expect(html).toContain("#12");
    expect(html).toContain("wx-x");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
    expect(html).not.toContain("> · <");
  });
});

describe("InviteForm — 表单与用户可见的语义提示", () => {
  it("渲染全部字段标签与两个 hint（en/zh）", () => {
    for (const [t, a, locale] of [[LEN, TEN, "en"], [LZH, TZH, "zh"]]) {
      const html = renderInviteForm(BLANK_FORM, { t });
      for (const key of ["fieldCode", "fieldLabel", "fieldRole", "fieldMaxUses", "fieldExpires", "fieldNote", "fieldDefaultView"]) {
        expect(html, `${locale}.${key}`).toContain(a[key]);
      }
      expect(html, `${locale}.maxUsesHint`).toContain(a.maxUsesHint);
      expect(html, `${locale}.fieldCodePlaceholder`).toContain(a.fieldCodePlaceholder);
      expect(html, `${locale}.fieldMaxUsesPlaceholder`).toContain(a.fieldMaxUsesPlaceholder);
      expect(html).toContain(a.actionCreate);
    }
  });

  it("🔴 注记 2 的裁定必须在 UI 上可见：expiresHint 说清了「到期日当天全天仍可用」+ UTC", () => {
    // 组件送出去的是 `YYYY-MM-DDT23:59:59`（不是 <input type="date"> 原样的 YYYY-MM-DD），
    // 因为服务端 normalizeExpiresAt 走 SQL 的 datetime()，实测 datetime('2026-12-31') →
    // '2026-12-31 00:00:00'，即「到期日当天 00:00 就已失效」，与管理员填这个日期的本意相反。
    // 不写这句提示，管理员会以为当天还能用。这条断言钉住「提示真的渲染出来了」。
    for (const [t, a] of [[LEN, TEN], [LZH, TZH]]) {
      const html = renderInviteForm(BLANK_FORM, { t });
      expect(html).toContain(a.expiresHint);
      expect(html).toContain("23:59:59");
      expect(html).toContain("UTC");
    }
  });

  it("default_view 的占位符是一段**能直接粘进去用**的合法 JSON 对象", () => {
    // 占位符是管理员唯一的格式示例；写错了就会被照抄，然后在 create 时吃一个 errDefaultView。
    for (const locale of ["en", "zh"]) {
      const ph = i18n[locale].admin.fieldDefaultViewPlaceholder;
      const parsed = JSON.parse(ph);            // 抛异常就说明占位符本身不是合法 JSON
      expect(typeof parsed).toBe("object");
      expect(Array.isArray(parsed)).toBe(false);
      expect(buildInvitePayload({ ...BLANK_FORM, default_view: ph }).ok).toBe(true);
    }
  });

  it("err 传入时渲染错误块，不传时不渲染", () => {
    expect(renderInviteForm(BLANK_FORM, { err: TEN.errMaxUses })).toContain(TEN.errMaxUses);
    expect(renderInviteForm(BLANK_FORM)).not.toContain("<p ");
  });

  it("输入框底色与文字色跟着 darkMode 走（注记 10：darkMode 不许是装饰性参数）", () => {
    const bgs = [];
    for (const p of [LIGHT, DARK]) {
      const input = normalizeStyle(styleOf(/<input style="([^"]*)"/, renderInviteForm(BLANK_FORM, { p })));
      expect(input).toContain(`background:${p.fieldBg.toLowerCase()}`);
      expect(input).toContain(`color:${p.text.toLowerCase()}`);
      expect(contrastRatio(p.text, p.fieldBg), `darkMode=${p === DARK} 输入框文字`).toBeGreaterThanOrEqual(4.5);
      bgs.push(bgOf(input));
    }
    // 两种模式的取值必须**真的不同**，否则 darkMode 只是被解构了没被用
    expect(bgs[0]).not.toBe(bgs[1]);
  });

  it("🔴 每个受控字段都带 onChange（React 会对「有 value 无 onChange」的字段 console.error）", () => {
    // 这条不是摆设：先用一个**故意漏掉 onChange** 的负对照确认观测通道是通的（实测
    // renderToStaticMarkup 确实会为 input / textarea / select 各发一条该警告），再断言真实的
    // InviteForm 一条都不发。漏掉 onChange 的后果是字段在浏览器里变成只读、管理员填不进
    // 邀请码 —— 而那不会让本文件任何其它断言变红。
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderToStaticMarkup(
      <div><input value="x" /><textarea value="y" /><select value="z"><option value="z">z</option></select></div>
    );
    expect(spy.mock.calls.length, "负对照：漏 onChange 必须真的触发 console.error，否则本条无意义").toBeGreaterThan(0);
    expect(spy.mock.calls.join("\n")).toContain("without an `onChange` handler");

    spy.mockClear();
    const filled = { code: "AB", label: "L", role: "admin", max_uses: "3", expires_at: "2026-12-31", note: "n", default_view: "{}" };
    for (const p of [LIGHT, DARK]) {
      for (const t of [LEN, LZH]) {
        renderInviteForm(filled, { p, t });
        renderInviteForm(BLANK_FORM, { p, t });
      }
    }
    expect(spy.mock.calls, "InviteForm 里有字段漏了 onChange").toEqual([]);
  });

  it("InviteCodesPage 默认（effect 未跑）渲染标题、表单与空态，且不抛异常（en/zh × 明暗）", () => {
    for (const language of ["en", "zh"]) {
      for (const darkMode of [false, true]) {
        const html = renderToStaticMarkup(<InviteCodesPage darkMode={darkMode} language={language} />);
        const t = i18n[language].admin;
        expect(html).toContain(t.invitesTitle);
        expect(html).toContain(t.invitesEmpty);
        expect(html).toContain(t.actionCreate);
        expect(html).not.toContain("undefined");
      }
    }
  });
});

// =====================================================================================
// e/f/g) buildInvitePayload —— 纯函数，无副作用，可以完整覆盖
// =====================================================================================
// 🔴 为什么这个函数存在，而不是照 brief / 控制器注记 3 把非法值送成 NaN：
//     JSON.stringify({ max_uses: NaN }) === '{"max_uses":null}'
// JSON 没有 NaN 字面量，序列化一律变 null；而 null 在服务端 normalizeMaxUses 里正是
// 「NULL = 不限」的**合法**输入（server/routes/admin.js:69）。也就是说照注记送 NaN，服务端
// 收到的是 null，建出来的是一张**无限次可用**的邀请码 —— 恰好是注记自己想避免的权限放大，
// 而且静默。所以在客户端就拒绝、根本不发请求，是唯一同时满足 fail-closed 与「管理员立刻
// 看得见」的做法；服务端那道 400 仍是正确的纵深防御（其它客户端、直接打 API）。
describe("buildInvitePayload — 陷阱本身", () => {
  it("🔴 JSON 没有 NaN 字面量：{max_uses: NaN} 序列化后是 null，而 null 在服务端 = 不限次", () => {
    expect(JSON.stringify({ max_uses: NaN })).toBe('{"max_uses":null}');
    expect(JSON.parse(JSON.stringify({ max_uses: NaN })).max_uses).toBeNull();
    // 对照：null 与「不限」在服务端是同一个东西，所以这条不是理论担忧
    expect(buildInvitePayload({ ...BLANK_FORM, max_uses: "" }).payload.max_uses).toBeNull();
  });
});

describe("buildInvitePayload — 合法输入的归一化", () => {
  it("全空表单 → 各字段落 null（服务端的「不限 / 长期有效 / 无默认视角」口径）", () => {
    const r = buildInvitePayload(BLANK_FORM);
    expect(r.ok).toBe(true);
    expect(r.payload).toEqual({
      role: "user", label: "", note: "",
      max_uses: null, expires_at: null, default_view: null
    });
  });

  it("空 code 时**整个键都不放**（交给服务端自动生成），非空时 trim + 转大写", () => {
    expect("code" in buildInvitePayload(BLANK_FORM).payload).toBe(false);
    expect("code" in buildInvitePayload({ ...BLANK_FORM, code: "   " }).payload).toBe(false);
    expect(buildInvitePayload({ ...BLANK_FORM, code: " ab12 " }).payload.code).toBe("AB12");
  });

  it("max_uses：空串与纯空白 → null（不限）；正整数 → 数字", () => {
    // ⚠️ Number("") === 0 而不是 NaN，所以空串必须在 Number() 之前单独放过
    expect(buildInvitePayload({ ...BLANK_FORM, max_uses: "" }).payload.max_uses).toBeNull();
    expect(buildInvitePayload({ ...BLANK_FORM, max_uses: "   " }).payload.max_uses).toBeNull();
    expect(buildInvitePayload({ ...BLANK_FORM, max_uses: "5" }).payload.max_uses).toBe(5);
    expect(buildInvitePayload({ ...BLANK_FORM, max_uses: 5 }).payload.max_uses).toBe(5);
    expect(buildInvitePayload({ ...BLANK_FORM, max_uses: " 7 " }).payload.max_uses).toBe(7);
  });

  it("🔴 注记 2 的裁定：expires_at 补 T23:59:59，让到期日当天全天仍可用", () => {
    // 服务端 normalizeExpiresAt 走 SQL datetime()，实测：
    //   datetime('2026-12-31')                -> '2026-12-31 00:00:00'   ← 当天 00:00 就失效
    //   datetime('2026-12-31T23:59:59')       -> '2026-12-31 23:59:59'   ← 这里选的
    //   datetime('2026-12-31T23:59:59+08:00') -> '2026-12-31 15:59:59'   ← 引入浏览器时区依赖
    //   datetime('garbage')                   -> null                    → 服务端 400
    // 刻意不送带时区偏移的串：那会让同一张码的语义随管理员所在时区改变。代价是 UTC+8 的
    // 管理员实际多出 8 小时 —— 已用 expiresHint 在 UI 上写明 UTC。
    expect(buildInvitePayload({ ...BLANK_FORM, expires_at: "2026-12-31" }).payload.expires_at)
      .toBe("2026-12-31T23:59:59");
    expect(buildInvitePayload({ ...BLANK_FORM, expires_at: "" }).payload.expires_at).toBeNull();
    expect(buildInvitePayload({ ...BLANK_FORM, expires_at: "  " }).payload.expires_at).toBeNull();
    // 闰日：2024 是闰年，必须放过
    expect(buildInvitePayload({ ...BLANK_FORM, expires_at: "2024-02-29" }).payload.expires_at)
      .toBe("2024-02-29T23:59:59");
  });

  it("default_view：合法 JSON 对象原样带上；空串 → null", () => {
    expect(buildInvitePayload({ ...BLANK_FORM, default_view: '{"name":"电力"}' }).payload.default_view)
      .toEqual({ name: "电力" });
    expect(buildInvitePayload({ ...BLANK_FORM, default_view: "  " }).payload.default_view).toBeNull();
  });

  it("label / note 缺省时落空串（不是 undefined —— 那会让 JSON 里整个键消失）", () => {
    const r = buildInvitePayload({ code: "", role: "user", max_uses: "", expires_at: "", default_view: "" });
    expect(r.ok).toBe(true);
    expect(r.payload.label).toBe("");
    expect(r.payload.note).toBe("");
    expect(JSON.stringify(r.payload)).toContain('"label":""');
  });
});

describe("buildInvitePayload — 非法输入一律 fail-closed，绝不静默改写成「不限」", () => {
  it("max_uses 非正整数 → errMaxUses（NaN / 0 / 负数 / 小数 / 千分位 / 全角 / 带单位）", () => {
    // ⚠️ 刻意**不**把 "1e3" / "+2" / "0x3" 放进这个清单：Number() 认它们（1000 / 2 / 3），
    // 是合法正整数，服务端也会接受。把「科学计数法或十六进制写法」当垃圾是常见误解，
    // 这里按实测行为写。同理纯空白也不在清单里 —— 它 trim 成空串，属于「不限」这条合法输入。
    for (const bad of ["abc", "0", "-5", "1.7", "1,000", "３", "3次", "nan", "Infinity", "1_0"]) {
      const r = buildInvitePayload({ ...BLANK_FORM, max_uses: bad });
      expect(r, `max_uses=${JSON.stringify(bad)}`).toEqual({ ok: false, error: "errMaxUses" });
      expect(r.payload, `max_uses=${JSON.stringify(bad)} 不该产出 payload`).toBeUndefined();
    }
    // 上面那几个「看着像垃圾其实合法」的写法确实放过，且值正确 ——
    // 写下来免得日后被当成漏网之鱼「修掉」
    expect(buildInvitePayload({ ...BLANK_FORM, max_uses: "1e3" }).payload.max_uses).toBe(1000);
    expect(buildInvitePayload({ ...BLANK_FORM, max_uses: "0x3" }).payload.max_uses).toBe(3);
  });

  it("🔴 特别是 NaN 本身：绝不落到 payload.max_uses（那会被 JSON 序列化成 null = 不限）", () => {
    const r = buildInvitePayload({ ...BLANK_FORM, max_uses: NaN });
    expect(r).toEqual({ ok: false, error: "errMaxUses" });
    // 双保险：即便实现改了，也不许有任何路径把「不限」偷偷塞进这个非法输入的结果里
    expect(JSON.stringify(r)).not.toContain("null");
  });

  it("role 不是 admin/user 二者之一 → errRole（大小写不对也算非法）", () => {
    for (const bad of ["Admin", "ADMIN", "root", "", null, undefined, 1, {}]) {
      expect(buildInvitePayload({ ...BLANK_FORM, role: bad }), `role=${JSON.stringify(bad)}`)
        .toEqual({ ok: false, error: "errRole" });
    }
    expect(buildInvitePayload({ ...BLANK_FORM, role: "admin" }).ok).toBe(true);
  });

  it("expires_at 不是 YYYY-MM-DD → errExpires", () => {
    // 空串不在这个清单里：它 trim 成空串 → null → 「长期有效」，是合法输入（上面已测）
    for (const bad of ["31/12/2026", "2026-1-1", "tomorrow", "2026-12-31T00:00:00", "2026.12.31", "20261231"]) {
      expect(buildInvitePayload({ ...BLANK_FORM, expires_at: bad }), `expires_at=${bad}`)
        .toEqual({ ok: false, error: "errExpires" });
    }
  });

  it("🔴 形状对但日历上不存在的日期也拒（这一层只能在客户端拒）", () => {
    // SQLite 对越界日期是**静默归一化**而不是报错：实测 datetime('2026-02-30') ->
    // '2026-03-02'、datetime('2026-13-01') -> '2027-01-01'，服务端因此不会 400，而是
    // happily 建出一张到期日与管理员所选**不同**的码 —— fail-open 且无任何提示。
    for (const bad of ["2026-02-30", "2026-13-01", "2026-02-29", "2026-00-10", "2026-04-31"]) {
      expect(buildInvitePayload({ ...BLANK_FORM, expires_at: bad }), `expires_at=${bad} 是日历上不存在的日期`)
        .toEqual({ ok: false, error: "errExpires" });
    }
  });

  it("default_view 不是 JSON 对象 → errDefaultView（数组也算非法，服务端对数组是静默 return）", () => {
    for (const bad of ["{oops", "[]", "[1,2]", "null", '"str"', "42", "true", "{"]) {
      expect(buildInvitePayload({ ...BLANK_FORM, default_view: bad }), `default_view=${bad}`)
        .toEqual({ ok: false, error: "errDefaultView" });
    }
  });

  it("多个字段同时非法时返回**一个**确定的错误码（不是数组、不是 undefined）", () => {
    const r = buildInvitePayload({ ...BLANK_FORM, role: "root", max_uses: "abc", expires_at: "nope", default_view: "{" });
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe("string");
    expect(r.error.length).toBeGreaterThan(0);
    expect(r.payload).toBeUndefined();
  });

  it("🔴 任何非法输入都不会产出 payload —— 没有「半个合法」的中间态", () => {
    const bads = [
      { role: "x" }, { max_uses: "abc" }, { max_uses: NaN }, { expires_at: "2026-02-30" },
      { expires_at: "nope" }, { default_view: "[]" }, { default_view: "{" }
    ];
    for (const patch of bads) {
      const r = buildInvitePayload({ ...BLANK_FORM, ...patch });
      expect(r.ok, JSON.stringify(patch)).toBe(false);
      expect("payload" in r, JSON.stringify(patch)).toBe(false);
    }
  });
});

describe("buildInvitePayload ↔ i18n 的接缝", () => {
  // 🔴 InviteCodesPage.create() 是用 `t.admin[built.error]` **动态取键**的。键名打错不会有
  // 任何编译期报错，只会在 UI 上渲染出内部代号（`|| built.error` 兜底会让管理员直接看到
  // "errMaxUses" 这种字符串）。这条把「纯函数返回的码」与「i18n 里的键」焊在一起。
  const ERROR_CODES = ["errDefaultView", "errExpires", "errMaxUses", "errRole"];

  it("每个错误码在 en/zh 下都是非空字符串", () => {
    for (const code of ERROR_CODES) {
      expect(typeof i18n.en.admin[code], `en.admin.${code}`).toBe("string");
      expect(i18n.en.admin[code].length, `en.admin.${code}`).toBeGreaterThan(0);
      expect(typeof i18n.zh.admin[code], `zh.admin.${code}`).toBe("string");
      expect(i18n.zh.admin[code].length, `zh.admin.${code}`).toBeGreaterThan(0);
    }
  });

  it("i18n.admin 里以 err 开头的键**恰好**是这一组（新增校验分支时必须同步补文案）", () => {
    // 这条让上面那份清单不会悄悄过期：谁加了第 5 个错误码而没更新 ERROR_CODES，这里就红。
    expect(Object.keys(i18n.en.admin).filter((k) => k.startsWith("err")).sort()).toEqual(ERROR_CODES);
    expect(Object.keys(i18n.zh.admin).filter((k) => k.startsWith("err")).sort()).toEqual(ERROR_CODES);
  });

  it("每个错误码都能被 InviteForm 原样显示出来", () => {
    for (const code of ERROR_CODES) {
      expect(renderInviteForm(BLANK_FORM, { err: i18n.en.admin[code] })).toContain(i18n.en.admin[code]);
      expect(renderInviteForm(BLANK_FORM, { err: i18n.zh.admin[code], t: LZH })).toContain(i18n.zh.admin[code]);
    }
  });
});

describe("backendApi — 只暴露 7b 真正消费的 6 个 admin 方法", () => {
  it("6 个方法都是函数", () => {
    for (const m of ["getAdminUsers", "patchAdminUser", "getInviteCodes", "createInviteCode", "patchInviteCode", "getInviteCodeUsages"]) {
      expect(typeof backendApi[m], `backendApi.${m}`).toBe("function");
    }
  });

  it("🔴 视角那 5 个方法一个都没加（属于 Task 11，现在加进来就是死代码）", () => {
    // brief 原文写「Task 7b 自己拥有全部 11 个 backendApi 方法」，控制器派发时已收窄成 6 个。
    for (const m of ["getViews", "createView", "updateView", "deleteView", "setDefaultView"]) {
      expect(m in backendApi, `backendApi.${m} 不该存在`).toBe(false);
    }
  });
});

// =====================================================================================
// h) i18n.admin —— 双语对称、无空值
// =====================================================================================
describe("i18n.admin — 双语对称契约", () => {
  it("en/zh 的 admin 键集完全相同", () => {
    expect(Object.keys(i18n.zh.admin).sort()).toEqual(Object.keys(i18n.en.admin).sort());
    expect(Object.keys(i18n.en.admin).length).toBeGreaterThan(0);
  });

  it("两边都没有空值、没有非字符串、没有首尾空白", () => {
    for (const locale of ["en", "zh"]) {
      for (const [k, v] of Object.entries(i18n[locale].admin)) {
        expect(typeof v, `${locale}.admin.${k}`).toBe("string");
        expect(v.trim().length, `${locale}.admin.${k} 不能为空`).toBeGreaterThan(0);
        expect(v, `${locale}.admin.${k} 不该有首尾空白`).toBe(v.trim());
      }
    }
  });

  it("两个 tab 标签在两个 locale 的 competitiveIntelligence 下都存在且非空", () => {
    for (const locale of ["en", "zh"]) {
      for (const key of ["usersTab", "invitesTab"]) {
        const v = i18n[locale].competitiveIntelligence[key];
        expect(typeof v, `${locale}.competitiveIntelligence.${key}`).toBe("string");
        expect(v.trim().length).toBeGreaterThan(0);
      }
    }
    // competitiveIntelligence 自身的键集也必须对称（本轮往两个 locale 各加了 2 个键）
    expect(Object.keys(i18n.zh.competitiveIntelligence).sort())
      .toEqual(Object.keys(i18n.en.competitiveIntelligence).sort());
  });

  it("顶层键集仍相等（防止只给一个 locale 加了 admin 命名空间）", () => {
    expect(Object.keys(i18n.zh).sort()).toEqual(Object.keys(i18n.en).sort());
    expect(Object.keys(i18n.en)).toContain("admin");
  });

  it("en/zh 的同名键不完全同值（防止某个 locale 整块被复制粘贴成英文）", () => {
    // 只有 default_view 的 JSON 占位符允许两边结构相似，但里面的 name 仍是中英各写。
    let differing = 0;
    for (const k of Object.keys(i18n.en.admin)) {
      if (i18n.en.admin[k] !== i18n.zh.admin[k]) differing += 1;
    }
    expect(differing, "zh.admin 里绝大多数文案应当是中文，不该与 en 逐字相同").toBeGreaterThan(40);
  });
});

// =====================================================================================
// palette 镜像完整性 —— 从真实渲染结果反查，不让上面那个镜像变成「自己证明自己」
// =====================================================================================
describe("palette 镜像完整性 — 从 InviteCodesPage 的真实 markup 反查", () => {
  function extract(html) {
    const card = styleOf(ROW_STYLE, html);
    return {
      text: colorOf(styleOf(/<h3 style="([^"]*)"/, html)),
      muted: colorOf(styleOf(/<span style="([^"]*)"/, html)),
      cardBg: bgOf(card),
      border: borderOf(card),
      fieldBg: bgOf(styleOf(/<input style="([^"]*)"/, html)),
      fieldText: colorOf(styleOf(/<input style="([^"]*)"/, html))
    };
  }

  it("浅色模式：5 项与镜像逐字相同", () => {
    const got = extract(renderToStaticMarkup(<InviteCodesPage darkMode={false} language="en" />));
    expect(got.text).toBe(LIGHT.text.toLowerCase());
    expect(got.muted).toBe(LIGHT.muted.toLowerCase());
    expect(got.cardBg).toBe(LIGHT.cardBg.toLowerCase());
    expect(got.border).toBe(LIGHT.border.toLowerCase());
    expect(got.fieldBg).toBe(LIGHT.fieldBg.toLowerCase());
    expect(got.fieldText).toBe(LIGHT.text.toLowerCase());
  });

  it("深色模式：5 项与镜像逐字相同，且每一项都与浅色模式**不同**", () => {
    const light = extract(renderToStaticMarkup(<InviteCodesPage darkMode={false} language="en" />));
    const dark = extract(renderToStaticMarkup(<InviteCodesPage darkMode={true} language="en" />));
    expect(dark.text).toBe(DARK.text.toLowerCase());
    expect(dark.muted).toBe(DARK.muted.toLowerCase());
    expect(dark.cardBg).toBe(DARK.cardBg.toLowerCase());
    expect(dark.border).toBe(DARK.border.toLowerCase());
    expect(dark.fieldBg).toBe(DARK.fieldBg.toLowerCase());
    expect(dark.fieldText).toBe(DARK.text.toLowerCase());
    // 注记 10：darkMode 不许是被解构了却一次都没用的装饰性参数
    for (const k of ["text", "muted", "cardBg", "border", "fieldBg"]) {
      expect(dark[k], `${k} 在两种配色模式下必须有区别`).not.toBe(light[k]);
    }
  });

  it("UsersPage 的镜像同样对得上（两个组件的 palette 口径必须一致）", () => {
    for (const [darkMode, p] of [[false, LIGHT], [true, DARK]]) {
      const html = renderToStaticMarkup(<UsersPage darkMode={darkMode} language="en" />);
      expect(colorOf(styleOf(/<h3 style="([^"]*)"/, html)), `darkMode=${darkMode} 标题色`).toBe(p.text.toLowerCase());
      expect(colorOf(styleOf(/<p style="([^"]*)"/, html)), `darkMode=${darkMode} 空态色`).toBe(p.muted.toLowerCase());
    }
  });

  it("🔴 注记 11：<code> 与每个文本节点都显式带 color，不靠继承", () => {
    // ConfigurationPage 的 return 根 div 不设 color，所以不设 color 的文字会一路继承到
    // src/index.css:7 的 rgba(255,255,255,0.87) 与 :37 的 @media (prefers-color-scheme: light)
    // —— 即跟随**操作系统**的配色偏好，而不是 App 自己的 darkMode 开关。两者不一致时实测
    // 会出现白字落在白卡上（对比度 1.0000）。这是仓级预存坑，7b 是第一个踩到它的新页面。
    for (const p of [LIGHT, DARK]) {
      const code = normalizeStyle(styleOf(CODE_STYLE, renderInviteRow(INVITE, { p })));
      expect(code, `<code> 必须显式设 color（darkMode=${p === DARK}）`).toContain(`color:${p.text.toLowerCase()}`);

      const user = renderUserRow(USER_ROW, { p });
      expect(user).toContain(`color:${p.text.toLowerCase()}`);
      expect(user).toContain(`color:${p.muted.toLowerCase()}`);
    }
  });

  it("🔴 注记 11 的负对照：<code> 不设 color 时确实什么都拿不到（说明上面那条不是恒真）", () => {
    const bare = renderToStaticMarkup(<code style={{ fontWeight: 700 }}>TEST01</code>);
    expect(bare).not.toContain("color:");
    expect(colorOf(/<code style="([^"]*)"/.exec(bare)[1])).toBe("");
  });
});

// =====================================================================================
// i) 配色契约 —— token 之间的**比例**，不抄字面值
// =====================================================================================
// 为什么需要单独一组 token 级断言：上面 d 组取的是**渲染出来的**颜色（这对组件层的变异
// 有效），但如果有人直接改 theme.js 里的 token，组件层断言会跟着一起「变绿地漂移」。
// 这一组断言的是 token 之间的关系 —— 调 token 会红，调组件不会。
describe("配色契约 — WCAG AA 4.5:1", () => {
  it("算法自检：三个已发表参考值必须先对得上", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21.0, 3);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.5422, 3);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.4781, 3);
    // 3 位 hex 展开必须与 6 位等价（theme.js 里两种写法都有：text.secondary 是 "#555"）
    expect(contrastRatio("#555", "#f0f0f0")).toBeCloseTo(contrastRatio("#555555", "#f0f0f0"), 6);
  });

  it("两种配色模式 × 两种行底色 × 两级文字，8 个组合全过 4.5:1", () => {
    // 实测：浅 #555/#fff=7.4552、#555/#f0f0f0=6.5419、#111/#fff=18.8831、#111/#f0f0f0=16.5697
    //       暗 #888/#1c1f2b=4.6272、#888/#0f1117=5.3232、#e8e8e8/#1c1f2b=13.3872、
    //          #e8e8e8/#0f1117=15.4009
    // ⚠️ #888 on #1c1f2b 只有 4.6272，是 8 个里最紧的一个。要把 muted 调浅、或把 cardDark
    // 调亮，先重算这条再改。
    for (const p of [LIGHT, DARK]) {
      for (const bg of [p.cardBg, p.inactiveBg]) {
        expect(contrastRatio(p.muted, bg), `muted ${p.muted} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(p.text, bg), `text ${p.text} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("按钮与徽标的填充色那几对也过 4.5:1", () => {
    expect(contrastRatio("#fff", COLORS.status.error)).toBeGreaterThanOrEqual(4.5);   // 停用/降级按钮，5.8865
    expect(contrastRatio("#fff", COLORS.primary)).toBeGreaterThanOrEqual(4.5);        // 启用/新建/admin 徽标，6.5375
    expect(contrastRatio("#c00", "#fff0f0")).toBeGreaterThanOrEqual(4.5);             // NOTICE_ERROR，5.3187
    expect(contrastRatio(COLORS.text.secondary, COLORS.background.disabled)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(COLORS.text.primary, COLORS.background.card)).toBeGreaterThanOrEqual(4.5);
  });

  it("🔴 被否掉的替代方案确实不达标（说明上面几条不是恒真的）", () => {
    // 若把错误提示改成「透明底 + #c00 字」，暗色卡上只有 2.7865 —— 这就是 NOTICE_ERROR
    // 坚持自带浅底、且两种配色模式同值的原因。
    expect(contrastRatio("#c00", COLORS.background.cardDark)).toBeLessThan(4.5);
    // 同理：brief 样例里那个 opacity 0.5 的效果，等价于把文字与底色各半混合，
    // 浅色卡上 #555 会从 7.4552 掉到 2.3231。
    const blend = (fg, bg) => {
      const ex = (s) => (s.length === 3 ? s.split("").map((c) => c + c).join("") : s);
      const F = ex(fg.replace("#", ""));
      const B = ex(bg.replace("#", ""));
      return "#" + [0, 2, 4].map((i) =>
        Math.round(0.5 * parseInt(F.slice(i, i + 2), 16) + 0.5 * parseInt(B.slice(i, i + 2), 16))
          .toString(16).padStart(2, "0")).join("");
    };
    expect(blend("#555", "#fff")).toBe("#aaaaaa");
    expect(contrastRatio(blend("#555", "#fff"), "#fff")).toBeLessThan(4.5);
    expect(contrastRatio(blend("#555", "#fff"), "#fff")).toBeCloseTo(2.3231, 3);
  });

  // 🔴 刻意**不**断言「失效行底色 vs 生效行底色 ≥ 3:1」：浅色下实测只有 1.1396、暗色下
  // 1.1504，都远低于 WCAG 1.4.11 对非文本对比度的 3:1 下限。这不是疏漏，是取舍：
  //   · 底色在这里只是**辅助**通道。承重通道是 d 组钉住的那个显式文字徽标
  //     （Active / Deactivated、生效中 / 已停用）—— 灰度打印、色盲、读屏软件都拿得到它，
  //     而且它自己还带 5.3187 的文字对比度。
  //   · 要把底色提到 3:1 就必须显著压暗/压亮失效行，而那会同时压掉上面那条 muted 对比
  //     （#555 on #f0f0f0 = 6.5419 已经不算宽裕）。两个目标互相打架，选择保住文字可读性。
  //   · 与 frontend.test.jsx 末尾「A4 禁用态配色契约」里那条 inactive 豁免同理
  //     （WCAG 1.4.3 / 1.4.11 对 inactive 控件豁免）。别当缺陷「顺手修」。
});
