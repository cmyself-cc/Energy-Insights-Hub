import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";

export default function Chip({ label, active, onClick, darkMode = false }) {
  return (
    <button
      className="chip"
      onClick={onClick}
      style={{
        padding: "6px 14px",
        borderRadius: BORDER_RADIUS.full,
        border: active ? "none" : `1.5px solid ${darkMode ? COLORS.border.dark : "#e0e0e0"}`,
        background: active ? COLORS.primary : darkMode ? COLORS.background.cardDark : "#fff",
        color: active ? "#fff" : darkMode ? "#ccc" : COLORS.text.secondary,
        fontSize: FONT_SIZES.md,
        cursor: "pointer",
        fontWeight: active ? 600 : 400,
        transition: `all ${TRANSITIONS.fast}`,
        whiteSpace: "nowrap"
      }}
    >
      {label}
    </button>
  );
}
