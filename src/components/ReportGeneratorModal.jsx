import { useEffect, useRef, useState } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS } from "../constants/theme";
import { backendApi } from "../utils/backendApi";

const MAX_ROUNDS = 3;

export default function ReportGeneratorModal({ darkMode, language, templates, cart, onClose, onDone, onOpenReports }) {
  const zh = language === "zh";
  const [step, setStep] = useState("pick");
  const [templateId, setTemplateId] = useState(null);
  const [screening, setScreening] = useState(null);
  const [questions, setQuestions] = useState([]);          // 当前轮问题
  const [answers, setAnswers] = useState([]);              // 当前轮回答 {key, issue, choice, cardIds}
  const [round, setRound] = useState(1);
  const [resolutions, setResolutions] = useState([]);      // 累计澄清结果
  const [purpose, setPurpose] = useState("");
  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef(null);

  const cardBg = darkMode ? COLORS.background.cardDark : COLORS.background.card;
  const border = darkMode ? COLORS.border.dark : COLORS.border.light;
  const text = darkMode ? "#e8e8e8" : COLORS.text.primary;
  const secondary = darkMode ? "#aaa" : COLORS.text.secondary;

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => stopPolling, []);

  const cardIds = () => cart.map(c => c.id).filter(Boolean);

  const pickTemplate = async (t) => {
    setTemplateId(t.id); setBusy(true); setError(null); setRound(1); setResolutions([]);
    try {
      const res = await backendApi.screenReport(t.id, cardIds());
      setScreening(res.data);
      setPurpose(res.data.purpose || "");
      setQuestions(res.data.questions || []);
      setAnswers((res.data.questions || []).map(q => ({ key: q.key, issue: q.issue, choice: q.suggested || (q.options || [])[0] || "", cardIds: q.cardIds || [] })));
      setStep(res.data.questions && res.data.questions.length > 0 ? "screen" : "confirm");
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const setAnswerChoice = (index, choice) => {
    setAnswers(prev => prev.map((a, i) => i === index ? { ...a, choice } : a));
  };

  // 提交当前轮回答 → LLM 决定继续追问还是完成
  const nextRound = async () => {
    setBusy(true); setError(null);
    try {
      const res = await backendApi.clarifyReport(templateId, cardIds(), answers);
      setResolutions(res.data.resolutions || []);
      setPurpose(res.data.purpose || purpose);
      if (res.data.done || round >= MAX_ROUNDS) {
        setStep("confirm");
      } else {
        setQuestions(res.data.questions || []);
        setAnswers((res.data.questions || []).map(q => ({ key: q.key, issue: q.issue, choice: q.suggested || (q.options || [])[0] || "", cardIds: q.cardIds || [] })));
        setRound(r => r + 1);
      }
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const merged = resolutions.length > 0
        ? resolutions.map(r => ({ issue: r.issue, cardIds: r.cardIds, choice: r.choice }))
        : answers.map(a => ({ issue: a.issue, cardIds: a.cardIds, choice: a.choice }));
      const res = await backendApi.generateReport(templateId, cardIds(), merged);
      setJobId(res.data.id); setStep("progress");
      pollRef.current = setInterval(async () => {
        try {
          const jr = await backendApi.getReportJob(res.data.id);
          setJob(jr.data);
          if (jr.data.status === "done" || jr.data.status === "failed") { stopPolling(); setStep("done"); }
        } catch { /* keep polling */ }
      }, 3000);
    } catch (e) { setError(e.message); setBusy(false); }
  };

  const retry = async () => {
    setBusy(true); setError(null);
    try {
      await backendApi.retryReportJob(jobId);
      setJob({ ...job, status: "queued", phase: "queued", progress: 0, error: null });
      setStep("progress");
      pollRef.current = setInterval(async () => {
        try {
          const jr = await backendApi.getReportJob(jobId);
          setJob(jr.data);
          if (jr.data.status === "done" || jr.data.status === "failed") { stopPolling(); setStep("done"); }
        } catch { /* keep polling */ }
      }, 3000);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const modalStyle = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 };
  const cardStyle = { background: cardBg, border, borderRadius: BORDER_RADIUS.lg, padding: 24, maxWidth: 640, width: "100%", maxHeight: "80vh", overflowY: "auto" };
  const btn = (primary) => ({ padding: "8px 16px", borderRadius: BORDER_RADIUS.md, background: primary ? COLORS.primary : "transparent", color: primary ? "#fff" : text, fontSize: FONT_SIZES.sm, cursor: "pointer", border: primary ? "none" : `1px solid ${border}` });
  const inputStyle = { padding: "8px 12px", borderRadius: BORDER_RADIUS.md, border: `1px solid ${border}`, background: darkMode ? "#1c1f2b" : "#fff", color: text, fontSize: FONT_SIZES.base, outline: "none", width: "100%", boxSizing: "border-box" };

  return (
    <div style={modalStyle}>
      <div style={cardStyle}>
        <h3 style={{ margin: "0 0 16px", color: text }}>{zh ? "生成报告" : "Generate Report"}</h3>

        {step === "pick" && (
          <>
            <p style={{ margin: "0 0 12px", fontSize: FONT_SIZES.sm, color: secondary }}>
              {zh ? `已选 ${cart.length} 张卡片，请选择报告模板：` : `Selected ${cart.length} card(s). Choose a template:`}
            </p>
            {templates.filter(t => t.is_public === true).length > 0 && <SectionLabel text={zh ? "公用模板" : "Public templates"} />}
            {templates.filter(t => t.is_public === true).map(t => (
              <TemplateRow key={t.id} t={t} zh={zh} disabled={busy} onPick={() => pickTemplate(t)} border={border} text={text} secondary={secondary} />
            ))}
            {templates.filter(t => t.is_public !== true).length > 0 && <SectionLabel text={zh ? "自定义模板" : "Custom templates"} />}
            {templates.filter(t => t.is_public !== true).map(t => (
              <TemplateRow key={t.id} t={t} zh={zh} disabled={busy} onPick={() => pickTemplate(t)} border={border} text={text} secondary={secondary} />
            ))}
            {error && <ErrorBox text={error} />}
          </>
        )}

        {step === "screen" && (
          <>
            <p style={{ margin: "0 0 10px", fontSize: FONT_SIZES.sm, color: secondary }}>
              {zh ? `第 ${round} 轮澄清：AI 需要你确认以下问题` : `Round ${round}: AI needs your confirmation`}
            </p>
            {screening?.exceedsLimit && (
              <div style={{ background: "#fff8e6", border: "1px solid #e6c300", borderRadius: BORDER_RADIUS.md, padding: "10px 14px", marginBottom: 12, fontSize: FONT_SIZES.sm, color: "#8a6d00" }}>
                {zh ? "卡片数超过该模板上限，生成时将只取前若干张。" : "Card count exceeds the template limit; only the first cards will be used."}
              </div>
            )}
            {questions.length === 0 ? (
              <p style={{ fontSize: FONT_SIZES.sm, color: secondary, margin: "0 0 12px" }}>{zh ? "本轮无需再澄清。" : "No further clarification needed."}</p>
            ) : questions.map((q, i) => (
              <div key={q.key || i} style={{ border: `1px solid ${border}`, borderRadius: BORDER_RADIUS.md, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: FONT_SIZES.sm, color: text, fontWeight: 600, marginBottom: 8 }}>{q.issue}</div>
                {(q.options || []).map(opt => (
                  <label key={opt} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: FONT_SIZES.sm, color: text, marginBottom: 4, cursor: "pointer" }}>
                    <input type="radio" name={`q-${i}`} checked={answers[i]?.choice === opt} onChange={() => setAnswerChoice(i, opt)} style={{ width: 14, height: 14, cursor: "pointer" }} />
                    {opt}
                  </label>
                ))}
                <input
                  style={{ ...inputStyle, marginTop: 6, fontSize: FONT_SIZES.sm }}
                  placeholder={zh ? "或直接输入你的回答…" : "Or type your answer…"}
                  value={answers[i]?.choice || ""}
                  onChange={e => setAnswerChoice(i, e.target.value)}
                />
              </div>
            ))}
            {error && <ErrorBox text={error} />}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button style={btn(false)} onClick={() => setStep("pick")} disabled={busy}>{zh ? "返回" : "Back"}</button>
              <button style={btn(true)} onClick={nextRound} disabled={busy}>
                {busy ? (zh ? "分析中..." : "Analyzing...") : (zh ? `确认并${round >= MAX_ROUNDS ? "生成" : "继续"}（第 ${Math.min(round + 1, MAX_ROUNDS)}/${MAX_ROUNDS} 轮）` : "Confirm")}
              </button>
            </div>
          </>
        )}

        {step === "confirm" && (
          <>
            <p style={{ margin: "0 0 8px", fontSize: FONT_SIZES.sm, color: secondary }}>{zh ? "报告用途（可修改）：" : "Report purpose (editable):"}</p>
            <input style={{ ...inputStyle, marginBottom: 14 }} value={purpose} onChange={e => setPurpose(e.target.value)} />
            {resolutions.length > 0 && (
              <div style={{ border: `1px solid ${border}`, borderRadius: BORDER_RADIUS.md, padding: 12, marginBottom: 14 }}>
                <div style={{ fontSize: FONT_SIZES.sm, fontWeight: 600, color: text, marginBottom: 6 }}>{zh ? "澄清结果" : "Clarifications"}</div>
                {resolutions.map((r, i) => (
                  <div key={i} style={{ fontSize: FONT_SIZES.sm, color: secondary, marginBottom: 2 }}>
                    · {r.issue} → <strong style={{ color: text }}>{r.choice}</strong>
                  </div>
                ))}
              </div>
            )}
            {error && <ErrorBox text={error} />}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button style={btn(false)} onClick={() => setStep("screen")} disabled={busy}>{zh ? "返回" : "Back"}</button>
              <button style={btn(true)} onClick={submit} disabled={busy}>{busy ? (zh ? "提交中..." : "Submitting...") : (zh ? "生成报告" : "Generate")}</button>
            </div>
          </>
        )}

        {step === "progress" && (
          <div>
            <p style={{ color: text, margin: "0 0 12px" }}>
              {zh ? `生成中：${phaseLabel(job?.phase, zh)}（${job?.progress ?? 0}%）` : `Generating: ${phaseLabel(job?.phase, false)} (${job?.progress ?? 0}%)`}
            </p>
            <div style={{ background: darkMode ? "#333" : "#eee", borderRadius: BORDER_RADIUS.sm, height: 8, overflow: "hidden" }}>
              <div style={{ width: `${job?.progress ?? 0}%`, height: "100%", background: COLORS.primary, transition: "width .5s" }} />
            </div>
            {job?.notes && <p style={{ fontSize: FONT_SIZES.sm, color: secondary, marginTop: 8 }}>{job.notes}</p>}
          </div>
        )}

        {step === "done" && (
          <div>
            {job?.status === "done" ? (
              <p style={{ color: text, margin: "0 0 12px" }}>{zh ? "报告已生成！" : "Report generated!"}</p>
            ) : (
              <p style={{ color: "#c00", margin: "0 0 12px" }}>{zh ? `生成失败：${job?.error || "未知错误"}` : `Failed: ${job?.error || "unknown error"}`}</p>
            )}
            {error && <ErrorBox text={error} />}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={btn(false)} onClick={onClose}>{zh ? "关闭" : "Close"}</button>
              {job?.status === "done" && <button style={btn(true)} onClick={() => { onDone?.(job.report_id); onOpenReports?.(); }}>{zh ? "查看报告" : "View Report"}</button>}
              {job?.status === "failed" && <button style={btn(true)} onClick={retry} disabled={busy}>{zh ? "重试" : "Retry"}</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function phaseLabel(phase, zh) {
  const map = { queued: ["排队中", "Queued"], searching: ["检索资料中", "Searching"], summarizing: ["AI 总结中", "Summarizing"], done: ["完成", "Done"], failed: ["失败", "Failed"] };
  return (map[phase] || ["处理中", "Processing"])[zh ? 0 : 1];
}
function SectionLabel({ text }) { return <div style={{ fontSize: FONT_SIZES.sm, fontWeight: 700, color: "#666", margin: "10px 0 6px" }}>{text}</div>; }
function ErrorBox({ text }) { return <div style={{ background: "#fff0f0", border: "1px solid #fcc", borderRadius: BORDER_RADIUS.md, padding: "10px 14px", color: "#c00", fontSize: FONT_SIZES.sm, marginTop: 12 }}>{text}</div>; }
function TemplateRow({ t, zh, disabled, onPick, border, text, secondary }) {
  return (
    <div key={t.id} style={{ border: `1px solid ${border}`, borderRadius: BORDER_RADIUS.md, padding: "12px 16px", marginBottom: 10, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1 }} onClick={disabled ? undefined : onPick}>
      <div style={{ fontWeight: 600, color: text, fontSize: FONT_SIZES.base }}>{t.name} <span style={{ fontSize: 11, color: secondary }}>{zh ? `上限 ${t.max_cards} 张` : `max ${t.max_cards} cards`}</span></div>
      <div style={{ fontSize: FONT_SIZES.sm, color: secondary, marginTop: 4 }}>{t.description || "—"}</div>
    </div>
  );
}
