import { useState, useEffect } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { backendApi } from "../utils/backendApi";
import TrackerProgress from "./TrackerProgress";
import ReportProgress from "./ReportProgress";

export default function Header({ darkMode, language, onLanguageToggle, isMobile = false, activeTab, onTabChange }) {
  const [currentModel, setCurrentModel] = useState(null);
  const zh = language === "zh";
  // 移动端顶部导航：右上角下划线式切换（绿色粗线为选中态），与页面内 tab 区分
  const navTabStyle = (active) => ({
    padding: "8px 2px",
    border: "none",
    borderBottom: active ? `3px solid ${COLORS.primary}` : "3px solid transparent",
    background: "transparent",
    color: active ? COLORS.primary : (darkMode ? "#e8e8e8" : COLORS.text.primary),
    fontSize: FONT_SIZES.sm,
    fontWeight: active ? 700 : 500,
    cursor: "pointer",
    whiteSpace: "nowrap"
  });

  useEffect(() => {
    const load = () => {
      backendApi.getCurrentModel()
        .then(res => setCurrentModel(res.data || null))
        .catch(() => {});
    };
    load();
    window.addEventListener("model-updated", load);
    return () => window.removeEventListener("model-updated", load);
  }, []);

  return (
    <header style={{ position: "sticky", top: 0, zIndex: 100, minHeight: 56, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: isMobile ? 6 : 0, padding: isMobile ? "8px 12px" : "0 24px", background: darkMode ? COLORS.background.cardDark : COLORS.background.card, borderBottom: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`, boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 16, minWidth: 0, flexShrink: isMobile ? 0 : 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800, fontSize: FONT_SIZES.lg, color: darkMode ? "#fff" : COLORS.text.primary, minWidth: 0, flexShrink: isMobile ? 0 : 1 }}>
          <img src="/logo.jpg" alt="logo" style={{ width: 28, height: 28, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
          <span style={{ fontSize: isMobile ? FONT_SIZES.base : FONT_SIZES.xl, fontWeight: 700, whiteSpace: "nowrap" }}>混沌能源智库</span>
          {!isMobile && <span style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#888" : "#999", fontWeight: 500, marginLeft: 4 }}>｜Energy Insights Hub</span>}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: isMobile ? "wrap" : "nowrap", justifyContent: isMobile ? "flex-end" : "flex-start" }}>
        {/* 移动端顶部导航置于右上角：市场洞察 / 报告（侧边栏已隐藏，配置仅 Web 端可用） */}
        {isMobile && onTabChange && (
          <nav style={{ display: "flex", gap: 14 }}>
            <button style={navTabStyle(activeTab === "intelligence")} onClick={() => onTabChange("intelligence")}>{zh ? "市场洞察" : "Intelligence"}</button>
            <button style={navTabStyle(activeTab === "reports")} onClick={() => onTabChange("reports")}>{zh ? "报告" : "Reports"}</button>
          </nav>
        )}
        {/* 进度气泡：移动端悬浮在 header 上（不挤占"市场洞察/报告"导航），Web 端内联 */}
        <TrackerProgress darkMode={darkMode} language={language} floating={isMobile} />
        <ReportProgress darkMode={darkMode} language={language} />
        {/* 当前生效模型（只读展示，配置在设置页全局配置）；移动端隐藏以节省空间 */}
        {!isMobile && (
          <div
            title={zh ? "当前生效模型（在设置页全局配置中管理）" : "Active model (manage in Settings → Global Config)"}
            style={{
              padding: "6px 12px", borderRadius: BORDER_RADIUS.md,
              border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
              background: currentModel ? COLORS.primaryLight : "transparent",
              color: currentModel ? COLORS.primary : (darkMode ? "#888" : "#999"),
              fontSize: FONT_SIZES.sm, fontWeight: 500,
              maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
            }}
          >
            {currentModel ? (currentModel.name || currentModel.modelId) : (zh ? "未配置模型" : "No model")}
          </div>
        )}

        {/* 移动端仅中文界面，不显示语言切换 */}
        {!isMobile && (
          <button onClick={onLanguageToggle} style={{ padding: "6px 12px", borderRadius: BORDER_RADIUS.md, border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`, background: "transparent", color: darkMode ? "#e8e8e8" : COLORS.text.secondary, fontSize: FONT_SIZES.md, cursor: "pointer", fontWeight: 500, transition: `all ${TRANSITIONS.fast}` }}>
            {language === "en" ? "中 文" : "English"}
          </button>
        )}
        {!isMobile && (
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: COLORS.primaryLight, color: COLORS.primary, display: "flex", alignItems: "center", justifyContent: "center", fontSize: FONT_SIZES.md, fontWeight: 700, border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}` }}>U</div>
        )}
      </div>
    </header>
  );
}
