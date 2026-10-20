import { useState, useEffect } from "react";
import { i18n } from "../constants/i18n";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";

// 情报页视角开关与管理条（Task 11 / M3，对齐 VIEW-4/5/6/8）。
// 刻意做成**纯展示组件**：数据与动作全部走 props（views/activeViewId/drift/on*），
// 数据加载与筛选应用由 App 负责 —— 这样 renderToStaticMarkup 能直接观察
// 「列表渲染 / 激活态 / 偏离提示 / 错误态」，不依赖 effect。
// 唯一的内部状态是表单开合与「忽略本次偏离」这类纯 UI 瞬态。

function palette(darkMode) {
  return {
    text: darkMode ? "#e8e8e8" : COLORS.text.primary,
    muted: darkMode ? "#888" : COLORS.text.secondary,
    cardBg: darkMode ? COLORS.background.cardDark : COLORS.background.card,
    border: darkMode ? COLORS.border.dark : COLORS.border.light,
    fieldBg: darkMode ? "#141722" : COLORS.background.card
  };
}

const BTN = {
  padding: "5px 12px",
  borderRadius: BORDER_RADIUS.sm,
  fontSize: FONT_SIZES.sm,
  fontWeight: 600,
  cursor: "pointer"
};

export default function ViewsBar({
  darkMode, language,
  views, activeViewId, drift,
  onSelect, onSave, onUpdateCurrent, onDelete, onSetDefault
}) {
  const t = i18n[language];
  const p = palette(darkMode);
  const zh = language === "zh";

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ignoredDrift, setIgnoredDrift] = useState(false);

  const activeView = (views || []).find((v) => v.id === activeViewId) || null;
  // 偏离消失后（用户点了「更新视角」或手动改回）自动恢复提示能力
  useEffect(() => { if (!drift) setIgnoredDrift(false); }, [drift]);

  const showDriftBar = Boolean(activeView && drift && !ignoredDrift);

  const handleSelect = (e) => {
    const id = e.target.value;
    if (id === "") return onSelect(null);
    const view = views.find((v) => String(v.id) === id);
    if (view) onSelect(view);
  };

  const handleSave = async () => {
    const name = saveName.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    const r = await onSave(name);
    setBusy(false);
    if (r && r.ok === false) {
      // 超限等错误：后端 400 "view limit reached (10)"，直接显示服务端文案
      setError(r.error || "");
      return;
    }
    setSaveOpen(false);
    setSaveName("");
  };

  const handleUpdate = async () => {
    setBusy(true);
    setError("");
    try { await onUpdateCurrent(); setIgnoredDrift(true); }
    catch (e) { setError(e?.message || ""); }
    finally { setBusy(false); }
  };

  return (
    <div style={{
      background: p.cardBg, border: `1px solid ${p.border}`, borderRadius: BORDER_RADIUS.md,
      padding: "10px 14px", marginBottom: 12,
      display: "flex", flexDirection: "column", gap: 10
    }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: FONT_SIZES.sm, fontWeight: 600, color: p.text }}>{t.views.toggleLabel}</span>

        {/* 开关：开 = 启用视角（列表非空时启用第一个）；关 = 回公共池（VIEW-4） */}
        <button
          role="switch"
          aria-checked={Boolean(activeView)}
          onClick={() => {
            if (activeView) return onSelect(null);
            const first = (views || [])[0];
            if (first) onSelect(first);
          }}
          disabled={!activeView && (views || []).length === 0}
          style={{
            width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
            background: activeView ? COLORS.primary : p.border,
            position: "relative", transition: `background ${TRANSITIONS.fast}`
          }}
          aria-label={t.views.toggleLabel}
        >
          <span style={{
            position: "absolute", top: 3, left: activeView ? 21 : 3,
            width: 16, height: 16, borderRadius: "50%", background: "#fff",
            transition: `left ${TRANSITIONS.fast}`
          }} />
        </button>

        <select
          value={activeView ? String(activeView.id) : ""}
          onChange={handleSelect}
          aria-label={t.views.myViews}
          style={{
            padding: "6px 10px", borderRadius: BORDER_RADIUS.sm,
            border: `1px solid ${p.border}`, background: p.fieldBg, color: p.text,
            fontSize: FONT_SIZES.sm, outline: "none", maxWidth: 260
          }}
        >
          <option value="">{t.views.backToPublic}</option>
          {(views || []).map((v) => (
            <option key={v.id} value={String(v.id)}>
              {v.name}{v.is_default ? " ★" : ""}
            </option>
          ))}
        </select>

        <button onClick={() => setSaveOpen(!saveOpen)} style={{ ...BTN, border: `1px solid ${p.border}`, background: "transparent", color: p.text }}>
          {t.views.saveAsView}
        </button>

        {activeView && (
          <>
            <span style={{ fontSize: FONT_SIZES.sm, color: p.muted }}>{activeView.name}</span>
            <button onClick={async () => { setError(""); try { await onSetDefault(activeView); } catch (e) { setError(e?.message || ""); } }}
              style={{ ...BTN, border: `1px solid ${p.border}`, background: "transparent", color: p.text }}>
              {t.views.setDefault}
            </button>
            <button onClick={async () => { if (!confirm(zh ? "删除该视角？" : "Delete this view?")) return; setError(""); try { await onDelete(activeView); } catch (e) { setError(e?.message || ""); } }}
              style={{ ...BTN, border: "1px solid #c00", background: "transparent", color: "#c00" }}>
              {t.views.deleteView}
            </button>
          </>
        )}
      </div>

      {saveOpen && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder={zh ? "视角名称" : "View name"}
            aria-label={zh ? "视角名称" : "View name"}
            style={{
              padding: "6px 10px", borderRadius: BORDER_RADIUS.sm,
              border: `1px solid ${p.border}`, background: p.fieldBg, color: p.text,
              fontSize: FONT_SIZES.sm, outline: "none"
            }}
          />
          <button onClick={handleSave} disabled={busy || !saveName.trim()} style={{ ...BTN, border: "none", background: COLORS.primary, color: "#fff" }}>
            {zh ? "保存" : "Save"}
          </button>
          <button onClick={() => { setSaveOpen(false); setError(""); }} style={{ ...BTN, border: `1px solid ${p.border}`, background: "transparent", color: p.text }}>
            {zh ? "取消" : "Cancel"}
          </button>
        </div>
      )}

      {showDriftBar && (
        <div style={{
          display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
          padding: "8px 12px", borderRadius: BORDER_RADIUS.sm,
          background: darkMode ? "#2a2d3a" : "#fff8e1",
          border: `1px solid ${darkMode ? COLORS.border.dark : "#f5c518"}`
        }}>
          <span style={{ fontSize: FONT_SIZES.sm, color: p.text, flex: 1, minWidth: 200 }}>{t.views.driftHint}</span>
          <button onClick={handleUpdate} disabled={busy} style={{ ...BTN, border: "none", background: COLORS.primary, color: "#fff" }}>
            {t.views.updateView}
          </button>
          <button onClick={() => setIgnoredDrift(true)} style={{ ...BTN, border: `1px solid ${p.border}`, background: "transparent", color: p.text }}>
            {zh ? "忽略" : "Ignore"}
          </button>
        </div>
      )}

      {error && (
        <p style={{ margin: 0, fontSize: FONT_SIZES.sm, color: "#c00" }} role="alert">{error}</p>
      )}
    </div>
  );
}
