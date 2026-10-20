import { useEffect, useState } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS } from "../constants/theme";
import { i18n } from "../constants/i18n";
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
  const [message, setMessage] = useState(null);

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
    setError(null);
    try {
      await backendApi.generateFeedbackSuggestions();
      await load();
      setMessage({ type: "success", text: language === "zh" ? "建议已生成" : "Suggestions generated" });
      setTimeout(() => setMessage(null), 3000);
    } catch (e) {
      console.error("Generate suggestions failed:", e);
      setMessage({ type: "error", text: `${language === "zh" ? "生成失败" : "Generate failed"}: ${e.message}` });
      setTimeout(() => setMessage(null), 4000);
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

      {message && (
        <div style={{
          padding: "12px 16px",
          borderRadius: BORDER_RADIUS.md,
          background: message.type === "success" ? "#e8f5ee" : "#fff0f0",
          border: `1px solid ${message.type === "success" ? COLORS.primary : "#c00"}`,
          color: message.type === "success" ? COLORS.primary : "#c00",
          marginBottom: 16,
          fontSize: FONT_SIZES.sm,
          fontWeight: 500
        }}>
          {message.text}
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
        <SuggestionRow
          key={s.id}
          s={s}
          language={language}
          darkMode={darkMode}
          onAccept={() => handleAccept(s.id)}
          onReject={() => handleReject(s.id)}
        />
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

// 待审建议行（Task 13 抽出为纯展示组件，给静态渲染测试观察）。
// submitter_id 非空 = 用户经「提交给管理员」入队（Task 12 端点）：显示署名 + 徽标 + 补充说明；
// null = 系统 LLM 批量生成（generate-suggestions），保持旧样式，不加徽标。
export function SuggestionRow({ s, language, darkMode, onAccept, onReject }) {
  const text = darkMode ? "#e8e8e8" : COLORS.text.primary;
  const muted = darkMode ? "#888" : COLORS.text.light;
  const border = `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`;
  const userSubmitted = s.submitter_id != null;
  return (
    <div style={{ background: darkMode ? COLORS.background.cardDark : COLORS.background.card, border, borderRadius: BORDER_RADIUS.lg, padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600, color: text, fontSize: FONT_SIZES.base }}>
          {s.type}: {s.name}
          {userSubmitted && (
            <span style={{
              marginLeft: 8, fontSize: 11, fontWeight: 600, padding: "2px 8px",
              borderRadius: BORDER_RADIUS.sm, background: COLORS.primaryLight, color: COLORS.primary
            }}>
              {i18n[language].competitiveIntelligence.fromUserSubmit}
            </span>
          )}
        </span>
        <span style={{ fontSize: FONT_SIZES.sm, color: muted }}>
          {s.purpose || "global"}
          {userSubmitted && s.submitter_nickname ? ` · ${s.submitter_nickname}` : ""}
        </span>
      </div>
      {s.reason && (
        <p style={{ color: darkMode ? "#bbb" : COLORS.text.secondary, fontSize: FONT_SIZES.sm, marginBottom: 8 }}>
          {s.reason}
        </p>
      )}
      {userSubmitted && s.evidence && (
        <p style={{ color: muted, fontSize: FONT_SIZES.sm, marginBottom: 12, fontStyle: "italic" }}>
          “{s.evidence}”
        </p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onAccept} style={{
          padding: "6px 12px", borderRadius: BORDER_RADIUS.sm, border: "none",
          background: COLORS.primary, color: "#fff", fontSize: FONT_SIZES.sm, cursor: "pointer"
        }}>
          {language === "zh" ? "采纳" : "Accept"}
        </button>
        <button onClick={onReject} style={{
          padding: "6px 12px", borderRadius: BORDER_RADIUS.sm, border,
          background: "transparent", color: text, fontSize: FONT_SIZES.sm, cursor: "pointer"
        }}>
          {language === "zh" ? "忽略" : "Reject"}
        </button>
      </div>
    </div>
  );
}
