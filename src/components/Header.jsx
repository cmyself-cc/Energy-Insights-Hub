import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { i18n } from "../constants/i18n";

export default function Header({ darkMode, language, onLanguageToggle }) {
  const t = i18n[language];

  return (
    <header style={{
      position: "sticky",
      top: 0,
      zIndex: 100,
      height: 56,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 24px",
      background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
      borderBottom: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
      boxShadow: "0 1px 2px rgba(0,0,0,0.03)"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontWeight: 800,
          fontSize: FONT_SIZES.lg,
          color: darkMode ? "#fff" : COLORS.text.primary
        }}>
          <img
            src="/logo.jpg"
            alt="logo"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              objectFit: "cover"
            }}
          />
          <span style={{ fontSize: FONT_SIZES.xl, fontWeight: 700 }}>混沌能源智库</span>
          <span style={{
            fontSize: FONT_SIZES.sm,
            color: darkMode ? "#888" : "#999",
            fontWeight: 500,
            marginLeft: 4
          }}>｜Energy Insights Hub</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={onLanguageToggle}
          style={{
            padding: "6px 12px",
            borderRadius: BORDER_RADIUS.md,
            border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
            background: "transparent",
            color: darkMode ? "#e8e8e8" : COLORS.text.secondary,
            fontSize: FONT_SIZES.md,
            cursor: "pointer",
            fontWeight: 500,
            transition: `all ${TRANSITIONS.fast}`
          }}
        >
          {language === "en" ? "中 文" : "English"}
        </button>

        <div style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: COLORS.primaryLight,
          color: COLORS.primary,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: FONT_SIZES.md,
          fontWeight: 700,
          border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`
        }}>
          U
        </div>
      </div>
    </header>
  );
}
