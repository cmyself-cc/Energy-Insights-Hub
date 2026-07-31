import { useState } from "react";
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
  inCart,
  onBookmark,
  onHide,
  onAiInterpret,
  onKeywordClick
}) {
  const t = i18n[language];
  const [copied, setCopied] = useState(false);

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
  const sourceType = (item.sourceType || "").toLowerCase();
  const isWechat = sourceType.includes("微信") || sourceType.includes("wechat");
  const displaySource = item.source && String(item.source) !== String(item.sourceId) ? item.source : null;

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
          onAiInterpret={() => onAiInterpret()}
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
        justifyContent: "space-between",
        gap: 8,
        marginBottom: 12,
        fontSize: FONT_SIZES.sm,
        color: darkMode ? "#888" : COLORS.text.light
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>{formatDate(item.date)}</span>
          {displaySource && <span>·</span>}
          {displaySource && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              {isWechat && (
                <img
                  src="/wechat-icon.png"
                  alt="微信"
                  style={{ width: 16, height: 16, flexShrink: 0, display: "inline-block" }}
                />
              )}
              <span>{displaySource}</span>
            </span>
          )}
        </div>
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

      {/* Keywords + Copy button */}
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
        {inCart ? (
          <div style={{
            width: 28, height: 28, borderRadius: "50%",
            background: COLORS.primary, color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 700, flexShrink: 0, cursor: "pointer"
          }}>✓</div>
        ) : (
        <div style={{ position: "relative", flexShrink: 0 }}>
          {copied && (
            <div style={{
              position: "absolute", bottom: "100%", right: 0,
              marginBottom: 6, padding: "4px 10px", borderRadius: 6,
              background: COLORS.primary, color: "#fff", fontSize: 11,
              whiteSpace: "nowrap", fontWeight: 600,
              animation: "fadeInOut 1.5s ease"
            }}>
              ✓ {language === "zh" ? "已复制" : "Copied"}
            </div>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              const text = `${item.title}\n\n${item.summary}`;
              const ta = document.createElement("textarea");
              ta.value = text;
              ta.style.position = "fixed"; ta.style.left = "-9999px";
              document.body.appendChild(ta);
              ta.select();
              document.execCommand("copy");
              document.body.removeChild(ta);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            title={language === "zh" ? "复制到剪贴板" : "Copy to clipboard"}
            style={{
              cursor: "pointer", padding: "4px 8px", borderRadius: 6,
              border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
              background: "transparent", color: darkMode ? "#aaa" : COLORS.text.light,
              fontSize: FONT_SIZES.xs
            }}
          >📋</button>
        </div>
        )}
      </div>
      <style>{`@keyframes fadeInOut { 0% { opacity:0; transform:translateY(5px) } 20% { opacity:1; transform:translateY(0) } 80% { opacity:1 } 100% { opacity:0 } }`}</style>
    </div>
  );
}
