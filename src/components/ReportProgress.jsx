import { useState, useEffect } from "react";
import { COLORS, FONT_SIZES } from "../constants/theme";
import { backendApi } from "../utils/backendApi";

const PHASE_LABELS = {
  zh: { queued: "报告排队", searching: "检索资料", summarizing: "AI 总结", done: "报告完成", failed: "报告失败" },
  en: { queued: "Queued", searching: "Searching", summarizing: "Summarizing", done: "Done", failed: "Failed" }
};

// 与 TrackerProgress 同风格的全局报告生成进度条（Header 常驻，可跨页面查看）
export default function ReportProgress({ darkMode, language }) {
  const [job, setJob] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let timer;
    const poll = async () => {
      try {
        const res = await backendApi.getReportJobs();
        const rows = res.data || [];
        const active = rows.find(j => j.status === "queued" || j.status === "generating");
        if (active) {
          setJob(active);
          setVisible(true);
        } else if (visible || job) {
          setVisible(false);
          setJob(null);
        }
      } catch (e) { /* ignore */ }
    };
    poll();
    timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, job]);

  if (!visible || !job) return null;

  const phase = job.phase || "queued";
  const pct = job.progress || 0;
  const label = (PHASE_LABELS[language] || PHASE_LABELS.zh)[phase] || phase;
  const failed = job.status === "failed";

  return (
    <div style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      background: darkMode ? "#1a1f2e" : "#fff",
      border: `1px solid ${failed ? "#c00" : (darkMode ? COLORS.border.dark : COLORS.border.light)}`,
      borderRadius: 20,
      padding: "4px 14px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: failed ? "#c00" : COLORS.primary, animation: failed ? "none" : "rp-pulse 1.5s ease-in-out infinite", flexShrink: 0 }} />
      <span style={{ fontSize: FONT_SIZES.sm, fontWeight: 600, color: darkMode ? "#e8e8e8" : COLORS.text.primary, whiteSpace: "nowrap" }}>
        {failed ? (language === "zh" ? "报告生成失败" : "Report failed") : label}
      </span>
      {!failed && (
        <>
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
        </>
      )}
      <style>{`@keyframes rp-pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }`}</style>
    </div>
  );
}
