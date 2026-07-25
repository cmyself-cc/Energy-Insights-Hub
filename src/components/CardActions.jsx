import { useState, useRef, useEffect } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { i18n } from "../constants/i18n";

export default function CardActions({ darkMode, language, bookmarked, onBookmark, onHide, itemUrl }) {
  const t = i18n[language];
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const menuItemStyle = {
    display: "block",
    width: "100%",
    padding: "8px 14px",
    border: "none",
    background: "transparent",
    color: darkMode ? "#e8e8e8" : COLORS.text.primary,
    fontSize: FONT_SIZES.md,
    textAlign: "left",
    cursor: "pointer",
    transition: `background ${TRANSITIONS.fast}`
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          border: "none",
          background: "transparent",
          color: darkMode ? "#aaa" : COLORS.text.light,
          fontSize: FONT_SIZES.lg,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: `all ${TRANSITIONS.fast}`
        }}
      >
        ⋯
      </button>

      {open && (
        <div style={{
          position: "absolute",
          top: 32,
          right: 0,
          minWidth: 140,
          background: darkMode ? COLORS.background.cardDark : "#fff",
          border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
          borderRadius: BORDER_RADIUS.md,
          boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
          zIndex: 20,
          padding: "4px 0"
        }}>
          <button
            onClick={(e) => { e.stopPropagation(); onBookmark(); setOpen(false); }}
            style={menuItemStyle}
          >
            {bookmarked ? `${t.competitiveIntelligence.removeBookmark}` : `${t.competitiveIntelligence.bookmark}`}
          </button>
          {itemUrl && (
            <a
              href={itemUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => { e.stopPropagation(); setOpen(false); }}
              style={{ ...menuItemStyle, textDecoration: "none", display: "block" }}
            >
              {t.competitiveIntelligence.viewOriginal}
            </a>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onHide(); setOpen(false); }}
            style={menuItemStyle}
          >
            {t.competitiveIntelligence.hide}
          </button>
        </div>
      )}
    </div>
  );
}
