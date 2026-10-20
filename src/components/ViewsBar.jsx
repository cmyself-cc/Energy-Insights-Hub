import { useState, useEffect } from "react";
import { i18n } from "../constants/i18n";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";

// 情报页视角控件（Task 11 / M3；2026-10 按产品负责人要求定版布局）：
//   · 嵌在 FilterBar 的白色框内（经 IntelligencePage → FilterBar rightSlot 传入），
//     与「监控」同一行、框内右对齐 —— 不是框外独立条；
//   · **开关**是视角的总开关（产品负责人明确要求保留）：
//       关（公共池）：只显示 [开关] + [保存为视角]；
//       开：显示 [开关] + [下拉] + [设为默认] + [删除]；
//     开且没有激活视角时（如用户曾手动回公共池）→ 启用默认视角（无默认则第一个）；
//   · 下拉第一项「回公共池」也等于关，两个入口等价；
//   · 视角名只在下拉选中项里出现一次，不另行渲染。
// 纯展示组件：数据/动作全走 props；开关/表单开合/「忽略」里的 handler 与瞬态
// 静态渲染够不着，照实登记为盲区（浏览器冒烟覆盖）。

function palette(darkMode) {
  return {
    text: darkMode ? "#e8e8e8" : COLORS.text.primary,
    muted: darkMode ? "#888" : COLORS.text.secondary,
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
    if (id === "") return onSelect(null);   // 「回公共池」= 关
    const view = (views || []).find((v) => String(v.id) === id);
    if (view) onSelect(view);
  };

  // 开关：关 → 开 = 启用默认视角（无默认则第一个）；开 → 关 = 回公共池
  const handleToggle = () => {
    if (activeView) return onSelect(null);
    const list = views || [];
    const def = list.find((v) => v.is_default) || list[0];
    if (def) onSelect(def);
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
    // 激活由 App 的 saveViewAs 完成（它拿得到新视角 id）
  };

  const handleUpdate = async () => {
    setBusy(true);
    setError("");
    try { await onUpdateCurrent(); setIgnoredDrift(true); }
    catch (e) { setError(e?.message || ""); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
        {/* 总开关：公共池（关）时它是唯一与视角相关的控件之一 */}
        <button
          role="switch"
          aria-checked={Boolean(activeView)}
          aria-label={t.views.toggleLabel}
          onClick={handleToggle}
          disabled={!activeView && (views || []).length === 0}
          title={t.views.toggleLabel}
          style={{
            width: 40, height: 22, borderRadius: 11, border: "none",
            background: activeView ? COLORS.primary : p.border,
            cursor: "pointer", position: "relative",
            transition: `background ${TRANSITIONS.fast}`,
            flexShrink: 0
          }}
        >
          <span style={{
            position: "absolute", top: 3, left: activeView ? 21 : 3,
            width: 16, height: 16, borderRadius: "50%", background: "#fff",
            transition: `left ${TRANSITIONS.fast}`
          }} />
        </button>

        {!activeView && !saveOpen && (
          <button onClick={() => setSaveOpen(true)} style={{ ...BTN, border: `1px solid ${p.border}`, background: "transparent", color: p.text }}>
            {t.views.saveAsView}
          </button>
        )}

        {!activeView && saveOpen && (
          <>
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder={zh ? "视角名称" : "View name"}
              aria-label={zh ? "视角名称" : "View name"}
              style={{
                padding: "5px 10px", borderRadius: BORDER_RADIUS.sm,
                border: `1px solid ${p.border}`, background: p.fieldBg, color: p.text,
                fontSize: FONT_SIZES.sm, outline: "none", width: 150
              }}
            />
            <button onClick={handleSave} disabled={busy || !saveName.trim()} style={{ ...BTN, border: "none", background: COLORS.primary, color: "#fff" }}>
              {zh ? "保存" : "Save"}
            </button>
            <button onClick={() => { setSaveOpen(false); setError(""); }} style={{ ...BTN, border: `1px solid ${p.border}`, background: "transparent", color: p.text }}>
              {zh ? "取消" : "Cancel"}
            </button>
          </>
        )}

        {activeView && (
          <>
            <select
              value={String(activeView.id)}
              onChange={handleSelect}
              aria-label={t.views.myViews}
              style={{
                padding: "5px 10px", borderRadius: BORDER_RADIUS.sm,
                border: `1px solid ${p.border}`, background: p.fieldBg, color: p.text,
                fontSize: FONT_SIZES.sm, outline: "none", maxWidth: 200
              }}
            >
              <option value="">{t.views.backToPublic}</option>
              {(views || []).map((v) => (
                <option key={v.id} value={String(v.id)}>
                  {v.name}{v.is_default ? " ★" : ""}
                </option>
              ))}
            </select>
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

      {showDriftBar && (
        <div style={{
          display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end",
          padding: "6px 10px", borderRadius: BORDER_RADIUS.sm,
          background: darkMode ? "#2a2d3a" : "#fff8e1",
          border: `1px solid ${darkMode ? COLORS.border.dark : "#f5c518"}`
        }}>
          <span style={{ fontSize: FONT_SIZES.sm, color: p.text }}>{t.views.driftHint}</span>
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
