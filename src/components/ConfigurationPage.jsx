import { useState, useEffect } from "react";
import SourcesPage from "./SourcesPage";
import ContentFiltersPage from "./ContentFiltersPage";
import TrackerSettingsPage from "./TrackerSettingsPage";
import { COLORS, FONT_SIZES, BORDER_RADIUS } from "../constants/theme";
import { i18n } from "../constants/i18n";
import { backendApi } from "../utils/backendApi";

const TABS = [
  { key: "sources", icon: "◎", labelKey: "sources" },
  { key: "filters", icon: "▣", labelKey: "contentFiltersTab" },
  { key: "ai", icon: "◇", labelKey: "aiConfig" },
  { key: "tracker", icon: "⚙", labelKey: "trackerSettingsTab" },
];

export default function ConfigurationPage({ darkMode, language, onTrackerComplete }) {
  const [tab, setTab] = useState("sources");
  const t = i18n[language];
  const border = darkMode ? COLORS.border.dark : COLORS.border.light;
  const text = darkMode ? "#e8e8e8" : COLORS.text.primary;
  const cardBg = darkMode ? COLORS.background.cardDark : COLORS.background.card;

  const [message, setMessage] = useState(null);
  const [presets, setPresets] = useState(["", "", ""]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await backendApi.getAiPresets();
        const data = res.data;
        if (Array.isArray(data) && data.length >= 3) {
          setPresets(data.slice(0, 3));
          localStorage.setItem("ai_presets", JSON.stringify(data.slice(0, 3)));
        } else {
          const fallback = ["", "", ""];
          setPresets(fallback);
        }
      } catch (e) { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  const saveAiPresets = async () => {
    try {
      const filtered = presets.filter(p => p.trim());
      await backendApi.saveAiPresets(filtered);
      localStorage.setItem("ai_presets", JSON.stringify(filtered));
      setMessage({ type: "success", text: language === "zh" ? "已保存" : "Saved" });
      setTimeout(() => setMessage(null), 3000);
    } catch (e) {
      setMessage({ type: "error", text: language === "zh" ? "保存失败" : "Save failed" });
      setTimeout(() => setMessage(null), 3000);
    }
  };

  return (
    <div>
      <div style={{
        display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap"
      }}>
        {TABS.map(item => (
          <button key={item.key} onClick={() => setTab(item.key)} style={{
            flex: "1 1 140px", maxWidth: 200,
            padding: "16px 20px", borderRadius: BORDER_RADIUS.lg,
            border: `1px solid ${border}`,
            background: tab === item.key ? COLORS.primary : darkMode ? COLORS.background.cardDark : COLORS.background.card,
            color: tab === item.key ? "#fff" : text,
            fontSize: FONT_SIZES.md, fontWeight: tab === item.key ? 700 : 500,
            cursor: "pointer", textAlign: "left"
          }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>{item.icon}</div>
            <div>{t.competitiveIntelligence[item.labelKey] || item.labelKey}</div>
          </button>
        ))}
      </div>

      {tab === "sources" && <SourcesPage darkMode={darkMode} language={language} onTrackerComplete={onTrackerComplete} />}
      {tab === "filters" && <ContentFiltersPage darkMode={darkMode} language={language} />}
      {tab === "ai" && (
        <div style={{ background: cardBg, borderRadius: BORDER_RADIUS.lg, border: `1px solid ${border}`, padding: "24px" }}>
          {message && (
            <div style={{ padding: "10px 16px", borderRadius: 8, marginBottom: 16, background: message.type === "success" ? "#e8f5ee" : "#fff0f0", border: message.type === "success" ? "1px solid #1a6b3c" : "1px solid #fcc", color: message.type === "success" ? "#1a6b3c" : "#c00", fontSize: FONT_SIZES.sm, fontWeight: 500 }}>
              {message.type === "success" ? "✓" : "✗"} {message.text}
            </div>
          )}
          <h3 style={{ fontSize: FONT_SIZES.xl, fontWeight: 700, color: text, margin: "0 0 8px" }}>
            {language === "zh" ? "AI 解读预设提示词" : "AI Interpret Presets"}
          </h3>
          <p style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#888" : "#999", marginBottom: 20 }}>
            {language === "zh" ? "在 AI 解读对话框中作为快捷按钮，点击直接发送分析请求" : "Quick buttons in AI interpret dialog"}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 16, marginBottom: 20 }}>
            {[
              { title: language === "zh" ? "竞争格局分析" : "Competitive Landscape", desc: language === "zh" ? "企业战略、收购并购、合作、市场影响" : "Strategy, M&A, partnerships, market impact" },
              { title: language === "zh" ? "政策与合规解读" : "Policy & Compliance", desc: language === "zh" ? "政策文件、监管机构、行业影响" : "Regulations, agencies, industry impact" },
              { title: language === "zh" ? "技术路线与产业趋势" : "Tech & Industry Trends", desc: language === "zh" ? "技术突破、产业链、前景判断" : "Tech breakthroughs, supply chain, outlook" }
            ].map((card, i) => (
              <div key={i} style={{
                background: darkMode ? "#1c1f2b" : "#f9f9f9",
                borderRadius: BORDER_RADIUS.lg,
                border: `1px solid ${border}`,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 8
              }}>
                <div style={{ fontWeight: 700, fontSize: FONT_SIZES.md, color: COLORS.primary }}>{card.title}</div>
                <div style={{ fontSize: 11, color: darkMode ? "#777" : "#999" }}>{card.desc}</div>
                <textarea
                  value={presets[i] || ""}
                  onChange={e => {
                    const next = [...presets];
                    next[i] = e.target.value;
                    setPresets(next);
                  }}
                  rows={8}
                  style={{
                    width: "100%", padding: "10px 14px", borderRadius: 8, resize: "vertical",
                    border: `1px solid ${border}`, background: darkMode ? "#11131a" : "#fff",
                    color: text, fontSize: FONT_SIZES.sm, outline: "none", fontFamily: "inherit",
                    lineHeight: 1.5, boxSizing: "border-box", flex: 1
                  }}
                />
              </div>
            ))}
          </div>
          <button onClick={saveAiPresets} style={{
            padding: "10px 20px", borderRadius: BORDER_RADIUS.md, border: "none",
            background: COLORS.primary, color: "#fff", fontSize: FONT_SIZES.md, fontWeight: 600, cursor: "pointer"
          }}>{language === "zh" ? "保存" : "Save"}</button>
        </div>
      )}
      {tab === "tracker" && <TrackerSettingsPage darkMode={darkMode} language={language} />}
    </div>
  );
}
