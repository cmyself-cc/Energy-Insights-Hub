import { useState, useEffect } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { backendApi } from "../utils/backendApi";
import TrackerProgress from "./TrackerProgress";
import ReportProgress from "./ReportProgress";

export default function Header({ darkMode, language, onLanguageToggle }) {
  const [currentModel, setCurrentModel] = useState(null);

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
    <header style={{ position: "sticky", top: 0, zIndex: 100, height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", background: darkMode ? COLORS.background.cardDark : COLORS.background.card, borderBottom: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`, boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800, fontSize: FONT_SIZES.lg, color: darkMode ? "#fff" : COLORS.text.primary }}>
          <img src="/logo.jpg" alt="logo" style={{ width: 28, height: 28, borderRadius: 6, objectFit: "cover" }} />
          <span style={{ fontSize: FONT_SIZES.xl, fontWeight: 700 }}>混沌能源智库</span>
          <span style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#888" : "#999", fontWeight: 500, marginLeft: 4 }}>｜Energy Insights Hub</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <TrackerProgress darkMode={darkMode} language={language} />
        <ReportProgress darkMode={darkMode} language={language} />
        {/* 当前生效模型（只读展示，配置在设置页全局配置） */}
        <div
          title={language === "zh" ? "当前生效模型（在设置页全局配置中管理）" : "Active model (manage in Settings → Global Config)"}
          style={{
            padding: "6px 12px", borderRadius: BORDER_RADIUS.md,
            border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
            background: currentModel ? COLORS.primaryLight : "transparent",
            color: currentModel ? COLORS.primary : (darkMode ? "#888" : "#999"),
            fontSize: FONT_SIZES.sm, fontWeight: 500,
            maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
          }}
        >
          {currentModel ? (currentModel.name || currentModel.modelId) : (language === "zh" ? "未配置模型" : "No model")}
        </div>

        <button onClick={onLanguageToggle} style={{ padding: "6px 12px", borderRadius: BORDER_RADIUS.md, border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`, background: "transparent", color: darkMode ? "#e8e8e8" : COLORS.text.secondary, fontSize: FONT_SIZES.md, cursor: "pointer", fontWeight: 500, transition: `all ${TRANSITIONS.fast}` }}>
          {language === "en" ? "中 文" : "English"}
        </button>
        <div style={{ width: 32, height: 32, borderRadius: "50%", background: COLORS.primaryLight, color: COLORS.primary, display: "flex", alignItems: "center", justifyContent: "center", fontSize: FONT_SIZES.md, fontWeight: 700, border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}` }}>U</div>
      </div>
    </header>
  );
}
