import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { i18n } from "../constants/i18n";
import CardActions from "./CardActions";

const PURPOSE_DOTS = {
  competitor: { color: "#e74c3c", label: "竞争" },
  policy: { color: "#3498db", label: "政策" },
  tech: { color: "#27ae60", label: "技术" }
};

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr.split("T")[0] || dateStr;
  return d.toISOString().split("T")[0];
}

export default function InsightCard({
  item,
  darkMode,
  language,
  bookmarked,
  onBookmark,
  onHide,
  onAiInterpret,
  onKeywordClick
}) {
  const t = i18n[language];

  const keywordChipStyle = {
    fontSize: FONT_SIZES.xs,
    fontWeight: 600,
    color: COLORS.primary,
    background: COLORS.primaryLight,
    borderRadius: BORDER_RADIUS.sm,
    padding: "4px 10px",
    whiteSpace: "nowrap",
    cursor: "pointer",
    transition: `all ${TRANSITIONS.fast}`
  };

  const purposeDotStyle = (color) => ({
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: color,
    display: "inline-block",
    flexShrink: 0
  });

  const keywords = (item.keywords || []).slice(0, 3);
  const purposes = item.purposes || ["competitor"];

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
      boxSizing: "border-box",
      breakInside: "avoid"
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

      {/* Title */}
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

      {/* Date + Source + Purpose dots */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 12,
        fontSize: FONT_SIZES.sm,
        color: darkMode ? "#888" : COLORS.text.light
      }}>
        <span>{formatDate(item.date)}</span>
        {item.source && <span>·</span>}
        {item.source && <span>{item.source}</span>}
        {item.source && purposes.length > 0 && <span>·</span>}
        <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {purposes.map(p => (
            <span
              key={p}
              title={PURPOSE_DOTS[p]?.label || p}
              style={purposeDotStyle(PURPOSE_DOTS[p]?.color || "#888")}
            />
          ))}
        </span>
      </div>

      {/* Summary - full text, no truncation */}
      <div style={{
        fontSize: FONT_SIZES.base,
        color: darkMode ? "#bbb" : COLORS.text.secondary,
        lineHeight: 1.65,
        marginBottom: 12,
        flex: 1
      }}>
        {item.summary}
      </div>

      {/* Keywords + AI button */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto", gap: 8 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {keywords.map(kw => (
            <span
              key={kw}
              style={keywordChipStyle}
              onClick={(e) => {
                e.stopPropagation();
                if (onKeywordClick) onKeywordClick(kw);
              }}
              title={language === "zh" ? `搜索: ${kw}` : `Search: ${kw}`}
            >
              {kw}
            </span>
          ))}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (onAiInterpret) onAiInterpret(e);
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "6px 12px",
            borderRadius: BORDER_RADIUS.md,
            border: `1px solid ${COLORS.primary}`,
            background: "transparent",
            color: COLORS.primary,
            fontSize: FONT_SIZES.sm,
            fontWeight: 600,
            cursor: "pointer",
            transition: `all ${TRANSITIONS.fast}`,
            flexShrink: 0
          }}
        >
          <span>✨</span>
          <span>{t.competitiveIntelligence.aiInterpret}</span>
        </button>
      </div>
    </div>
  );
}
