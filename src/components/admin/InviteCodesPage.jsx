import { useEffect, useState } from "react";
import { backendApi, buildInvitePayload } from "../../utils/backendApi";
import { COLORS, FONT_SIZES, BORDER_RADIUS } from "../../constants/theme";
import { i18n } from "../../constants/i18n";

// ADM-2：邀请码的创建 / 停用 / 使用记录。
//
// 🔴 与 UsersPage 同样的两点：角色门禁**不是**安全边界（服务端 /api/admin 整前缀 requireAdmin），
// 且每一个文本节点都显式设 color（继承链会走到 src/index.css 的 prefers-color-scheme，
// 跟随操作系统而不是 App 的 darkMode 开关）。
//
// 分层同样是为了可观察性：renderToStaticMarkup 不执行 useEffect，所以把判定放在
// InviteForm / InviteList / InviteRow / UsagesPanel 这些纯 props 组件里。

function palette(darkMode) {
  return {
    text: darkMode ? "#e8e8e8" : COLORS.text.primary,
    muted: darkMode ? "#888" : COLORS.text.secondary,
    cardBg: darkMode ? COLORS.background.cardDark : COLORS.background.card,
    // 失效行的底色。🔴 不用 opacity 表达失效态：透明度会把**文字**一起冲淡，
    // 实测浅色卡上 #555 说明文字 7.4552 → 2.3231、`<code>` 18.8831 → 3.5449，
    // 暗色卡上更是 1.4475 / 1.0796，全部低于 WCAG AA 正文下限 4.5。
    // 文字颜色在生效/失效两态**完全相同**，失效只由「更沉的底色 + 已停用徽标 + 没有停用按钮」表达。
    inactiveBg: darkMode ? COLORS.background.dark : COLORS.background.disabled,
    border: darkMode ? COLORS.border.dark : COLORS.border.light,
    // 输入框底色：深色下不能用白底（#fff 落在 #1c1f2b 卡片里会刺眼，且 #111 字与页面语义相反）
    fieldBg: darkMode ? "#141722" : COLORS.background.card
  };
}

// 与 UsersPage.jsx 里那份**逐字相同**。刻意重复而不是抽到 theme.js：theme.js 不在本轮
// allow-list 内，而从一个组件文件 export 非组件常量会触发 react-refresh/only-export-components
// 警告（实测：混合导出的文件里，小写开头的函数/对象导出都会 warn，而 lint 带 --max-warnings 0）。
const NOTICE_ERROR = {
  background: "#fff0f0",
  border: "1px solid #fcc",
  color: "#c00"
};

const BTN = {
  padding: "6px 12px",
  borderRadius: BORDER_RADIUS.sm,
  fontSize: FONT_SIZES.sm,
  fontWeight: 600,
  cursor: "pointer"
};

// 🔴 不导出：react-refresh/only-export-components 对「混合导出」的文件里任何**对象/数组**
// 常量都会 warn（大写命名也救不了 —— 实测 `export const UPPER_OBJ = {}` 照样 warn，
// 只有大写开头的**函数**和小写的字符串/数字字面量放过），而 lint 带 --max-warnings 0。
// 本文件要导出 InviteForm/InviteRow/InviteList/UsagesPanel 四个组件，所以这里只能私有。
const EMPTY_FORM = { code: "", label: "", role: "user", max_uses: "", expires_at: "", note: "", default_view: "" };

export function InviteForm({ form, onChange, err, t, p, onCreate }) {
  const field = {
    padding: "8px 10px",
    borderRadius: BORDER_RADIUS.sm,
    border: `1px solid ${p.border}`,
    background: p.fieldBg,
    color: p.text,
    fontSize: FONT_SIZES.md,
    outline: "none",
    boxSizing: "border-box"
  };
  const label = { fontSize: FONT_SIZES.sm, color: p.muted, display: "block", marginBottom: 4 };
  // 🔴 每个受控输入都必须带 onChange：React 对「有 value 无 onChange」的字段会 console.error，
  // 那会往全量测试输出里新增 stderr 块（本仓的硬指标是停在 12 块）。
  const set = (k) => (e) => onChange({ ...form, [k]: e.target.value });

  return (
    <div style={{
      padding: 16, borderRadius: BORDER_RADIUS.md,
      background: p.cardBg, border: `1px solid ${p.border}`,
      display: "flex", flexDirection: "column", gap: 12
    }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 160px" }}>
          <span style={label}>{t.admin.fieldCode}</span>
          <input style={{ ...field, width: "100%" }} value={form.code} onChange={set("code")}
            placeholder={t.admin.fieldCodePlaceholder} />
        </div>
        <div style={{ flex: "2 1 220px" }}>
          <span style={label}>{t.admin.fieldLabel}</span>
          <input style={{ ...field, width: "100%" }} value={form.label} onChange={set("label")}
            placeholder={t.admin.fieldLabelPlaceholder} />
        </div>
        <div style={{ flex: "0 1 130px" }}>
          <span style={label}>{t.admin.fieldRole}</span>
          <select style={{ ...field, width: "100%" }} value={form.role} onChange={set("role")}>
            <option value="user">{t.admin.roleUser}</option>
            <option value="admin">{t.admin.roleAdmin}</option>
          </select>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "0 1 130px" }}>
          <span style={label}>{t.admin.fieldMaxUses}</span>
          <input style={{ ...field, width: "100%" }} value={form.max_uses} onChange={set("max_uses")}
            placeholder={t.admin.fieldMaxUsesPlaceholder} inputMode="numeric" />
          <span style={{ ...label, marginTop: 4, marginBottom: 0 }}>{t.admin.maxUsesHint}</span>
        </div>
        <div style={{ flex: "0 1 170px" }}>
          <span style={label}>{t.admin.fieldExpires}</span>
          <input style={{ ...field, width: "100%" }} type="date" value={form.expires_at} onChange={set("expires_at")} />
          {/* 🔴 控制器注记 2 的裁定必须在 UI 上可见：送出去的串补了 T23:59:59，
              所以「到期日当天全天可用」。不写这句，管理员会以为当天 00:00 就失效。 */}
          <span style={{ ...label, marginTop: 4, marginBottom: 0 }}>{t.admin.expiresHint}</span>
        </div>
        <div style={{ flex: "2 1 220px" }}>
          <span style={label}>{t.admin.fieldNote}</span>
          <input style={{ ...field, width: "100%" }} value={form.note} onChange={set("note")} />
        </div>
      </div>

      <div>
        <span style={label}>{t.admin.fieldDefaultView}</span>
        <textarea style={{ ...field, width: "100%", minHeight: 60, fontFamily: "monospace" }}
          value={form.default_view} onChange={set("default_view")}
          placeholder={t.admin.fieldDefaultViewPlaceholder} />
      </div>

      {err && (
        <p style={{
          ...NOTICE_ERROR, margin: 0, padding: "10px 16px",
          borderRadius: BORDER_RADIUS.md, fontSize: FONT_SIZES.sm
        }}>{err}</p>
      )}

      <div>
        <button onClick={onCreate} style={{ ...BTN, border: "none", background: COLORS.primary, color: "#fff", padding: "9px 18px" }}>
          {t.admin.actionCreate}
        </button>
      </div>
    </div>
  );
}

export function UsagesPanel({ rows, t, p }) {
  return (
    <div style={{
      padding: 12, borderRadius: BORDER_RADIUS.sm,
      background: p.cardBg, border: `1px solid ${p.border}`,
      display: "flex", flexDirection: "column", gap: 6
    }}>
      <span style={{ fontSize: FONT_SIZES.sm, fontWeight: 600, color: p.text }}>{t.admin.usagesTitle}</span>
      {!rows.length && (
        <span style={{ fontSize: FONT_SIZES.sm, color: p.muted }}>{t.admin.usagesEmpty}</span>
      )}
      {rows.map((r) => (
        <span key={r.id} style={{ fontSize: FONT_SIZES.sm, color: p.muted }}>
          {r.nickname || r.unionid || `#${r.id}`}
          {r.created_at ? ` · ${String(r.created_at).slice(0, 16)}` : ""}
        </span>
      ))}
    </div>
  );
}

export function InviteRow({ c, t, p, onToggleActive, onToggleUsages, usagesOpen, usages }) {
  // active 在库里是 INTEGER NOT NULL DEFAULT 1（023_users_auth.sql:24），只会是 0 或 1。
  // 用严格 === 1：字段缺失/异常时落到「已停用」那一侧，宁可显示得保守，也不要让一张
  // 其实已停用的码看起来还活着。
  const active = c.active === 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{
        padding: 12, borderRadius: BORDER_RADIUS.md,
        // 🔴 生效/失效唯一的底色差异在这里。文字颜色一律用 p.text / p.muted，与状态无关。
        background: active ? p.cardBg : p.inactiveBg,
        border: `1px solid ${p.border}`,
        display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap"
      }}>
        {/* <code> 必须显式设 color：不设的话继承到 index.css 的 prefers-color-scheme，
            OS 暗 + App 浅时实测是白字落在白卡上（对比度 1.0000，完全看不见）。 */}
        <code style={{ fontWeight: 700, fontSize: FONT_SIZES.base, color: p.text, fontFamily: "monospace" }}>{c.code}</code>

        <span style={{
          padding: "2px 8px", borderRadius: BORDER_RADIUS.sm, fontSize: FONT_SIZES.xs, fontWeight: 600,
          background: c.role === "admin" ? COLORS.primary : "transparent",
          color: c.role === "admin" ? "#fff" : p.muted,
          border: c.role === "admin" ? "none" : `1px solid ${p.border}`
        }}>{c.role === "admin" ? t.admin.roleAdmin : t.admin.roleUser}</span>

        {/* 失效态的**主**通道：显式文字徽标。灰度打印、色盲、读屏软件都能拿到它。 */}
        <span style={{
          padding: "2px 8px", borderRadius: BORDER_RADIUS.sm, fontSize: FONT_SIZES.xs, fontWeight: 600,
          ...(active ? { background: "transparent", border: `1px solid ${p.border}`, color: p.muted } : NOTICE_ERROR)
        }}>{active ? t.admin.badgeActive : t.admin.badgeInactive}</span>

        <span style={{ fontSize: FONT_SIZES.sm, color: p.muted }}>
          {c.label ? `${c.label} · ` : ""}
          {c.used_count ?? 0} / {c.max_uses == null ? t.admin.unlimited : c.max_uses}
          {" · "}
          {c.expires_at ? `${t.admin.expiresLabel} ${String(c.expires_at).slice(0, 10)}` : t.admin.neverExpires}
          {c.note ? ` · ${c.note}` : ""}
        </span>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => onToggleUsages(c.id)} style={{ ...BTN, background: "transparent", border: `1px solid ${p.border}`, color: p.text }}>
            {usagesOpen ? t.admin.actionUsagesHide : t.admin.actionUsages}
          </button>
          <button
            onClick={() => onToggleActive(c.id, active)}
            style={{
              ...BTN, border: "none", color: "#fff",
              background: active ? COLORS.status.error : COLORS.primary
            }}
          >{active ? t.admin.actionDeactivate : t.admin.actionReactivate}</button>
        </div>
      </div>
      {usagesOpen && <UsagesPanel rows={usages || []} t={t} p={p} />}
    </div>
  );
}

export function InviteList({ codes, t, p, onToggleActive, onToggleUsages, usagesFor, usages }) {
  if (!codes.length) {
    return <p style={{ margin: 0, fontSize: FONT_SIZES.sm, color: p.muted }}>{t.admin.invitesEmpty}</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {codes.map((c) => (
        <InviteRow key={c.id} c={c} t={t} p={p}
          onToggleActive={onToggleActive} onToggleUsages={onToggleUsages}
          usagesOpen={usagesFor === c.id} usages={usagesFor === c.id ? usages : []} />
      ))}
    </div>
  );
}

export default function InviteCodesPage({ darkMode, language }) {
  const t = i18n[language];
  const p = palette(darkMode);
  const [codes, setCodes] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [err, setErr] = useState("");
  const [usagesFor, setUsagesFor] = useState(null);
  const [usages, setUsages] = useState([]);

  const load = () => backendApi.getInviteCodes().then((r) => setCodes(r.data || []));

  useEffect(() => {
    let cancelled = false;
    // 不在 effect 里引用 t，理由与 UsersPage.jsx 同（react-hooks/exhaustive-deps 会要求把
    // t.admin.loadFailed 放进依赖数组，而这个 effect 的语义就是「只在挂载时拉一次」）。
    backendApi.getInviteCodes()
      .then((r) => { if (!cancelled) setCodes(r.data || []); })
      .catch((e) => { if (!cancelled) setErr(e?.message || ""); });
    return () => { cancelled = true; };
  }, []);

  const create = async () => {
    // 🔴 校验发生在**发请求之前**：buildInvitePayload 返回 { ok:false } 时根本不调 createInviteCode。
    // 这不是可有可无的前端礼貌 —— 服务端对 max_uses 的 fail-closed 依赖收到 NaN，
    // 而 JSON.stringify({max_uses: NaN}) 实测产出 '{"max_uses":null}'，null 在服务端正是
    // 「不限次」的合法值。详见 backendApi.js 里 buildInvitePayload 上方的注释。
    const built = buildInvitePayload(form);
    if (!built.ok) {
      setErr(t.admin[built.error] || built.error);
      return;
    }
    setErr("");
    try {
      await backendApi.createInviteCode(built.payload);
      setForm(EMPTY_FORM);
      await load();
    } catch (e) {
      setErr(e.message || t.admin.loadFailed);
    }
  };

  const toggleActive = async (id, currentlyActive) => {
    setErr("");
    try {
      await backendApi.patchInviteCode(id, { active: currentlyActive ? 0 : 1 });
      await load();
    } catch (e) {
      setErr(e.message || t.admin.loadFailed);
    }
  };

  const toggleUsages = async (id) => {
    if (usagesFor === id) { setUsagesFor(null); setUsages([]); return; }
    setErr("");
    try {
      const r = await backendApi.getInviteCodeUsages(id);
      setUsages(r.data || []);
      setUsagesFor(id);
    } catch (e) {
      setErr(e.message || t.admin.loadFailed);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0, fontSize: FONT_SIZES.xl, fontWeight: 700, color: p.text }}>
        {t.admin.invitesTitle}
      </h3>
      <InviteForm form={form} onChange={setForm} err={err} t={t} p={p} onCreate={create} />
      <InviteList codes={codes} t={t} p={p}
        onToggleActive={toggleActive} onToggleUsages={toggleUsages}
        usagesFor={usagesFor} usages={usages} />
    </div>
  );
}
