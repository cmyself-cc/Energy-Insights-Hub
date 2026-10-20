import { useState, useRef, useEffect } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { i18n } from "../constants/i18n";

const HIDE_REASONS = [
  { key: "irrelevant", label: { zh: "不相关", en: "Irrelevant" } },
  { key: "duplicate", label: { zh: "重复/已看过", en: "Duplicate / Seen" } },
  { key: "low_quality", label: { zh: "质量差", en: "Low quality" } },
  { key: "not_now", label: { zh: "暂时不感兴趣", en: "Not now" } }
];

const PURPOSES = [
  { key: "competitor", label: { zh: "竞争", en: "Competitor" } },
  { key: "policy", label: { zh: "政策", en: "Policy" } },
  { key: "tech", label: { zh: "技术", en: "Tech" } },
  { key: "industry", label: { zh: "行业", en: "Industry" } }
];

export default function CardActions({ darkMode, language, userRole, bookmarked, onBookmark, onHide, onReclassify, currentPurpose, onAiInterpret, onSubmitToAdmin }) {
  const t = i18n[language];
  const [open, setOpen] = useState(false);
  const [showReason, setShowReason] = useState(false);
  const [showReclassify, setShowReclassify] = useState(false);
  // Task 13 / M4：隐藏时可选「同时提交给管理员审阅」（仅 role=user 显示）
  const [submitChecked, setSubmitChecked] = useState(false);
  const [submitNote, setSubmitNote] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setShowReason(false);
        setShowReclassify(false);
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

  const startHide = (e) => {
    e.stopPropagation();
    setOpen(false);
    setShowReason(true);
  };

  const startReclassify = (e) => {
    e.stopPropagation();
    setOpen(false);
    setShowReclassify(true);
  };

  const confirmHide = (reason) => {
    onHide(reason);
    if (submitChecked && onSubmitToAdmin) onSubmitToAdmin(reason, submitNote.trim() || undefined);
    setSubmitChecked(false);
    setSubmitNote("");
    setShowReason(false);
  };

  const confirmReclassify = (purpose) => {
    onReclassify(purpose);
    setShowReclassify(false);
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
          <button
            onClick={(e) => { e.stopPropagation(); onAiInterpret(); setOpen(false); }}
            style={menuItemStyle}
          >
            {t.competitiveIntelligence.aiInterpret}
          </button>
          <button onClick={startReclassify} style={menuItemStyle}>
            {t.competitiveIntelligence.reclassify}
          </button>
          <button onClick={startHide} style={menuItemStyle}>
            {t.competitiveIntelligence.hide}
          </button>
        </div>
      )}

      {showReason && (
        <HideReasonDialog
          darkMode={darkMode}
          language={language}
          showSubmit={userRole === "user" && Boolean(onSubmitToAdmin)}
          submitChecked={submitChecked}
          onToggleSubmit={(v) => setSubmitChecked(v)}
          submitNote={submitNote}
          onNoteChange={setSubmitNote}
          onPick={(reason) => confirmHide(reason)}
          onCancel={() => setShowReason(false)}
        />
      )}
      {showReclassify && (
        <div style={{
          position: "absolute",
          top: 32,
          right: 0,
          minWidth: 180,
          background: darkMode ? COLORS.background.cardDark : "#fff",
          border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
          borderRadius: BORDER_RADIUS.md,
          boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
          zIndex: 25,
          padding: "8px 0"
        }}>
          <div style={{ padding: "8px 14px", fontSize: FONT_SIZES.sm, color: darkMode ? "#aaa" : COLORS.text.light }}>
            {language === "zh" ? "归为哪个监控类别？" : "Reclassify to:"}
          </div>
          {PURPOSES.map(p => (
            <button
              key={p.key}
              onClick={(e) => { e.stopPropagation(); confirmReclassify(p.key); }}
              style={menuItemStyle}
            >
              {p.label[language] || p.label.en}
              {currentPurpose === p.key ? " ✓" : ""}
            </button>
          ))}
          <button onClick={(e) => { e.stopPropagation(); setShowReclassify(false); }} style={menuItemStyle}>
            {language === "zh" ? "取消" : "Cancel"}
          </button>
        </div>
      )}
    </div>
  );
}

// 隐藏原因弹层（Task 13 抽出为纯展示组件，给静态渲染测试观察）。
// showSubmit=false（admin 或回调缺失）时 checkbox 与说明输入整组不渲染 —— 这个「条件渲染」
// 是 admin/user 角色差异的观察点，不许改成隐藏样式（visibility 仍会被本测试抓到，display 也一样，
// 但「不渲染」语义最强：markup 里根本没有这个节点）。
export function HideReasonDialog({ darkMode, language, showSubmit, submitChecked, onToggleSubmit, submitNote, onNoteChange, onPick, onCancel }) {
  const t = i18n[language];
  const text = darkMode ? "#e8e8e8" : COLORS.text.primary;
  const muted = darkMode ? "#aaa" : COLORS.text.light;
  const item = {
    display: "block", width: "100%", padding: "8px 14px", border: "none", background: "transparent",
    color: text, fontSize: FONT_SIZES.md, textAlign: "left", cursor: "pointer"
  };
  return (
    <div style={{
      position: "absolute", top: 32, right: 0, minWidth: 220,
      background: darkMode ? COLORS.background.cardDark : "#fff",
      border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
      borderRadius: BORDER_RADIUS.md, boxShadow: "0 4px 12px rgba(0,0,0,0.12)", zIndex: 25, padding: "8px 0"
    }}>
      <div style={{ padding: "8px 14px", fontSize: FONT_SIZES.sm, color: muted }}>
        {language === "zh" ? "为什么隐藏？" : "Why hide?"}
      </div>
      {HIDE_REASONS.map((r) => (
        <button key={r.key} onClick={(e) => { e.stopPropagation(); onPick(r.key); }} style={item}>
          {r.label[language] || r.label.en}
        </button>
      ))}

      {showSubmit && (
        <div style={{ padding: "8px 14px", borderTop: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`, marginTop: 4 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: FONT_SIZES.sm, color: text, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={submitChecked}
              onChange={(e) => onToggleSubmit(e.target.checked)}
              aria-label={t.competitiveIntelligence.submitToAdmin}
            />
            {t.competitiveIntelligence.submitToAdmin}
          </label>
          {submitChecked && (
            <input
              value={submitNote}
              onChange={(e) => onNoteChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              placeholder={t.competitiveIntelligence.submitNotePlaceholder}
              aria-label={t.competitiveIntelligence.submitNotePlaceholder}
              style={{
                marginTop: 6, width: "100%", boxSizing: "border-box",
                padding: "6px 8px", borderRadius: BORDER_RADIUS.sm, fontSize: FONT_SIZES.sm,
                border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
                background: darkMode ? "#141722" : "#fff", color: text, outline: "none"
              }}
            />
          )}
        </div>
      )}

      <button onClick={(e) => { e.stopPropagation(); onCancel(); }} style={item}>
        {language === "zh" ? "取消" : "Cancel"}
      </button>
    </div>
  );
}
