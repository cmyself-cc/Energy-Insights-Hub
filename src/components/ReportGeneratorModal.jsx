import { useEffect, useState } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS } from "../constants/theme";
import { backendApi } from "../utils/backendApi";

export default function ReportGeneratorModal({ darkMode, language, templates, cart, onClose, onStarted, onTemplatesChanged }) {
  const zh = language === "zh";
  const [step, setStep] = useState("loading"); // loading/quality/purpose/audience/template/confirm
  const [screening, setScreening] = useState(null);
  const [cards, setCards] = useState(cart || []);
  const [choices, setChoices] = useState([]);          // 质量问题的处理选择
  const [purpose, setPurpose] = useState("");
  const [audience, setAudience] = useState("");
  const [templateMode, setTemplateMode] = useState("public"); // public/custom/manual
  const [templateId, setTemplateId] = useState(null);
  const [manualForm, setManualForm] = useState({ topic: "", framework: "", outline: "", conclusion: "" });
  const [manualPrompt, setManualPrompt] = useState(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const cardBg = darkMode ? COLORS.background.cardDark : COLORS.background.card;
  const border = darkMode ? COLORS.border.dark : COLORS.border.light;
  const text = darkMode ? "#e8e8e8" : COLORS.text.primary;
  const secondary = darkMode ? "#aaa" : COLORS.text.secondary;
  const inputStyle = { padding: "8px 12px", borderRadius: BORDER_RADIUS.md, border: `1px solid ${border}`, background: darkMode ? "#1c1f2b" : "#fff", color: text, fontSize: FONT_SIZES.base, outline: "none", width: "100%", boxSizing: "border-box" };
  const btn = (primary, disabled) => ({ padding: "8px 16px", borderRadius: BORDER_RADIUS.md, background: disabled ? "#aaa" : (primary ? COLORS.primary : "transparent"), color: primary ? "#fff" : text, fontSize: FONT_SIZES.sm, cursor: disabled ? "not-allowed" : "pointer", border: primary ? "none" : `1px solid ${border}` });
  const tabStyle = (active) => ({ padding: "6px 14px", borderRadius: BORDER_RADIUS.md, border: `1px solid ${active ? COLORS.primary : border}`, background: active ? COLORS.primaryLight : "transparent", color: active ? COLORS.primary : (darkMode ? "#e8e8e8" : COLORS.text.primary), fontSize: FONT_SIZES.sm, cursor: "pointer", fontWeight: active ? 600 : 400 });

  const cardIds = () => cards.map(c => c.id).filter(Boolean);

  const runScreening = async (ids) => {
    setBusy(true); setError(null);
    try {
      const t = templates[0];
      const res = await backendApi.screenReport(t.id, ids);
      setScreening(res.data);
      setPurpose(res.data.purpose || "");
      setAudience(res.data.audience || "");
      setChoices((res.data.quality || []).map(q => q.suggested || (q.options || [])[0] || ""));
      setStep("quality");
    } catch (e) { setError(e.message); setStep("quality"); }
    setBusy(false);
  };

  useEffect(() => {
    if (templates.length > 0) runScreening(cardIds());
    else { setStep("quality"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeCard = (id) => setCards(prev => prev.filter(c => c.id !== id));

  const reScreen = () => runScreening(cardIds());

  const genManualPrompt = async () => {
    setManualBusy(true); setError(null);
    try {
      const res = await backendApi.generateReportPrompt({ ...manualForm, language });
      setManualPrompt(res.data.prompt);
    } catch (e) { setError(e.message); }
    setManualBusy(false);
  };

  const confirmManualTemplate = async () => {
    if (!manualPrompt) return;
    setBusy(true); setError(null);
    try {
      const name = manualForm.topic?.trim() || (zh ? "自定义报告" : "Custom report");
      const created = await backendApi.createReportTemplate({ name, description: manualForm.framework || "", purpose, prompt: manualPrompt, max_cards: 10, language: zh ? "zh" : "en", is_public: 0 });
      setTemplateId(created.data.id);
      onTemplatesChanged?.();
      setStep("confirm");
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const resolutions = (screening?.quality || []).map((q, i) => ({ issue: q.issue, cardIds: q.cardIds, choice: choices[i] }));
      await backendApi.generateReport(templateId, cardIds(), resolutions, purpose, audience);
      onStarted?.();
      onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  };

  const modalStyle = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 };
  const cardStyle = { background: cardBg, border, borderRadius: BORDER_RADIUS.lg, padding: 24, maxWidth: 680, width: "100%", maxHeight: "82vh", overflowY: "auto" };
  const stepBar = ["quality", "purpose", "audience", "template", "confirm"];
  const stepIndex = stepBar.indexOf(step);
  const stepNames = zh ? ["卡片筛查", "报告用途", "读者受众", "模板", "确认"] : ["Cards", "Purpose", "Audience", "Template", "Confirm"];
  const selTemplate = templates.find(t => t.id === templateId);

  return (
    <div style={modalStyle}>
      <div style={cardStyle}>
        <h3 style={{ margin: "0 0 14px", color: text }}>{zh ? "生成报告" : "Generate Report"}</h3>

        {step !== "loading" && (
          <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
            {stepNames.map((name, i) => (
              <span key={name} style={{
                fontSize: FONT_SIZES.xs, padding: "3px 10px", borderRadius: 12,
                background: i === stepIndex ? COLORS.primary : (i < stepIndex ? COLORS.primaryLight : (darkMode ? "#222" : "#f0f0f0")),
                color: i === stepIndex ? "#fff" : (i < stepIndex ? COLORS.primary : secondary),
                fontWeight: i === stepIndex ? 700 : 500
              }}>{i + 1} {name}</span>
            ))}
          </div>
        )}

        {step === "loading" && <p style={{ color: secondary }}>{zh ? "正在筛查卡片..." : "Screening cards..."}</p>}

        {step === "quality" && (
          <>
            <p style={{ margin: "0 0 8px", fontSize: FONT_SIZES.sm, color: secondary }}>
              {zh ? "已选卡片（点击 × 移除后点「重新筛查」）：" : "Selected cards (click × to remove, then re-screen):"}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              {cards.map(c => (
                <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: darkMode ? "#1c1f2b" : "#f0f0f0", border: `1px solid ${border}`, borderRadius: 12, padding: "2px 8px", fontSize: FONT_SIZES.xs, color: text }}>
                  {c.title?.slice(0, 18)}{c.title?.length > 18 ? "…" : ""}
                  <span onClick={() => removeCard(c.id)} style={{ cursor: "pointer", color: "#c00", fontWeight: 700, padding: "0 2px" }}>×</span>
                </span>
              ))}
            </div>

            {(screening?.quality || []).length > 0 && (
              <div style={{ background: "#fff8e6", border: "1px solid #e6c300", borderRadius: BORDER_RADIUS.md, padding: "10px 14px", marginBottom: 12, fontSize: FONT_SIZES.sm, color: "#8a6d00" }}>
                {zh
                  ? "⚠️ 检测到输入卡片可能存在数据质量问题（矛盾/重复/不相关），可能影响生成效果，请确认以下处理方式："
                  : "⚠️ Input cards may have data quality issues (conflicts/duplicates/irrelevant) that could affect the report. Please confirm how to handle them:"}
              </div>
            )}
            {(screening?.quality || []).length === 0 && (
              <p style={{ fontSize: FONT_SIZES.sm, color: secondary, margin: "0 0 12px" }}>{zh ? "未发现矛盾/重复/不相关问题。" : "No conflicts, duplicates or irrelevant cards detected."}</p>
            )}
            {(screening?.quality || []).map((q, i) => (
              <div key={i} style={{ border: `1px solid ${border}`, borderRadius: BORDER_RADIUS.md, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: FONT_SIZES.sm, color: text, fontWeight: 600, marginBottom: 8 }}>
                  {q.kind === "contradiction" ? (zh ? "矛盾" : "Conflict") : q.kind === "duplicate" ? (zh ? "重复" : "Duplicate") : (zh ? "不相关" : "Irrelevant")} · {q.issue}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(q.options || []).map(opt => (
                    <button key={opt} onClick={() => setChoices(prev => prev.map((v, j) => j === i ? opt : v))} style={tabStyle(choices[i] === opt)}>{opt}</button>
                  ))}
                </div>
              </div>
            ))}
            {screening?.exceedsLimit && (
              <div style={{ background: "#fff8e6", border: "1px solid #e6c300", borderRadius: BORDER_RADIUS.md, padding: "10px 14px", marginBottom: 12, fontSize: FONT_SIZES.sm, color: "#8a6d00" }}>
                {zh ? "卡片数超过模板上限，生成时将只取前若干张。" : "Card count exceeds the template limit; only the first cards will be used."}
              </div>
            )}
            {error && <ErrorBox text={error} />}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button style={btn(false)} onClick={reScreen} disabled={busy}>{zh ? "重新筛查" : "Re-screen"}</button>
              <button style={btn(true, cards.length === 0)} onClick={() => setStep("purpose")} disabled={busy || cards.length === 0}>{zh ? "继续" : "Continue"}</button>
            </div>
          </>
        )}

        {step === "purpose" && (
          <>
            <p style={{ margin: "0 0 10px", fontSize: FONT_SIZES.sm, color: secondary }}>{zh ? "根据卡片信息推测的报告用途，请确认或手动输入：" : "Inferred purpose based on cards. Confirm or type your own:"}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {(screening?.purposeOptions || []).map(opt => (
                <button key={opt} onClick={() => setPurpose(opt)} style={tabStyle(purpose === opt)}>{opt}</button>
              ))}
            </div>
            <input style={inputStyle} value={purpose} onChange={e => setPurpose(e.target.value)} placeholder={zh ? "或手动输入报告用途..." : "Or type the report purpose..."} />
            {error && <ErrorBox text={error} />}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button style={btn(false)} onClick={() => setStep("quality")}>{zh ? "上一步" : "Back"}</button>
              <button style={btn(true, !purpose.trim())} onClick={() => setStep("audience")} disabled={!purpose.trim()}>{zh ? "下一步" : "Next"}</button>
            </div>
          </>
        )}

        {step === "audience" && (
          <>
            <p style={{ margin: "0 0 10px", fontSize: FONT_SIZES.sm, color: secondary }}>{zh ? "报告的读者/受众，请确认或手动输入：" : "Report audience. Confirm or type your own:"}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {(screening?.audienceOptions || []).map(opt => (
                <button key={opt} onClick={() => setAudience(opt)} style={tabStyle(audience === opt)}>{opt}</button>
              ))}
            </div>
            <input style={inputStyle} value={audience} onChange={e => setAudience(e.target.value)} placeholder={zh ? "或手动输入读者/受众..." : "Or type the audience..."} />
            {error && <ErrorBox text={error} />}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button style={btn(false)} onClick={() => setStep("purpose")}>{zh ? "上一步" : "Back"}</button>
              <button style={btn(true, !audience.trim())} onClick={() => setStep("template")} disabled={!audience.trim()}>{zh ? "下一步" : "Next"}</button>
            </div>
          </>
        )}

        {step === "template" && (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              <button style={tabStyle(templateMode === "public")} onClick={() => setTemplateMode("public")}>{zh ? "公用模板" : "Public"}</button>
              <button style={tabStyle(templateMode === "custom")} onClick={() => setTemplateMode("custom")}>{zh ? "自定义模板" : "Custom"}</button>
              <button style={tabStyle(templateMode === "manual")} onClick={() => setTemplateMode("manual")}>{zh ? "手动输入，AI 生成" : "Manual + AI prompt"}</button>
            </div>

            {templateMode !== "manual" && (
              <div>
                {(templateMode === "public" ? templates.filter(t => t.is_public === true) : templates.filter(t => t.is_public !== true)).map(t => (
                  <div key={t.id} onClick={() => setTemplateId(t.id)} style={{
                    border: `1px solid ${templateId === t.id ? COLORS.primary : border}`,
                    background: templateId === t.id ? COLORS.primaryLight : "transparent",
                    borderRadius: BORDER_RADIUS.md, padding: "12px 16px", marginBottom: 10, cursor: "pointer"
                  }}>
                    <div style={{ fontWeight: 600, color: text, fontSize: FONT_SIZES.base }}>
                      {t.name} <span style={{ fontSize: 11, color: secondary }}>{zh ? `上限 ${t.max_cards} 张` : `max ${t.max_cards}`}</span>
                    </div>
                    <div style={{ fontSize: FONT_SIZES.sm, color: secondary, marginTop: 4 }}>{t.description || t.prompt.slice(0, 60)}</div>
                  </div>
                ))}
                {templateId && cards.length > (selTemplate?.max_cards || 10) && (
                  <div style={{ background: "#fff8e6", border: "1px solid #e6c300", borderRadius: BORDER_RADIUS.md, padding: "10px 14px", marginBottom: 12, fontSize: FONT_SIZES.sm, color: "#8a6d00" }}>
                    {zh ? `已选 ${cards.length} 张卡片，超过该模板上限 ${selTemplate?.max_cards} 张，生成时只取前 ${selTemplate?.max_cards} 张。` : `Selected ${cards.length} cards exceed this template's limit of ${selTemplate?.max_cards}; only the first will be used.`}
                  </div>
                )}
              </div>
            )}

            {templateMode === "manual" && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={{ display: "block", fontSize: FONT_SIZES.sm, color: secondary, marginBottom: 4 }}>{zh ? "主题" : "Topic"}</label>
                    <input style={inputStyle} value={manualForm.topic} onChange={e => setManualForm({ ...manualForm, topic: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: FONT_SIZES.sm, color: secondary, marginBottom: 4 }}>{zh ? "框架" : "Framework"}</label>
                    <input style={inputStyle} value={manualForm.framework} onChange={e => setManualForm({ ...manualForm, framework: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: FONT_SIZES.sm, color: secondary, marginBottom: 4 }}>{zh ? "大纲" : "Outline"}</label>
                    <input style={inputStyle} value={manualForm.outline} onChange={e => setManualForm({ ...manualForm, outline: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: FONT_SIZES.sm, color: secondary, marginBottom: 4 }}>{zh ? "核心结论" : "Core conclusion"}</label>
                    <input style={inputStyle} value={manualForm.conclusion} onChange={e => setManualForm({ ...manualForm, conclusion: e.target.value })} />
                  </div>
                </div>
                <button style={btn(true, manualBusy)} onClick={genManualPrompt} disabled={manualBusy}>
                  {manualBusy ? (zh ? "AI 生成中..." : "Generating...") : (zh ? "AI 生成提示词模板" : "Generate prompt with AI")}
                </button>
                {manualPrompt && (
                  <div style={{ marginTop: 10 }}>
                    <textarea style={{ ...inputStyle, minHeight: 120, resize: "vertical", fontFamily: "monospace", fontSize: 13 }} value={manualPrompt} onChange={e => setManualPrompt(e.target.value)} />
                  </div>
                )}
              </div>
            )}

            {error && <ErrorBox text={error} />}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button style={btn(false)} onClick={() => setStep("audience")}>{zh ? "上一步" : "Back"}</button>
              {templateMode === "manual" ? (
                <button style={btn(true, !manualPrompt || busy)} onClick={confirmManualTemplate} disabled={!manualPrompt || busy}>
                  {zh ? "确认并保存为模板" : "Confirm & Save Template"}
                </button>
              ) : (
                <button style={btn(true, !templateId)} onClick={() => setStep("confirm")} disabled={!templateId}>{zh ? "下一步" : "Next"}</button>
              )}
            </div>
          </>
        )}

        {step === "confirm" && (
          <>
            <div style={{ border: `1px solid ${border}`, borderRadius: BORDER_RADIUS.md, padding: 14, marginBottom: 14, fontSize: FONT_SIZES.sm, color: text }}>
              <div style={{ marginBottom: 4 }}><strong>{zh ? "报告用途：" : "Purpose: "}</strong>{purpose}</div>
              <div style={{ marginBottom: 4 }}><strong>{zh ? "读者受众：" : "Audience: "}</strong>{audience}</div>
              <div style={{ marginBottom: 4 }}><strong>{zh ? "模板：" : "Template: "}</strong>{templateMode === "manual" ? (manualForm.topic || zh ? "自定义（AI 生成提示词）" : "Custom (AI prompt)") : (selTemplate?.name || "")}</div>
              <div><strong>{zh ? "卡片：" : "Cards: "}</strong>{cards.length} 张</div>
              {(screening?.quality || []).length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <strong>{zh ? "处理决定：" : "Resolutions: "}</strong>
                  {(screening.quality || []).map((q, i) => (
                    <div key={i} style={{ marginTop: 2 }}>· {q.issue} → {choices[i]}</div>
                  ))}
                </div>
              )}
            </div>
            {error && <ErrorBox text={error} />}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button style={btn(false)} onClick={() => setStep("template")}>{zh ? "上一步" : "Back"}</button>
              <button style={btn(true, busy)} onClick={submit} disabled={busy}>{busy ? (zh ? "提交中..." : "Submitting...") : (zh ? "开始生成" : "Generate")}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ErrorBox({ text }) { return <div style={{ background: "#fff0f0", border: "1px solid #fcc", borderRadius: BORDER_RADIUS.md, padding: "10px 14px", color: "#c00", fontSize: FONT_SIZES.sm, marginTop: 12 }}>{text}</div>; }
