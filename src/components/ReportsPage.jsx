import { useState, useEffect } from "react";
import { marked } from "marked";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { i18n } from "../constants/i18n";
import { MARKDOWN_CSS } from "../constants/markdownStyle";
import { backendApi } from "../utils/backendApi";
import { exportDocx, exportMarkdown, exportPdf } from "../utils/reportExport";

function statusBadge(status, language) {
  if (status === "generating") {
    return { text: language === "zh" ? "生成中" : "Generating", color: "#b8860b", bg: "#fff8e6" };
  }
  if (status === "failed") {
    return { text: language === "zh" ? "失败" : "Failed", color: "#c00", bg: "#fff0f0" };
  }
  return { text: "", color: "", bg: "" };
}

export default function ReportsPage({ darkMode, language, openReportId, onOpenReportHandled }) {
  const t = i18n[language];
  const border = darkMode ? COLORS.border.dark : COLORS.border.light;
  const text = darkMode ? "#e8e8e8" : COLORS.text.primary;
  const [reports, setReports] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);
  const [view, setView] = useState("reports"); // reports | templates
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editError, setEditError] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);

  const loadReports = async () => {
    try {
      const res = await backendApi.getReports();
      setReports(res.data || []);
    } catch (e) {
      console.error("Failed to load reports:", e);
    }
  };

  const loadTemplates = async () => {
    try {
      const res = await backendApi.getReportTemplates();
      setTemplates(res.data || []);
    } catch (e) {
      console.error("Failed to load templates:", e);
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([loadReports(), loadTemplates()]).finally(() => setLoading(false));
  }, []);

  // 生成弹窗"查看报告"跳转：按 id 选中
  useEffect(() => {
    if (openReportId && reports.length > 0) {
      const found = reports.find(r => r.id === openReportId);
      if (found) { setSelectedReport(found); onOpenReportHandled?.(); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openReportId, reports]);

  // 有报告在生成中 → 每 5s 轮询刷新
  useEffect(() => {
    if (!reports.some(r => r.status === "generating")) return;
    const timer = setInterval(loadReports, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports]);

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

  const retryReport = async (id, e) => {
    e.stopPropagation();
    try {
      await backendApi.retryReportJob(id);
      loadReports();
    } catch (err) {
      console.error("Retry report failed:", err);
    }
  };

  const startEdit = (report) => {
    setEditTitle(report.title);
    setEditContent(report.content || "");
    setEditing(true);
    setEditError(null);
  };

  const saveEdit = async () => {
    try {
      const res = await backendApi.updateReport(selectedReport.id, { title: editTitle, content: editContent });
      setSelectedReport(res.data);
      setEditing(false);
      loadReports();
    } catch (err) {
      setEditError(err.message);
    }
  };

  if (selectedReport) {
    const template = templates.find(t => t.id === selectedReport.template_id);
    return (
      <div style={{
        background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
        borderRadius: BORDER_RADIUS.xl,
        border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
        padding: "32px 40px",
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
              {template && ` · ${template.name}`}
              {selectedReport.status === "failed" && (
                <span style={{ color: "#c00" }}> · {language === "zh" ? `失败：${selectedReport.error || ""}` : `Failed: ${selectedReport.error || ""}`}</span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, position: "relative" }}>
            {!editing && (
              <button
                onClick={() => startEdit(selectedReport)}
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
                {language === "zh" ? "编辑" : "Edit"}
              </button>
            )}
            <button
              onClick={() => setExportOpen(prev => !prev)}
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
              {language === "zh" ? "导出" : "Export"} ▾
            </button>
            {exportOpen && (
              <div style={{
                position: "absolute", top: "100%", right: 0, marginTop: 4, zIndex: 20,
                background: darkMode ? "#1a1f2e" : "#fff",
                border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
                borderRadius: BORDER_RADIUS.md,
                boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
                minWidth: 160, overflow: "hidden"
              }}>
                {[
                  { key: "docx", label: language === "zh" ? "导出为 Word (.docx)" : "Export as Word (.docx)", fn: () => exportDocx(selectedReport.title, selectedReport.content || "") },
                  { key: "pdf", label: language === "zh" ? "导出为 PDF" : "Export as PDF", fn: () => exportPdf(selectedReport.title, selectedReport.content || "") },
                  { key: "md", label: language === "zh" ? "导出为 Markdown (.md)" : "Export as Markdown (.md)", fn: () => exportMarkdown(selectedReport.title, selectedReport.content || "") }
                ].map(item => (
                  <button
                    key={item.key}
                    onClick={() => {
                      setExportOpen(false);
                      Promise.resolve()
                        .then(item.fn)
                        .catch(e => {
                          console.error("Export failed:", e);
                          alert(language === "zh" ? `导出失败：${e.message || e}` : `Export failed: ${e.message || e}`);
                        });
                    }}
                    style={{
                      display: "block", width: "100%", textAlign: "left", padding: "10px 16px", border: "none",
                      background: "transparent", color: darkMode ? "#e8e8e8" : COLORS.text.primary,
                      fontSize: FONT_SIZES.sm, cursor: "pointer"
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = darkMode ? "#2a3040" : "#f0f0f0"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => { setSelectedReport(null); setEditing(false); setExportOpen(false); }}
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
              {t.buttons.close}
            </button>
          </div>
        </div>
        {editing ? (
          <div>
            <input
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: BORDER_RADIUS.md, border: `1px solid ${border}`, background: darkMode ? "#1c1f2b" : "#fff", color: text, fontSize: FONT_SIZES.lg, fontWeight: 700, outline: "none", boxSizing: "border-box", marginBottom: 12 }}
            />
            <textarea
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              style={{ width: "100%", minHeight: "50vh", padding: "12px 14px", borderRadius: BORDER_RADIUS.md, border: `1px solid ${border}`, background: darkMode ? "#1c1f2b" : "#fff", color: text, fontSize: 13, fontFamily: "monospace", lineHeight: 1.7, outline: "none", boxSizing: "border-box", resize: "vertical" }}
            />
            {editError && <div style={{ color: "#c00", fontSize: FONT_SIZES.sm, marginTop: 8 }}>{editError}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={saveEdit} style={{ padding: "8px 16px", borderRadius: BORDER_RADIUS.md, border: "none", background: COLORS.primary, color: "#fff", fontSize: FONT_SIZES.md, cursor: "pointer" }}>
                {language === "zh" ? "保存" : "Save"}
              </button>
              <button onClick={() => setEditing(false)} style={{ padding: "8px 16px", borderRadius: BORDER_RADIUS.md, border: `1px solid ${border}`, background: "transparent", color: text, fontSize: FONT_SIZES.md, cursor: "pointer" }}>
                {language === "zh" ? "取消" : "Cancel"}
              </button>
            </div>
          </div>
        ) : (
          <div
            className="markdown-body"
            style={{
              background: darkMode ? "#161a26" : "#fff",
              border: `1px solid ${darkMode ? COLORS.border.dark : "#e3e3e3"}`,
              borderRadius: BORDER_RADIUS.md,
              boxShadow: "0 4px 18px rgba(0,0,0,0.08)",
              maxWidth: 860,
              margin: "0 auto",
              // Word 标准页边距：上下 2.54cm ≈ 96px，左右 3.17cm ≈ 120px
              padding: "96px 120px",
              fontSize: FONT_SIZES.base,
              lineHeight: 1.7,
              color: darkMode ? "#e8e8e8" : COLORS.text.primary
            }}
            dangerouslySetInnerHTML={{ __html: marked.parse(selectedReport.content || "") }}
          />
        )}
        <style>{MARKDOWN_CSS}</style>
      </div>
    );
  }

  return (
    <div>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 20,
        flexWrap: "wrap",
        gap: 10
      }}>
        <h1 style={{
          fontSize: FONT_SIZES["3xl"],
          fontWeight: 700,
          color: darkMode ? "#fff" : COLORS.text.primary,
          margin: 0
        }}>
          {language === "zh" ? "报告" : "Reports"}
        </h1>
        <div style={{ display: "flex", gap: 8 }}>
          {(["reports", "templates"]).map(k => (
            <button
              key={k}
              onClick={() => setView(k)}
              style={{
                padding: "6px 14px",
                borderRadius: BORDER_RADIUS.md,
                border: `1px solid ${view === k ? COLORS.primary : (darkMode ? COLORS.border.dark : COLORS.border.light)}`,
                background: view === k ? COLORS.primary : "transparent",
                color: view === k ? "#fff" : (darkMode ? "#e8e8e8" : COLORS.text.primary),
                fontSize: FONT_SIZES.sm,
                cursor: "pointer"
              }}
            >
              {k === "reports" ? (language === "zh" ? "我的报告" : "My Reports") : (language === "zh" ? "模板管理" : "Templates")}
            </button>
          ))}
        </div>
      </div>

      {view === "templates" && (
        <TemplateManager
          darkMode={darkMode}
          language={language}
          templates={templates}
          onChanged={loadTemplates}
        />
      )}

      {view === "reports" && loading && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: darkMode ? "#888" : "#aaa" }}>
          {t.competitiveIntelligence.loadingMore}
        </div>
      )}

      {view === "reports" && !loading && reports.length === 0 && (
        <div style={{
          textAlign: "center",
          padding: "80px 20px",
          color: darkMode ? "#888" : "#aaa",
          background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
          borderRadius: BORDER_RADIUS.xl,
          border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`
        }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            {language === "zh" ? "暂无保存的报告" : "No saved reports yet"}
          </div>
          <div style={{ fontSize: FONT_SIZES.md, marginTop: 8 }}>
            {language === "zh" ? "在市场洞察中勾选卡片，点击「生成报告」" : "Select cards in Market Intelligence and click Generate Report"}
          </div>
        </div>
      )}

      {view === "reports" && !loading && reports.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {reports.map(report => {
            const badge = statusBadge(report.status, language);
            const tpl = templates.find(t => t.id === report.template_id);
            return (
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
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: FONT_SIZES.lg,
                    fontWeight: 700,
                    color: darkMode ? "#fff" : COLORS.text.primary,
                    marginBottom: 4,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap"
                  }}>
                    {report.title}
                    {badge.text && (
                      <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: BORDER_RADIUS.sm, color: badge.color, background: badge.bg }}>{badge.text}</span>
                    )}
                  </div>
                  <div style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#888" : COLORS.text.light }}>
                    {new Date(report.created_at).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}
                    {tpl && ` · ${tpl.name}`}
                    {report.status === "failed" && ` · ${report.error || ""}`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginLeft: 12 }}>
                  {report.status === "failed" && (
                    <button
                      onClick={(e) => retryReport(report.id, e)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: BORDER_RADIUS.md,
                        border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
                        background: "transparent",
                        color: darkMode ? "#e8e8e8" : COLORS.text.primary,
                        fontSize: FONT_SIZES.sm,
                        cursor: "pointer"
                      }}
                    >
                      {language === "zh" ? "重试" : "Retry"}
                    </button>
                  )}
                  <button
                    onClick={(e) => deleteReport(report.id, e)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: BORDER_RADIUS.md,
                      border: "1px solid #c00",
                      background: "transparent",
                      color: "#c00",
                      fontSize: FONT_SIZES.sm,
                      cursor: "pointer"
                    }}
                  >
                    {language === "zh" ? "删除" : "Delete"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TemplateManager({ darkMode, language, templates, onChanged }) {
  const zh = language === "zh";
  const [form, setForm] = useState({ name: "", description: "", purpose: "", prompt: "", max_cards: 10, language: "zh" });
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState(null);

  const cardBg = darkMode ? COLORS.background.cardDark : COLORS.background.card;
  const border = darkMode ? COLORS.border.dark : COLORS.border.light;
  const text = darkMode ? "#e8e8e8" : COLORS.text.primary;
  const secondary = darkMode ? "#aaa" : COLORS.text.secondary;

  const inputStyle = {
    padding: "8px 12px",
    borderRadius: BORDER_RADIUS.md,
    border: `1px solid ${border}`,
    background: darkMode ? "#1c1f2b" : "#fff",
    color: text,
    fontSize: FONT_SIZES.base,
    outline: "none",
    width: "100%",
    boxSizing: "border-box"
  };
  const labelStyle = { display: "block", marginBottom: 6, fontSize: FONT_SIZES.sm, color: secondary, fontWeight: 500 };

  const startEdit = (t) => {
    setEditingId(t.id);
    setForm({ name: t.name, description: t.description || "", purpose: t.purpose || "", prompt: t.prompt, max_cards: t.max_cards, language: t.language || "zh" });
  };

  const save = async () => {
    try {
      if (editingId) {
        await backendApi.updateReportTemplate(editingId, form);
      } else {
        await backendApi.createReportTemplate({ ...form, is_public: 0 });
      }
      setEditingId(null);
      setForm({ name: "", description: "", purpose: "", prompt: "", max_cards: 10, language: "zh" });
      setMessage({ type: "success", text: zh ? "已保存" : "Saved" });
      onChanged();
    } catch (e) {
      setMessage({ type: "error", text: e.message });
    }
  };

  const remove = async (id) => {
    if (!confirm(zh ? "确定删除该模板？" : "Delete this template?")) return;
    try {
      await backendApi.deleteReportTemplate(id);
      onChanged();
    } catch (e) {
      setMessage({ type: "error", text: e.message });
    }
  };

  return (
    <div>
      {message && (
        <div style={{
          padding: "10px 14px",
          borderRadius: BORDER_RADIUS.md,
          background: message.type === "success" ? "#e8f5ee" : "#fff0f0",
          border: `1px solid ${message.type === "success" ? COLORS.primary : "#c00"}`,
          color: message.type === "success" ? COLORS.primary : "#c00",
          marginBottom: 16,
          fontSize: FONT_SIZES.sm
        }}>{message.text}</div>
      )}

      <div style={{ background: cardBg, border, borderRadius: BORDER_RADIUS.lg, padding: "16px 20px", marginBottom: 20 }}>
        <h3 style={{ margin: "0 0 4px", color: text }}>
          {editingId ? (zh ? "编辑自定义模板" : "Edit custom template") : (zh ? "新建自定义模板" : "New custom template")}
        </h3>
        <p style={{ margin: "0 0 12px", fontSize: FONT_SIZES.sm, color: secondary }}>
          {zh ? "提示词支持占位符：{{date}} {{language}} {{insights}} {{search_results}} {{resolutions}}" : "Prompt placeholders: {{date}} {{language}} {{insights}} {{search_results}} {{resolutions}}"}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px" }}>
              <label style={labelStyle}>{zh ? "名称" : "Name"}</label>
              <input style={inputStyle} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div style={{ flex: "0 0 140px" }}>
              <label style={labelStyle}>{zh ? "卡片上限" : "Max cards"}</label>
              <input style={inputStyle} type="number" min={1} max={50} value={form.max_cards} onChange={e => setForm({ ...form, max_cards: Number(e.target.value) || 10 })} />
            </div>
            <div style={{ flex: "0 0 120px" }}>
              <label style={labelStyle}>{zh ? "语言" : "Language"}</label>
              <select style={inputStyle} value={form.language} onChange={e => setForm({ ...form, language: e.target.value })}>
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
          <div>
            <label style={labelStyle}>{zh ? "用途说明" : "Purpose"}</label>
            <input style={inputStyle} value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} />
          </div>
          <div>
            <label style={labelStyle}>{zh ? "描述" : "Description"}</label>
            <input style={inputStyle} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <label style={labelStyle}>{zh ? "提示词" : "Prompt"}</label>
            <textarea style={{ ...inputStyle, minHeight: 120, resize: "vertical", fontFamily: "monospace", fontSize: 13 }} value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={save} style={{
              padding: "8px 16px", borderRadius: BORDER_RADIUS.md, border: "none",
              background: COLORS.primary, color: "#fff", fontSize: FONT_SIZES.sm, cursor: "pointer"
            }}>{zh ? "保存模板" : "Save Template"}</button>
            {editingId && (
              <button onClick={() => { setEditingId(null); setForm({ name: "", description: "", purpose: "", prompt: "", max_cards: 10, language: "zh" }); }} style={{
                padding: "8px 16px", borderRadius: BORDER_RADIUS.md, border: `1px solid ${border}`,
                background: "transparent", color: text, fontSize: FONT_SIZES.sm, cursor: "pointer"
              }}>{zh ? "取消编辑" : "Cancel"}</button>
            )}
          </div>
        </div>
      </div>

      {templates.map(t => {
        const isPublic = t.is_public === true;
        return (
          <div key={t.id} style={{ background: cardBg, border, borderRadius: BORDER_RADIUS.lg, padding: "14px 18px", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div>
                <span style={{ fontWeight: 700, color: text, fontSize: FONT_SIZES.base }}>{t.name}</span>
                <span style={{ fontSize: 11, color: secondary, marginLeft: 8 }}>
                  {isPublic ? (zh ? "公用" : "Public") : (zh ? "自定义" : "Custom")} · {zh ? `上限 ${t.max_cards} 张` : `max ${t.max_cards}`} · {t.language}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => startEdit(t)} style={{
                  padding: "5px 12px", borderRadius: BORDER_RADIUS.sm, border: `1px solid ${border}`,
                  background: "transparent", color: text, fontSize: FONT_SIZES.sm, cursor: "pointer"
                }}>{zh ? "编辑" : "Edit"}</button>
                {!isPublic && (
                  <button onClick={() => remove(t.id)} style={{
                    padding: "5px 12px", borderRadius: BORDER_RADIUS.sm, border: "1px solid #c00",
                    background: "transparent", color: "#c00", fontSize: FONT_SIZES.sm, cursor: "pointer"
                  }}>{zh ? "删除" : "Delete"}</button>
                )}
              </div>
            </div>
            {t.description && <div style={{ fontSize: FONT_SIZES.sm, color: secondary, marginTop: 4 }}>{t.description}</div>}
            <div style={{ fontSize: 12, color: secondary, marginTop: 6, fontFamily: "monospace", whiteSpace: "pre-wrap", maxHeight: 90, overflow: "hidden" }}>{t.prompt.slice(0, 200)}{t.prompt.length > 200 ? "…" : ""}</div>
          </div>
        );
      })}
    </div>
  );
}
