import { useState, useRef, useEffect } from "react";
import { Marked } from "marked";
import { COLORS, FONT_SIZES, BORDER_RADIUS } from "../constants/theme";
import { i18n } from "../constants/i18n";
import { api } from "../utils/api";
import { backendApi } from "../utils/backendApi";

const DISCLAIMER_KEY = "energy_insights_ai_disclaimer_accepted";

// AI 解读专用的 markdown 渲染实例（避免全局 marked 被污染，影响报告页/PDF 导出）
const aiMarked = new Marked();
aiMarked.use({
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const s = {
        1: { size: 20, margin: "24px 0 10px" },
        2: { size: 18, margin: "20px 0 8px" },
        3: { size: 16, margin: "16px 0 6px" },
        4: { size: 14, margin: "12px 0 5px" }
      }[depth] || { size: 14, margin: "12px 0 5px" };
      return `<h${depth} style="margin:${s.margin};font-size:${s.size}px;font-weight:700;line-height:1.5">${text}</h${depth}>`;
    },
    list({ ordered, items }) {
      const tag = ordered ? "ol" : "ul";
      const inner = items.map(item => {
        const content = this.parser.parse(item.tokens);
        return `<li style="margin:2px 0;padding-left:4px">${content}</li>`;
      }).join("");
      return `<${tag} style="padding-left:26px;margin:6px 0;list-style:${ordered ? "decimal" : "disc"};${ordered ? "list-style-position:inside" : ""}">${inner}</${tag}>`;
    },
    paragraph({ tokens }) {
      const text = this.parser.parseInline(tokens);
      return `<p style="margin:6px 0;line-height:1.6">${text}</p>`;
    }
  }
});

export default function AiDrawer({ item, darkMode, language, onClose }) {
  const t = i18n[language];
  const [showDisclaimer, setShowDisclaimer] = useState(() => {
    try {
      return localStorage.getItem(DISCLAIMER_KEY) !== "true";
    } catch {
      return true;
    }
  });
  const [interpretation, setInterpretation] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState([]);
  const [presets, setPresets] = useState([]);

  useEffect(() => {
    backendApi.getAiPresets().then(res => {
      const data = res.data;
      if (Array.isArray(data) && data.length > 0) {
        setPresets(data);
        localStorage.setItem("ai_presets", JSON.stringify(data));
      } else {
        setPresets(JSON.parse(localStorage.getItem("ai_presets") || "[]"));
      }
    }).catch(() => {
      setPresets(JSON.parse(localStorage.getItem("ai_presets") || "[]"));
    });
  }, []);
  const abortRef = useRef(null);
  const contentRef = useRef(null);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [interpretation, history, generating]);

  const acceptDisclaimer = () => {
    try {
      localStorage.setItem(DISCLAIMER_KEY, "true");
    } catch {
      // ignore
    }
    setShowDisclaimer(false);
  };

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setGenerating(false);
  };

  const generateInterpretation = async (q = "") => {
    setError(null);
    setGenerating(true);
    abortRef.current = new AbortController();

    try {
      // ai_model_id 存的是服务器模型配置的 id（localStorage），服务器端用该模型解读
      const modelId = localStorage.getItem("ai_model_id") || "";
      const result = await api.interpretArticle(item, q, language, history, abortRef.current.signal, modelId || null);
      if (q) {
        setHistory(prev => [...prev, { question: q, answer: result }]);
      } else {
        setInterpretation(result);
      }
    } catch (e) {
      if (e.name === "AbortError") {
        setError(language === "zh" ? "生成已停止" : "Generation stopped");
      } else {
        setError(e.message || (language === "zh" ? "解读失败" : "Interpretation failed"));
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  };

  const renderMarkdown = (text) => {
    if (!text) return "";
    try {
      return aiMarked.parse(text);
    } catch {
      return text;
    }
  };
  const handleAsk = (e) => {
    e.preventDefault();
    if (!question.trim() || generating) return;
    generateInterpretation(question.trim());
    setQuestion("");
  };

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 1000,
      display: "flex",
      justifyContent: "flex-end"
    }}>
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.45)"
        }}
      />
      <div style={{
        position: "relative",
        width: "100%",
        maxWidth: 480,
        height: "100%",
        background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
        boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
        display: "flex",
        flexDirection: "column",
        animation: "slideInRight 0.25s ease"
      }}>
        <div style={{
          padding: "16px 20px",
          borderBottom: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12
        }}>
          <div>
            <div style={{
              fontSize: FONT_SIZES.sm,
              color: darkMode ? "#888" : COLORS.text.light,
              marginBottom: 4
            }}>
              {t.competitiveIntelligence.aiDrawerTitle}
            </div>
            <div style={{
              fontSize: FONT_SIZES.lg,
              fontWeight: 700,
              color: darkMode ? "#fff" : COLORS.text.primary,
              lineHeight: 1.4
            }}>
              {item.title}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              border: "none",
              background: darkMode ? "#2a2d3a" : "#f5f5f5",
              color: darkMode ? "#aaa" : COLORS.text.secondary,
              fontSize: FONT_SIZES.lg,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            ✕
          </button>
        </div>

        <div
          ref={contentRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px"
          }}
        >
          {showDisclaimer ? (
            <div style={{
              background: darkMode ? "#1c1f2b" : "#fff8e6",
              border: `1px solid ${darkMode ? COLORS.border.dark : "#f5c518"}`,
              borderRadius: BORDER_RADIUS.lg,
              padding: "20px"
            }}>
              <div style={{
                fontSize: FONT_SIZES.lg,
                fontWeight: 700,
                color: darkMode ? "#fff" : COLORS.text.primary,
                marginBottom: 12
              }}>
                {t.competitiveIntelligence.aiDisclaimerTitle}
              </div>
              <div style={{
                fontSize: FONT_SIZES.base,
                color: darkMode ? "#bbb" : COLORS.text.secondary,
                lineHeight: 1.7,
                marginBottom: 20
              }}>
                {t.competitiveIntelligence.aiDisclaimerText}
              </div>
              <button
                onClick={acceptDisclaimer}
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: BORDER_RADIUS.md,
                  border: "none",
                  background: COLORS.primary,
                  color: "#fff",
                  fontSize: FONT_SIZES.md,
                  fontWeight: 700,
                  cursor: "pointer"
                }}
              >
                {t.competitiveIntelligence.aiDisclaimerConfirm}
              </button>
            </div>
          ) : (
            <>
              {!interpretation && history.length === 0 && !generating && (
                <div style={{ textAlign: "center", padding: "40px 20px" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 20 }}>
                    {presets.map((p, i) => (
                      <button
                        key={i}
                        onClick={() => generateInterpretation(p)}
                        style={{
                          padding: "8px 14px", borderRadius: BORDER_RADIUS.md,
                          border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
                          background: darkMode ? "#1c1f2b" : "#fff",
                          color: darkMode ? "#ccc" : COLORS.text.secondary,
                          fontSize: FONT_SIZES.sm, cursor: "pointer", maxWidth: 220,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                        }}
                      >{p}</button>
                    ))}
                  </div>
                  <button
                    onClick={() => generateInterpretation()}
                    style={{
                      padding: "10px 20px",
                      borderRadius: BORDER_RADIUS.md,
                      border: "none",
                      background: COLORS.primary,
                      color: "#fff",
                      fontSize: FONT_SIZES.md,
                      fontWeight: 700,
                      cursor: "pointer"
                    }}
                  >
                    {t.competitiveIntelligence.aiGeneratePrompt}
                  </button>
                </div>
              )}

              {interpretation && (
                <div style={{
                  marginBottom: 16,
                  padding: "14px 16px",
                  borderRadius: BORDER_RADIUS.lg,
                  background: darkMode ? "#1c1f2b" : COLORS.primaryLight,
                  color: darkMode ? "#e8e8e8" : COLORS.text.primary,
                  fontSize: FONT_SIZES.base,
                  lineHeight: 1.65
                }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(interpretation) }}
                />
              )}

              {history.map((h, idx) => (
                <div key={idx} style={{ marginBottom: 16 }}>
                  <div style={{
                    textAlign: "right",
                    marginBottom: 8
                  }}>
                    <span style={{
                      display: "inline-block",
                      padding: "8px 12px",
                      borderRadius: BORDER_RADIUS.md,
                      background: darkMode ? "#2a2d3a" : "#f0f0f0",
                      color: darkMode ? "#e8e8e8" : COLORS.text.primary,
                      fontSize: FONT_SIZES.base,
                      maxWidth: "85%"
                    }}>
                      {h.question}
                    </span>
                  </div>
                  <div style={{
                    padding: "12px 14px",
                    borderRadius: BORDER_RADIUS.lg,
                    background: darkMode ? "#1c1f2b" : COLORS.primaryLight,
                    color: darkMode ? "#e8e8e8" : COLORS.text.primary,
                    fontSize: FONT_SIZES.base,
                    lineHeight: 1.65
                  }}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(h.answer) }}
                  />
                </div>
              ))}

              {generating && (
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 14px",
                  borderRadius: BORDER_RADIUS.lg,
                  background: darkMode ? "#1c1f2b" : "#f5f5f5",
                  color: darkMode ? "#aaa" : COLORS.text.secondary,
                  fontSize: FONT_SIZES.base
                }}>
                  <span style={{ animation: "pulse 1.5s infinite" }}>●</span>
                  <span>{t.competitiveIntelligence.aiGenerating}</span>
                  <button
                    onClick={handleStop}
                    style={{
                      marginLeft: "auto",
                      padding: "4px 10px",
                      borderRadius: BORDER_RADIUS.sm,
                      border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
                      background: "transparent",
                      color: darkMode ? "#e8e8e8" : COLORS.text.secondary,
                      fontSize: FONT_SIZES.sm,
                      cursor: "pointer"
                    }}
                  >
                    {t.competitiveIntelligence.aiStop}
                  </button>
                </div>
              )}

              {error && (
                <div style={{
                  padding: "12px 14px",
                  borderRadius: BORDER_RADIUS.lg,
                  background: "#fff0f0",
                  border: "1px solid #fcc",
                  color: "#c00",
                  fontSize: FONT_SIZES.base,
                  marginBottom: 16
                }}>
                  {error}
                </div>
              )}

              <div style={{
                marginTop: 12,
                fontSize: FONT_SIZES.xs,
                color: darkMode ? "#666" : COLORS.text.light,
                lineHeight: 1.5
              }}>
                {t.competitiveIntelligence.aiAttribution}
              </div>
            </>
          )}
        </div>

        {!showDisclaimer && (
          <>
            <div style={{
              padding: "8px 20px", display: "flex", gap: 6, flexWrap: "wrap",
              borderTop: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`
            }}>
              {presets.map((p, i) => (
                <button
                  key={i}
                  onClick={() => { setQuestion(p); }}
                  disabled={generating}
                  style={{
                    padding: "4px 10px", borderRadius: 12, cursor: generating ? "default" : "pointer",
                    border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
                    background: darkMode ? "#1c1f2b" : "#f5f5f5",
                    color: darkMode ? "#aaa" : "#666", fontSize: 11,
                    maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    opacity: generating ? 0.5 : 1
                  }}
                >{p}</button>
              ))}
            </div>
            <form
            onSubmit={handleAsk}
            style={{
              padding: "14px 20px",
              borderTop: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
              display: "flex",
              gap: 10,
              background: darkMode ? COLORS.background.cardDark : COLORS.background.card
            }}
          >
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={t.competitiveIntelligence.aiAskPlaceholder}
              disabled={generating}
              style={{
                flex: 1,
                padding: "10px 14px",
                borderRadius: BORDER_RADIUS.md,
                border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
                background: darkMode ? "#1c1f2b" : "#fff",
                color: darkMode ? "#e8e8e8" : COLORS.text.primary,
                fontSize: FONT_SIZES.base,
                outline: "none"
              }}
            />
            <button
              type="submit"
              disabled={generating || !question.trim()}
              style={{
                padding: "10px 16px",
                borderRadius: BORDER_RADIUS.md,
                border: "none",
                background: generating || !question.trim() ? "#aaa" : COLORS.primary,
                color: "#fff",
                fontSize: FONT_SIZES.md,
                fontWeight: 700,
                cursor: generating || !question.trim() ? "not-allowed" : "pointer"
              }}
            >
              ➤
            </button>
          </form>
          </>
        )}
      </div>
    </div>
  );
}
