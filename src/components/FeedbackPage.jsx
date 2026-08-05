import { useEffect, useState } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS } from "../constants/theme";
import { backendApi } from "../utils/backendApi";

const REASON_LABELS = {
  zh: { irrelevant: "不相关", duplicate: "重复/已看过", low_quality: "质量差", not_now: "暂时不感兴趣" },
  en: { irrelevant: "Irrelevant", duplicate: "Duplicate / Seen", low_quality: "Low quality", not_now: "Not now" }
};

export default function FeedbackPage({ darkMode, language }) {
  const [stats, setStats] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      const [statsRes, sugRes] = await Promise.all([
        backendApi.getFeedbackStats(),
        backendApi.getFeedbackSuggestions()
      ]);
      setStats(statsRes.data);
      setSuggestions(sugRes.data || []);
      setError(null);
    } catch (e) {
      console.error("Feedback load failed:", e);
      setError(e.message);
    }
  };

  useEffect(() => { load(); }, []);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      await backendApi.generateFeedbackSuggestions();
      await load();
    } catch (e) {
      console.error("Generate suggestions failed:", e);
      setError(e.message);
    }
    setLoading(false);
  };

  const handleAccept = async (id) => {
    try {
      await backendApi.acceptFeedbackSuggestion(id);
      await load();
    } catch (e) {
      console.error("Accept suggestion failed:", e);
      setError(e.message);
    }
  };

  const handleReject = async (id) => {
    try {
      await backendApi.rejectFeedbackSuggestion(id);
      await load();
    } catch (e) {
      console.error("Reject suggestion failed:", e);
      setError(e.message);
    }
  };

  const cardBg = darkMode ? COLORS.background.cardDark : COLORS.background.card;
  const border = darkMode ? COLORS.border.dark : COLORS.border.light;
  const text = darkMode ? "#e8e8e8" : COLORS.text.primary;

  return (
    <div>
      <h2 style={{ fontSize: FONT_SIZES.xl, color: text, marginBottom: 16 }}>
        {language === "zh" ? "反馈建议" : "Feedback Suggestions"}
      </h2>

      {error && (
        <div style={{
          background: "#fff0f0",
          border: "1px solid #fcc",
          borderRadius: BORDER_RADIUS.lg,
          padding: "14px 18px",
          color: "#c00",
          fontSize: FONT_SIZES.base,
          marginBottom: 20
        }}>
          {error}
        </div>
      )}

      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
          <StatBox label={language === "zh" ? "总反馈" : "Total"} value={stats.total} darkMode={darkMode} />
          <StatBox label={language === "zh" ? "收藏" : "Bookmarks"} value={stats.bookmarks} darkMode={darkMode} />
          <StatBox label={language === "zh" ? "隐藏" : "Hidden"} value={stats.hides} darkMode={darkMode} />
        </div>
      )}

      {stats && stats.hides > 0 && (
        <div style={{ background: cardBg, border, borderRadius: BORDER_RADIUS.lg, padding: 16, marginBottom: 24 }}>
          <h3 style={{ fontSize: FONT_SIZES.md, color: text, marginBottom: 12 }}>
            {language === "zh" ? "隐藏原因分布" : "Hide reasons"}
          </h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {Object.entries(stats.byReason).map(([reason, count]) => (
              <span key={reason} style={{
                padding: "6px 12px", borderRadius: BORDER_RADIUS.sm,
                background: darkMode ? "#333" : "#f0f0f0",
                color: text, fontSize: FONT_SIZES.sm
              }}>
                {(REASON_LABELS[language]?.[reason] || reason)}: {count}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ fontSize: FONT_SIZES.md, color: text, margin: 0 }}>
          {language === "zh" ? "规则建议" : "Rule suggestions"}
        </h3>
        <button onClick={handleGenerate} disabled={loading} style={{
          padding: "8px 16px", borderRadius: BORDER_RADIUS.md, border: "none",
          background: COLORS.primary, color: "#fff", fontSize: FONT_SIZES.sm, cursor: "pointer"
        }}>
          {loading ? (language === "zh" ? "生成中..." : "Generating...") : (language === "zh" ? "生成建议" : "Generate")}
        </button>
      </div>

      {suggestions.filter(s => s.status === "pending").length === 0 && (
        <div style={{ color: darkMode ? "#888" : COLORS.text.light, fontSize: FONT_SIZES.sm }}>
          {language === "zh" ? "暂无待处理的规则建议" : "No pending suggestions"}
        </div>
      )}

      {suggestions.filter(s => s.status === "pending").map(s => (
        <div key={s.id} style={{ background: cardBg, border, borderRadius: BORDER_RADIUS.lg, padding: 16, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontWeight: 600, color: text, fontSize: FONT_SIZES.base }}>
              {s.type}: {s.name}
            </span>
            <span style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#888" : COLORS.text.light }}>
              {s.purpose || "global"}
            </span>
          </div>
          <p style={{ color: darkMode ? "#bbb" : COLORS.text.secondary, fontSize: FONT_SIZES.sm, marginBottom: 12 }}>
            {s.reason}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => handleAccept(s.id)} style={{
              padding: "6px 12px", borderRadius: BORDER_RADIUS.sm, border: "none",
              background: COLORS.primary, color: "#fff", fontSize: FONT_SIZES.sm, cursor: "pointer"
            }}>
              {language === "zh" ? "采纳" : "Accept"}
            </button>
            <button onClick={() => handleReject(s.id)} style={{
              padding: "6px 12px", borderRadius: BORDER_RADIUS.sm, border: `1px solid ${border}`,
              background: "transparent", color: text, fontSize: FONT_SIZES.sm, cursor: "pointer"
            }}>
              {language === "zh" ? "忽略" : "Reject"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function StatBox({ label, value, darkMode }) {
  const bg = darkMode ? COLORS.background.cardDark : COLORS.background.card;
  const border = darkMode ? COLORS.border.dark : COLORS.border.light;
  const text = darkMode ? "#e8e8e8" : COLORS.text.primary;
  return (
    <div style={{ background: bg, border, borderRadius: BORDER_RADIUS.lg, padding: 16, textAlign: "center" }}>
      <div style={{ fontSize: FONT_SIZES.xl, fontWeight: 700, color: COLORS.primary }}>{value}</div>
      <div style={{ fontSize: FONT_SIZES.sm, color: text }}>{label}</div>
    </div>
  );
}
