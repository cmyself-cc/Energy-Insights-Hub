import { useState, useRef, useEffect } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { i18n } from "../constants/i18n";
import { storage } from "../utils/storage";
import TrackerProgress from "./TrackerProgress";

export default function Header({ darkMode, language, onLanguageToggle, onOpenApiConfig }) {
  const t = i18n[language];
  const [configs, setConfigs] = useState([]);
  const [current, setCurrent] = useState(null);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const saved = storage.getApiConfigs();
    setConfigs(saved);
    setCurrent(saved.length > 0 ? saved[0] : null);
  }, []);

  useEffect(() => {
    const handler = () => {
      const saved = storage.getApiConfigs();
      setConfigs(saved);
      setCurrent(saved.length > 0 ? saved[0] : null);
    };
    window.addEventListener("api-config-updated", handler);
    return () => window.removeEventListener("api-config-updated", handler);
  }, []);

  useEffect(() => {
    const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const switchConfig = (id) => {
    const cfg = storage.switchApiConfig(id);
    if (cfg) { setConfigs(storage.getApiConfigs()); setCurrent(cfg); setOpen(false); }
  };

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
        {/* Model quick switch */}
        <div ref={ref} style={{ position: "relative" }}>
          <button onClick={() => setOpen(!open)} style={{
            padding: "6px 12px", borderRadius: BORDER_RADIUS.md,
            border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
            background: current ? COLORS.primaryLight : "transparent",
            color: current ? COLORS.primary : (darkMode ? "#888" : "#999"),
            fontSize: FONT_SIZES.sm, fontWeight: 500, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6, maxWidth: 180
          }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {current ? `${current.providerName} / ${current.modelId}` : (language === "zh" ? "未配置模型" : "No model")}
            </span>
            <span style={{ fontSize: 10 }}>▼</span>
          </button>
          {open && (
            <div style={{ position: "absolute", top: 38, right: 0, minWidth: 220, background: darkMode ? COLORS.background.cardDark : "#fff", border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`, borderRadius: BORDER_RADIUS.md, boxShadow: "0 4px 12px rgba(0,0,0,0.12)", zIndex: 200, padding: "4px 0" }}>
              {configs.map(c => (
                <button key={c.id} onClick={() => switchConfig(c.id)} style={{
                  display: "block", width: "100%", padding: "10px 16px", border: "none", background: c.id === current?.id ? COLORS.primaryLight : "transparent",
                  color: darkMode ? "#e8e8e8" : COLORS.text.primary, fontSize: FONT_SIZES.sm, textAlign: "left", cursor: "pointer"
                }}>
                  <div style={{ fontWeight: 600 }}>{c.providerName}</div>
                  <div style={{ fontSize: 11, color: darkMode ? "#888" : "#999" }}>{c.modelId}</div>
                </button>
              ))}
              <div style={{ borderTop: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`, marginTop: 4, paddingTop: 4 }}>
                <button onClick={() => { setOpen(false); onOpenApiConfig(); }} style={{ display: "block", width: "100%", padding: "10px 16px", border: "none", background: "transparent", color: COLORS.primary, fontSize: FONT_SIZES.sm, textAlign: "left", cursor: "pointer", fontWeight: 600 }}>+ {language === "zh" ? "添加配置" : "Add config"}</button>
              </div>
            </div>
          )}
        </div>

        <button onClick={onLanguageToggle} style={{ padding: "6px 12px", borderRadius: BORDER_RADIUS.md, border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`, background: "transparent", color: darkMode ? "#e8e8e8" : COLORS.text.secondary, fontSize: FONT_SIZES.md, cursor: "pointer", fontWeight: 500, transition: `all ${TRANSITIONS.fast}` }}>
          {language === "en" ? "中 文" : "English"}
        </button>
        <div style={{ width: 32, height: 32, borderRadius: "50%", background: COLORS.primaryLight, color: COLORS.primary, display: "flex", alignItems: "center", justifyContent: "center", fontSize: FONT_SIZES.md, fontWeight: 700, border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}` }}>U</div>
      </div>
    </header>
  );
}
