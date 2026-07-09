import { useState } from "react";
import SourcesPage from "./SourcesPage";
import TrackerSettingsPage from "./TrackerSettingsPage";
import ApiConfig from "./ApiConfig";
import { COLORS, FONT_SIZES, BORDER_RADIUS } from "../constants/theme";
import { i18n } from "../constants/i18n";

const TABS = [
  { key: "sources", icon: "🌐", labelKey: "sources" },
  { key: "tracker", icon: "⚙️", labelKey: "trackerSettingsTab" },
  { key: "api", icon: "🔑", labelKey: "apiConfigTab" }
];

export default function ConfigurationPage({ darkMode, language, apiConfig, onApiConfigSave, onTrackerComplete }) {
  const [tab, setTab] = useState("sources");
  const t = i18n[language];
  const border = darkMode ? COLORS.border.dark : COLORS.border.light;
  const text = darkMode ? "#e8e8e8" : COLORS.text.primary;

  return (
    <div>
      <div style={{
        display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap"
      }}>
        {TABS.map(item => (
          <button key={item.key} onClick={() => setTab(item.key)} style={{
            flex: "1 1 140px", maxWidth: 200,
            padding: "16px 20px", borderRadius: BORDER_RADIUS.lg,
            border: `1px solid ${border}`,
            background: tab === item.key ? COLORS.primary : darkMode ? COLORS.background.cardDark : COLORS.background.card,
            color: tab === item.key ? "#fff" : text,
            fontSize: FONT_SIZES.md, fontWeight: tab === item.key ? 700 : 500,
            cursor: "pointer", textAlign: "left"
          }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>{item.icon}</div>
            <div>{t.competitiveIntelligence[item.labelKey] || item.labelKey}</div>
          </button>
        ))}
      </div>

      {tab === "sources" && <SourcesPage darkMode={darkMode} language={language} onTrackerComplete={onTrackerComplete} />}
      {tab === "tracker" && <TrackerSettingsPage darkMode={darkMode} language={language} />}
      {tab === "api" && (
        <ApiConfig
          inline
          darkMode={darkMode}
          currentConfig={apiConfig}
          onSave={onApiConfigSave}
          onClose={() => {}}
        />
      )}
    </div>
  );
}
