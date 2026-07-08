import { useState, useEffect } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { i18n } from "../constants/i18n";
import { backendApi } from "../utils/backendApi";

function parseMarkdown(content) {
  if (!content) return "";
  return content
    .replace(/^# (.+)$/gm, "<h1 style='font-size:20px;font-weight:800;color:#1a6b3c;margin:8px 0;'>$1</h1>")
    .replace(/^## (.+)$/gm, "<h2 style='font-size:16px;font-weight:700;color:#1a6b3c;margin:8px 0;'>$1</h2>")
    .replace(/^### (.+)$/gm, "<h3 style='font-size:14px;font-weight:700;margin:6px 0;'>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#1a6b3c;text-decoration:none;font-weight:500;">$1</a>')
    .replace(/\n/g, "<br>");
}

export default function ReportsPage({ darkMode, language, onViewReport }) {
  const t = i18n[language];
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    setLoading(true);
    try {
      const res = await backendApi.getReports();
      setReports(res.data || []);
    } catch (e) {
      console.error("Failed to load reports:", e);
    }
    setLoading(false);
  };

  const deleteReport = async (id, e) => {
    e.stopPropagation();
    if (!confirm(language === "zh" ? "确定删除该报告？" : "Delete this report?")) return;
    try {
      await backendApi.deleteReport(id);
      setReports(prev => prev.filter(r => r.id !== id));
      if (selectedReport?.id === id) setSelectedReport(null);
    } catch (err) {
      console.error("Delete report failed:", err);
    }
  };

  if (selectedReport) {
    return (
      <div style={{
        background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
        borderRadius: BORDER_RADIUS.xl,
        border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
        padding: "24px 28px",
        minHeight: "60vh"
      }}>
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 12
        }}>
          <div>
            <h2 style={{
              fontSize: FONT_SIZES["2xl"],
              fontWeight: 700,
              color: darkMode ? "#fff" : COLORS.text.primary,
              margin: "0 0 6px"
            }}>{selectedReport.title}</h2>
            <div style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#888" : COLORS.text.light }}>
              {new Date(selectedReport.created_at).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}
              {selectedReport.language && ` · ${selectedReport.language}`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => onViewReport?.(selectedReport)}
              style={{
                padding: "8px 16px",
                borderRadius: BORDER_RADIUS.md,
                border: "none",
                background: COLORS.primary,
                color: "#fff",
                fontSize: FONT_SIZES.md,
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              {language === "zh" ? "编辑/重新生成" : "Regenerate"}
            </button>
            <button
              onClick={() => setSelectedReport(null)}
              style={{
                padding: "8px 16px",
                borderRadius: BORDER_RADIUS.md,
                border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
                background: "transparent",
                color: darkMode ? "#e8e8e8" : COLORS.text.primary,
                fontSize: FONT_SIZES.md,
                cursor: "pointer"
              }}
            >
              ✕ {t.buttons.close}
            </button>
          </div>
        </div>
        <div
          style={{
            fontSize: FONT_SIZES.base,
            lineHeight: 1.7,
            color: darkMode ? "#e8e8e8" : COLORS.text.primary
          }}
          dangerouslySetInnerHTML={{ __html: parseMarkdown(selectedReport.content) }}
        />
      </div>
    );
  }

  return (
    <div>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 20
      }}>
        <h1 style={{
          fontSize: FONT_SIZES["3xl"],
          fontWeight: 700,
          color: darkMode ? "#fff" : COLORS.text.primary,
          margin: 0
        }}>
          {language === "zh" ? "报告" : "Reports"}
        </h1>
      </div>

      {loading && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: darkMode ? "#888" : "#aaa" }}>
          {t.competitiveIntelligence.loadingMore}
        </div>
      )}

      {!loading && reports.length === 0 && (
        <div style={{
          textAlign: "center",
          padding: "80px 20px",
          color: darkMode ? "#888" : "#aaa",
          background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
          borderRadius: BORDER_RADIUS.xl,
          border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📝</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            {language === "zh" ? "暂无保存的报告" : "No saved reports yet"}
          </div>
          <div style={{ fontSize: FONT_SIZES.md, marginTop: 8 }}>
            {language === "zh" ? "生成简报后点击保存即可在此查看" : "Save a newsletter after generating it"}
          </div>
        </div>
      )}

      {!loading && reports.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {reports.map(report => (
            <div
              key={report.id}
              onClick={() => setSelectedReport(report)}
              style={{
                background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
                borderRadius: BORDER_RADIUS.lg,
                border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
                padding: "16px 20px",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                transition: `all ${TRANSITIONS.fast}`,
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
              }}
            >
              <div>
                <div style={{
                  fontSize: FONT_SIZES.lg,
                  fontWeight: 700,
                  color: darkMode ? "#fff" : COLORS.text.primary,
                  marginBottom: 4
                }}>
                  {report.title}
                </div>
                <div style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#888" : COLORS.text.light }}>
                  {new Date(report.created_at).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}
                  {report.language && ` · ${report.language}`}
                </div>
              </div>
              <button
                onClick={(e) => deleteReport(report.id, e)}
                style={{
                  padding: "6px 12px",
                  borderRadius: BORDER_RADIUS.md,
                  border: `1px solid ${darkMode ? "#c00" : "#c00"}`,
                  background: "transparent",
                  color: "#c00",
                  fontSize: FONT_SIZES.sm,
                  cursor: "pointer"
                }}
              >
                {language === "zh" ? "删除" : "Delete"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
