import { useEffect, useState } from "react";
import { backendApi } from "../../utils/backendApi";
import { COLORS, FONT_SIZES, BORDER_RADIUS } from "../../constants/theme";
import { i18n } from "../../constants/i18n";

// ADM-1：用户列表 + 角色变更 + 启用/停用。
//
// 🔴 这里的角色门禁**不是安全边界**：整个 /api/admin 前缀在服务端已经 requireAdmin，
// 前端这一层只是省掉几个必然 403 的请求和一堆 console 噪音。真正的边界在
// server/apiRoutes.js 与 server/lib/authMiddleware.js。
//
// 结构上刻意分成三层，因为 renderToStaticMarkup **不执行 useEffect**：
//   UsersPage（状态 + effect + handler，静态渲染只能看到空态）
//     └ UsersList（err / 空 / 行列表的分支，纯 props，可静态观察）
//         └ UserRow（单行，纯 props，可静态观察）
// 把有意思的判定放在下面两层，它们才有观察者。测试见 adminPages.test.jsx。

// 配色。🔴 每一个文本节点都必须显式带 color：ConfigurationPage 的 return 根 div 不设 color，
// 继承链会一路走到 src/index.css:7 的 `color: rgba(255,255,255,0.87)` 与 :37 的
// `@media (prefers-color-scheme: light)` → 跟随**操作系统**的配色偏好，而不是 App 自己的
// darkMode 开关。两者不一致时实测会出现白字落在白卡上（对比度 1.0000）。这是仓级预存坑，
// 本组件是第一个会踩到它的新页面，所以在这里逐节点显式设色。
function palette(darkMode) {
  return {
    text: darkMode ? "#e8e8e8" : COLORS.text.primary,
    muted: darkMode ? "#888" : COLORS.text.secondary,
    cardBg: darkMode ? COLORS.background.cardDark : COLORS.background.card,
    // 失效行的底色：浅色模式用 background.disabled(#f0f0f0)，深色模式用 background.dark
    // (#0f1117)，都比各自的卡片底更「沉」，读作「退到后面去了」。
    // 🔴 刻意不用 opacity —— 用透明度表达失效态会把**文字**一起冲淡（Task 7 Round 3 的 A4
    // 就是这个缺陷）。实测浅色卡上 #555 说明文字 7.4552 → 2.3231、暗色卡上 1.4475，
    // 全部掉到 WCAG AA 正文下限 4.5 以下。
    inactiveBg: darkMode ? COLORS.background.dark : COLORS.background.disabled,
    border: darkMode ? COLORS.border.dark : COLORS.border.light
  };
}

// 错误提示沿用仓里既有的写法（ConfigurationPage.jsx 的 configMessage 块）：浅色底 + 深红字，
// 两种配色模式下同一套值。#c00 on #fff0f0 实测 5.60:1 ≥ 4.5，且**不随 darkMode 变化**，
// 所以不需要暗色分支；如果改成透明底 + #c00 字，暗色下 #c00 on #1c1f2b 只有 2.79:1。
const NOTICE_ERROR = {
  background: "#fff0f0",
  border: "1px solid #fcc",
  color: "#c00"
};

// 注册来源邀请码：users.invited_by_code_id 是**整数 id**，不是码文本（023_users_auth.sql:10），
// 而 PRD 的 ADM-1 要求显示「注册来源邀请码」，所以只能在前端拿 getInviteCodes() 的列表做一次
// id → code 的 join。三种情况都必须有明确回落，绝不能渲染出 undefined：
//   · id 为 null        → 「无」（ADMIN_UNIONID seed 出来的管理员、或早于邀请码机制的账号）
//   · 列表还没加载完     → 只显示 #id，不谎称「码已不存在」
//   · 列表里找不到该 id  → 「码已不存在 #id」（码不会物理删除，但历史上可能被删过）
function invitedByLabel(u, codes, codesLoaded, t) {
  const id = u.invited_by_code_id;
  if (id == null) return t.admin.invitedByNone;
  if (!codesLoaded) return `#${id}`;
  const hit = codes.find((c) => c.id === id);
  return hit ? hit.code : `${t.admin.invitedByMissing} #${id}`;
}

// created_at / last_login_at 由 SQL 的 CURRENT_TIMESTAMP 落库，是 **UTC** 的
// 'YYYY-MM-DD HH:MM:SS'。这里只截到分钟显示，完整原值放进 title 供 hover 核对。
// 🔴 不做时区换算：换算需要浏览器时区，而本仓其余时间戳展示也是原样显示 UTC 串，
// 在这里单独换算会让同一个时间在两个页面差 8 小时。
function timestampCell(raw, t) {
  if (raw == null || raw === "") return { text: t.admin.never, title: "" };
  const s = String(raw);
  return { text: s.slice(0, 16), title: `${s} UTC` };
}

const BTN = {
  padding: "6px 12px",
  borderRadius: BORDER_RADIUS.sm,
  fontSize: FONT_SIZES.sm,
  fontWeight: 600,
  cursor: "pointer"
};

export function UserRow({ u, codes, codesLoaded, t, p, onPatch }) {
  const disabled = u.status === "disabled";
  const isAdmin = u.role === "admin";
  // 超管护锁（产品负责人 2026-10-21）：后端 PATCH 会 400，前端不渲染按钮并给徽标。
  const locked = u.locked === true;
  // resource_counts 是服务端内嵌的只读计数（admin.js:37-41），reports/templates 那两项在
  // Task 8 的 024 迁移之前会因 "no such column" 降级成 **null**（不是缺失）。
  // 所以这里必须用 ?? 0：?. 只能挡住「整个对象缺失」，挡不住「键在但值是 null」。
  const counts = u.resource_counts || {};
  const registered = timestampCell(u.created_at, t);
  const lastLogin = timestampCell(u.last_login_at, t);

  return (
    <div style={{
      padding: 14, borderRadius: BORDER_RADIUS.md,
      background: disabled ? p.inactiveBg : p.cardBg,
      border: `1px solid ${p.border}`,
      display: "flex", flexDirection: "column", gap: 8
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600, fontSize: FONT_SIZES.base, color: p.text }}>
          {u.nickname || u.unionid || `#${u.id}`}
        </span>
        <span style={{
          padding: "2px 8px", borderRadius: BORDER_RADIUS.sm, fontSize: FONT_SIZES.xs, fontWeight: 600,
          background: isAdmin ? COLORS.primary : "transparent",
          color: isAdmin ? "#fff" : p.muted,
          border: isAdmin ? "none" : `1px solid ${p.border}`
        }}>{isAdmin ? t.admin.roleAdmin : t.admin.roleUser}</span>
        {locked && (
          <span style={{
            padding: "2px 8px", borderRadius: BORDER_RADIUS.sm, fontSize: FONT_SIZES.xs, fontWeight: 600,
            background: "rgba(245,197,24,0.15)",
            border: `1px solid ${COLORS.status.warning}`,
            color: COLORS.status.warning
          }}>{t.admin.superAdminBadge}</span>
        )}
        {disabled && (
          <span style={{
            padding: "2px 8px", borderRadius: BORDER_RADIUS.sm, fontSize: FONT_SIZES.xs, fontWeight: 600,
            ...NOTICE_ERROR
          }}>{t.admin.statusDisabled}</span>
        )}
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: FONT_SIZES.sm, color: p.muted }}>
        <span title={registered.title}>{t.admin.colRegistered}: {registered.text}</span>
        <span title={lastLogin.title}>{t.admin.colLastLogin}: {lastLogin.text}</span>
        <span>{t.admin.colInvitedBy}: {invitedByLabel(u, codes, codesLoaded, t)}</span>
      </div>

      <div style={{ fontSize: FONT_SIZES.sm, color: p.muted }}>
        {t.admin.colResources}: {counts.reports ?? 0} {t.admin.countReports}
        {" · "}
        {counts.templates ?? 0} {t.admin.countTemplates}
        {" · "}
        {counts.views ?? 0} {t.admin.countViews}
      </div>

      {!locked && (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => onPatch(u.id, { role: isAdmin ? "user" : "admin" })}
          style={{
            ...BTN,
            background: "transparent",
            border: `1px solid ${p.border}`,
            color: p.text
          }}
        >{isAdmin ? t.admin.actionMakeUser : t.admin.actionMakeAdmin}</button>
        <button
          onClick={() => onPatch(u.id, { status: disabled ? "active" : "disabled" })}
          style={{
            ...BTN,
            border: "none",
            color: "#fff",
            background: disabled ? COLORS.primary : COLORS.status.error
          }}
        >{disabled ? t.admin.actionEnable : t.admin.actionDisable}</button>
      </div>
      )}
    </div>
  );
}

export function UsersList({ users, codes, codesLoaded, err, t, p, onPatch }) {
  if (err) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ ...NOTICE_ERROR, margin: 0, padding: "10px 16px", borderRadius: BORDER_RADIUS.md, fontSize: FONT_SIZES.sm }}>
          {err}
        </p>
        {users.map((u) => (
          <UserRow key={u.id} u={u} codes={codes} codesLoaded={codesLoaded} t={t} p={p} onPatch={onPatch} />
        ))}
      </div>
    );
  }
  if (!users.length) {
    return <p style={{ margin: 0, fontSize: FONT_SIZES.sm, color: p.muted }}>{t.admin.usersEmpty}</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {users.map((u) => (
        <UserRow key={u.id} u={u} codes={codes} codesLoaded={codesLoaded} t={t} p={p} onPatch={onPatch} />
      ))}
    </div>
  );
}

export default function UsersPage({ darkMode, language }) {
  const t = i18n[language];
  const p = palette(darkMode);
  const [users, setUsers] = useState([]);
  const [codes, setCodes] = useState([]);
  const [codesLoaded, setCodesLoaded] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    // 🔴 这里刻意不引用 t（i18n）：引用了就会让 react-hooks/exhaustive-deps 要求把
    // t.admin.loadFailed 放进依赖数组，而本 effect 的语义是「只在挂载时拉一次」，
    // 加进去等于撒谎。安全的前提是 backendApi.request() 保证 message 非空 ——
    // 它抛的是 `new Error(error.error || \`HTTP ${status}\`)`，网络层失败也有
    // "Failed to fetch"，所以 `|| t.admin.loadFailed` 这个兜底在 effect 里本来就是死分支。
    // 事件处理器（patch 等）不受这条 lint 约束，那里保留兜底。
    backendApi.getAdminUsers()
      .then((r) => { if (!cancelled) setUsers(r.data || []); })
      .catch((e) => { if (!cancelled) setErr(e?.message || ""); });
    // 邀请码列表只为了把 invited_by_code_id 这个整数 id 翻成码文本。它失败不该拖垮整页：
    // invitedByLabel 在 codesLoaded=false 时退化成显示 #id，仍然是真话。
    backendApi.getInviteCodes()
      .then((r) => { if (!cancelled) { setCodes(r.data || []); setCodesLoaded(true); } })
      .catch(() => { if (!cancelled) setCodesLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const patch = async (id, body) => {
    setErr("");
    try {
      await backendApi.patchAdminUser(id, body);
      const r = await backendApi.getAdminUsers();
      setUsers(r.data || []);
    } catch (e) {
      // 409「cannot demote or disable the last active admin」会走这里，服务端给的文案直接显示。
      setErr(e.message || t.admin.loadFailed);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0, fontSize: FONT_SIZES.xl, fontWeight: 700, color: p.text }}>
        {t.admin.usersTitle}
      </h3>
      <UsersList users={users} codes={codes} codesLoaded={codesLoaded} err={err} t={t} p={p} onPatch={patch} />
    </div>
  );
}
