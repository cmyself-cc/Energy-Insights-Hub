import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { i18n } from "../constants/i18n";

const MENU_ITEMS = [
  { key: "intelligence", icon: "◧", i18nKey: "sidebarTitle" },
  { key: "reports", icon: "≡", i18nKey: "reports" },
  { key: "configuration", icon: "⚙", i18nKey: "configuration" }
];


export default function Sidebar({ darkMode, language, activeTab, onTabChange, collapsed = false }) {
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
        {MENU_ITEMS.map(item => {
          const active = activeTab === item.key;
          const label = t.competitiveIntelligence[item.i18nKey];
          return (
            <button
              key={item.key}
              onClick={() => onTabChange(item.key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: BORDER_RADIUS.md,
                border: "none",
                background: active ? COLORS.primary : "transparent",
                color: active ? "#fff" : darkMode ? "#e8e8e8" : COLORS.text.primary,
                fontSize: FONT_SIZES.md,
                fontWeight: active ? 600 : 500,
                cursor: "pointer",
                transition: `all ${TRANSITIONS.fast}`,
                textAlign: "left"
              }}
            >
              <span>{item.icon}</span>
              {!collapsed && <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>}
            </button>
          );
        })}
      </nav>

      {!collapsed && (
        <div style={{
          marginTop: "auto",
          padding: "0 24px",
          borderTop: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 72,
          boxSizing: "border-box"
        }}>
          <a
            href="https://cmyself.cc"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "block", lineHeight: 0 }}
          >
            <img
              src="/cmflow-logo.png"
              alt="CMFlow Apps"
              style={{
                width: "100%",
                maxWidth: 160,
                height: "auto",
                display: "block"
              }}
            />
          </a>
        </div>
      )}
    </aside>
  );
}
