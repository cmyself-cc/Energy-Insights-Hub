import { useState, useEffect } from "react";
import { i18n } from "../constants/i18n";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";

// 情报页视角条（Task 11 / M3；本文件 2026-10 按产品负责人要求重做布局）：
//   · 与 FilterBar（监控筛选行）同一行、右对齐 —— 由 IntelligencePage 的 flex 父容器保证；
//   · 关闭态（公共池）：**只**渲染「保存为视角」一个按钮 —— 无下拉、无管理按钮；
//     保存成功由 App 侧自动启用新视角（否则关闭态没有入口打开视角）。
//   · 激活态：下拉（选中项即视角名，option 里带 ★ 默认标记；第一项「回公共池」= 关闭
//     入口，原开关按钮已删，功能被它吸收）+「设为默认」+「删除」。
//   · 刻意**不重复渲染视角名**：下拉选中项已经显示名字（产品负责人明确要求）。
// 纯展示组件：数据/动作全走 props，静态渲染可观察三态；保存表单开合与「忽略」是
// 纯 UI 瞬态（内部 state），照实登记为静态盲区。

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
  padding: "6px 12px",
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
    if (id === "") return onSelect(null);   // 「回公共池」= 关闭视角
    const view = (views || []).find((v) => String(v.id) === id);
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
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
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
                padding: "6px 10px", borderRadius: BORDER_RADIUS.sm,
                border: `1px solid ${p.border}`, background: p.fieldBg, color: p.text,
                fontSize: FONT_SIZES.sm, outline: "none", width: 160
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
                padding: "6px 10px", borderRadius: BORDER_RADIUS.sm,
                border: `1px solid ${p.border}`, background: p.fieldBg, color: p.text,
                fontSize: FONT_SIZES.sm, outline: "none", maxWidth: 220
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
          padding: "8px 12px", borderRadius: BORDER_RADIUS.sm,
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
