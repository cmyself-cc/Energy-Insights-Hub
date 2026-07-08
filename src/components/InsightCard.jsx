import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { i18n } from "../constants/i18n";
import CardActions from "./CardActions";

export default function InsightCard({
  item,
  darkMode,
  language,
  bookmarked,
  onBookmark,
  onHide,
  onAiInterpret
}) {
  const t = i18n[language];

  const chipStyle = {
    fontSize: FONT_SIZES.xs,
    fontWeight: 600,
    color: COLORS.primary,
    background: COLORS.primaryLight,
    borderRadius: BORDER_RADIUS.sm,
    padding: "3px 8px",
    whiteSpace: "nowrap"
  };

  const entityChipStyle = {
    fontSize: FONT_SIZES.xs,
    color: darkMode ? "#aaa" : COLORS.text.secondary,
    background: darkMode ? "#2a2d3a" : "#f5f5f5",
    borderRadius: BORDER_RADIUS.sm,
    padding: "3px 8px",
    border: `1px solid ${darkMode ? COLORS.border.dark : "#e8e8e8"}`,
    whiteSpace: "nowrap"
  };

  return (
    <div style={{
      position: "relative",
      background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
      borderRadius: BORDER_RADIUS.xl,
      padding: "18px 20px",
      boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
      border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
      transition: `all ${TRANSITIONS.fast}`,
      display: "flex",
      flexDirection: "column",
      height: "100%",
      boxSizing: "border-box"
    }}>
      <div style={{
        position: "absolute",
        top: 12,
        right: 12,
        zIndex: 5
      }}>
        <CardActions
          darkMode={darkMode}
          language={language}
          bookmarked={bookmarked}
          onBookmark={onBookmark}
          onHide={onHide}
          itemUrl={item.url}
        />
      </div>

      <div style={{ paddingRight: 28, marginBottom: 10 }}>
        <a
          href={item.url || "#"}
          target={item.url ? "_blank" : "_self"}
          rel="noopener noreferrer"
          onClick={(e) => !item.url && e.preventDefault()}
          style={{
            fontSize: FONT_SIZES.lg,
            fontWeight: 700,
            color: COLORS.primary,
            textDecoration: "none",
            lineHeight: 1.45,
            display: "block"
          }}
        >
          {item.title}
        </a>
      </div>

      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 10,
        fontSize: FONT_SIZES.sm,
        color: darkMode ? "#888" : COLORS.text.light
      }}>
        <span>{item.date || "—"}</span>
        {item.sourceType && <span>·</span>}
        {item.sourceType && <span>{item.sourceType}</span>}
        {item.source && <span>·</span>}
        {item.source && <span>{item.source}</span>}
      </div>

      {(item.features?.length > 0 || item.businessDomain) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {item.features?.map(f => <span key={f} style={chipStyle}>{f}</span>)}
          {item.businessDomain && !item.features?.includes(item.businessDomain) && (
            <span style={chipStyle}>{item.businessDomain}</span>
          )}
        </div>
      )}

      <div style={{
        fontSize: FONT_SIZES.base,
        color: darkMode ? "#bbb" : COLORS.text.secondary,
        lineHeight: 1.65,
        marginBottom: 12,
        flex: 1,
        display: "-webkit-box",
        WebkitLineClamp: 3,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
        textOverflow: "ellipsis"
      }}>
        {item.summary}
      </div>

      {item.entities?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {item.entities.map(e => <span key={e} style={entityChipStyle}>{e}</span>)}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "auto" }}>
        <button
          onClick={onAiInterpret}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "6px 12px",
            borderRadius: BORDER_RADIUS.md,
            border: `1px solid ${COLORS.primary}`,
            background: "transparent",
            color: COLORS.primary,
            fontSize: FONT_SIZES.md,
            fontWeight: 600,
            cursor: "pointer",
            transition: `all ${TRANSITIONS.fast}`
          }}
        >
          <span>✨</span>
          <span>{t.competitiveIntelligence.aiInterpret}</span>
        </button>
      </div>
    </div>
  );
}
