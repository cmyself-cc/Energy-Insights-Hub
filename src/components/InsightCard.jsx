import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";

export default function InsightCard({ item, selected, onToggle, darkMode, linkText = "🔗 View original" }) {
  return (
    <div
      className="card"
      onClick={onToggle}
      style={{
        background: selected
          ? COLORS.primaryLight
          : darkMode
            ? COLORS.background.cardDark
            : COLORS.background.card,
        borderRadius: BORDER_RADIUS.xl,
        padding: "20px 24px",
        boxShadow: selected ? "0 0 0 2px #1a6b3c" : "0 1px 4px rgba(0,0,0,0.08)",
        border: selected
          ? "2px solid #1a6b3c"
          : `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
        cursor: "pointer",
        transition: `all ${TRANSITIONS.fast}`,
        position: "relative"
      }}
    >
      {selected && (
        <div
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            background: COLORS.primary,
            color: "#fff",
            borderRadius: "50%",
            width: 22,
            height: 22,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 700
          }}
        >
          ✓
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {item.tags?.map((t) => (
          <span
            key={t}
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: COLORS.primary,
              background: COLORS.primaryLight,
              borderRadius: 6,
              padding: "2px 8px",
              textTransform: "uppercase",
              letterSpacing: 0.5
            }}
          >
            {t}
          </span>
        ))}
      </div>
      <div
        style={{
          fontWeight: 700,
          fontSize: FONT_SIZES.xl,
          color: darkMode ? "#e8e8e8" : "#111",
          lineHeight: 1.4,
          marginBottom: 8
        }}
      >
        {item.title}
      </div>
      <div
        style={{
          fontSize: FONT_SIZES.base,
          color: darkMode ? "#bbb" : COLORS.text.secondary,
          lineHeight: 1.6,
          marginBottom: 8
        }}
      >
        {item.summary}
      </div>
      <div style={{ fontSize: FONT_SIZES.sm, color: COLORS.text.light }}>
        {item.source && (
          <span style={{ fontWeight: 500, color: COLORS.text.tertiary }}>{item.source}</span>
        )}
        {item.source && item.date && <span> · </span>}
        {item.date && <span>{item.date}</span>}
        {item.url && (
          <div style={{ marginTop: 4 }}>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                color: COLORS.primary,
                textDecoration: "none",
                fontSize: FONT_SIZES.sm,
                fontWeight: 500,
                display: "inline-flex",
                alignItems: "center",
                gap: 4
              }}
            >
              {linkText}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
