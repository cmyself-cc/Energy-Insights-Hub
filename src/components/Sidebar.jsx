import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { i18n } from "../constants/i18n";

export default function Sidebar({ darkMode, language, collapsed = false }) {
  const t = i18n[language];

  return (
    <aside style={{
      width: collapsed ? 64 : 220,
      flexShrink: 0,
      background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
      borderRight: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
      padding: "16px 0",
      display: "flex",
      flexDirection: "column",
      transition: `width ${TRANSITIONS.normal}`
    }}>
      <nav style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 12px" }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          borderRadius: BORDER_RADIUS.md,
          background: COLORS.primary,
          color: "#fff",
          fontSize: FONT_SIZES.md,
          fontWeight: 600,
          cursor: "pointer",
          transition: `all ${TRANSITIONS.fast}`
        }}>
          <span>📊</span>
          {!collapsed && <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.competitiveIntelligence.sidebarTitle}</span>}
        </div>
      </nav>

      {!collapsed && (
        <div style={{
          marginTop: "auto",
          padding: "16px 24px",
          fontSize: FONT_SIZES.xs,
          color: darkMode ? "#666" : COLORS.text.light,
          borderTop: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`
        }}>
          Energy Insights Hub
        </div>
      )}
    </aside>
  );
}
