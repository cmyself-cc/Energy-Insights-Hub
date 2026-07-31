import { useState, useEffect } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS } from "../constants/theme";
import { backendApi } from "../utils/backendApi";

const PHASE_LABELS = {
  zh: { fetching: "信源抓取", filtering: "关键词过滤", processing: "语义解读", storing: "生成卡片" },
  en: { fetching: "Fetching", filtering: "Filtering", processing: "Processing", storing: "Generating" }
};

export default function TrackerProgress({ darkMode, language }) {
  const [status, setStatus] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let timer;
    const poll = async () => {
      try {
        const res = await backendApi.getTrackerStatus();
        const data = res.data;
        if (data.active) {
          setStatus(data);
          setVisible(true);
        } else if (visible || status?.active) {
          setVisible(false);
          setStatus(null);
        }
      } catch (e) { /* ignore */ }
    };
    poll();
    timer = setInterval(poll, 1500);
    return () => clearInterval(timer);
  }, [visible, status?.active]);

  if (!visible || !status) return null;

  const phase = status.phase || "fetching";
  const total = status.sources_total || 0;
  const done = (status.sources_success || 0) + (status.sources_failed || 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const label = (PHASE_LABELS[language] || PHASE_LABELS.zh)[phase] || phase;

  return (
    <div style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      background: darkMode ? "#1a1f2e" : "#fff",
      border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
      borderRadius: 20,
      padding: "4px 14px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
    }}>
      {phase !== "storing" && (
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: COLORS.primary, animation: "tp-pulse 1.5s ease-in-out infinite", flexShrink: 0 }} />
      )}
      <span style={{ fontSize: FONT_SIZES.sm, fontWeight: 600, color: darkMode ? "#e8e8e8" : COLORS.text.primary, whiteSpace: "nowrap" }}>
        {label}
      </span>
      <div style={{
        width: 60, height: 4, background: darkMode ? "#333" : "#e8e8e8", borderRadius: 2, overflow: "hidden", flexShrink: 0
      }}>
        <div style={{
          height: "100%", width: `${pct}%`,
          background: `linear-gradient(90deg, ${COLORS.primary}, #4caf84)`,
          borderRadius: 2, transition: "width 0.8s ease"
        }} />
      </div>
      <span style={{ fontSize: FONT_SIZES.xs, fontWeight: 700, color: COLORS.primary, minWidth: 28, textAlign: "right" }}>{pct}%</span>
      <style>{`@keyframes tp-pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }`}</style>
    </div>
  );
}
