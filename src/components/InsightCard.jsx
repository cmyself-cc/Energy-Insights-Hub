import { useState } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { i18n } from "../constants/i18n";
import CardActions from "./CardActions";

const PURPOSE_DOTS = {
  competitor: { color: "#e74c3c", label: "竞争" },
  policy: { color: "#3498db", label: "政策" },
  tech: { color: "#27ae60", label: "技术" },
  industry: { color: "#b8860b", label: "行业" }
};

// 在文本中高亮配置的主体关键词：长词优先，避免重叠
function highlightSubjectKeywords(text, keywords, markStyle) {
  if (!text || !keywords || keywords.length === 0) return text;
  const lower = text.toLowerCase();
  const taken = new Array(text.length).fill(false);
  const ranges = [];
  for (const kw of keywords) {
    if (!kw) continue;
    const kwLower = kw.toLowerCase();
    let idx = lower.indexOf(kwLower);
    while (idx !== -1) {
      let overlap = false;
      for (let i = idx; i < idx + kw.length; i++) {
        if (taken[i]) { overlap = true; break; }
      }
      if (!overlap) {
        ranges.push([idx, idx + kw.length]);
        for (let i = idx; i < idx + kw.length; i++) taken[i] = true;
      }
      idx = lower.indexOf(kwLower, idx + kw.length);
    }
  }
  if (ranges.length === 0) return text;
  ranges.sort((a, b) => a[0] - b[0]);
  const out = [];
  let pos = 0;
  ranges.forEach(([s, e], i) => {
    if (s > pos) out.push(text.slice(pos, s));
    out.push(<span key={i} style={markStyle}>{text.slice(s, e)}</span>);
    pos = e;
  });
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

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
  onReclassify,
  onAiInterpret,
  onKeywordClick,
  subjectKeywords = []
}) {
  const t = i18n[language];
  const [copied, setCopied] = useState(false);

  // 主体关键词高亮样式（标题与摘要共用）
  const subjectMarkStyle = {
    color: darkMode ? "#fbbf24" : "#d97706",
    fontWeight: 700
  };

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
    <div className="insight-card-hover" style={{
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
          onReclassify={onReclassify}
          currentPurpose={Array.isArray(item.purposes) ? item.purposes[0] : "competitor"}
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
          {highlightSubjectKeywords(item.title, subjectKeywords, subjectMarkStyle)}
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
      <style>{`
        @keyframes fadeInOut { 0% { opacity:0; transform:translateY(5px) } 20% { opacity:1; transform:translateY(0) } 80% { opacity:1 } 100% { opacity:0 } }
        .insight-card-hover { transition: transform 0.18s ease, box-shadow 0.18s ease; }
        .insight-card-hover:hover { transform: scale(1.02); box-shadow: 0 8px 24px rgba(0,0,0,0.15); z-index: 5; position: relative; }
      `}</style>
    </div>
  );
}
