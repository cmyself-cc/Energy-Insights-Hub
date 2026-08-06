import { useState, useEffect, useRef } from "react";
import SourcesPage from "./SourcesPage";
import ContentFiltersPage from "./ContentFiltersPage";
import TrackerSettingsPage from "./TrackerSettingsPage";
import FeedbackPage from "./FeedbackPage";
import { COLORS, FONT_SIZES, BORDER_RADIUS } from "../constants/theme";
import { i18n } from "../constants/i18n";
import { backendApi } from "../utils/backendApi";

const TABS = [
  { key: "sources", icon: "◎", labelKey: "sources" },
  { key: "filters", icon: "▣", labelKey: "contentFiltersTab" },
  { key: "ai", icon: "◇", labelKey: "aiConfig" },
  { key: "feedback", icon: "✦", labelKey: "feedback" },
  { key: "tracker", icon: "⚙", labelKey: "trackerSettingsTab" },
  { key: "models", icon: "⊙", labelKey: "globalConfigTab" },
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
  const [aiModelId, setAiModelId] = useState(() => localStorage.getItem("ai_model_id") || "");
  const [savedModels, setSavedModels] = useState([]);
  const [configMessage, setConfigMessage] = useState(null);
  const [modelMessage, setModelMessage] = useState(null);
  const [modelForm, setModelForm] = useState({ name: "", baseUrl: "", modelId: "", apiKey: "" });
  const [searchProviders, setSearchProviders] = useState([]);
  const [searchMessage, setSearchMessage] = useState(null);
  const [searchForm, setSearchForm] = useState({ name: "", providerType: "bocha", apiKey: "", baseUrl: "" });
  const fileInputRef = useRef(null);

  const loadModels = async () => {
    try {
      const res = await backendApi.getModels();
      setSavedModels(res.data || []);
    } catch { /* ignore */ }
  };

  const loadSearchProviders = async () => {
    try {
      const res = await backendApi.getSearchProviders();
      setSearchProviders(res.data || []);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    loadModels();
    loadSearchProviders();
  }, []);

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

  const handleExportConfig = async () => {
    try {
      const res = await backendApi.exportConfig();
      const json = JSON.stringify(res.data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `config-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setConfigMessage({ type: "success", text: language === "zh" ? "配置已导出" : "Config exported" });
    } catch (e) {
      setConfigMessage({ type: "error", text: e.message });
    }
    setTimeout(() => setConfigMessage(null), 3000);
  };

  const handleImportConfig = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.sources && !data.filterRules) {
        throw new Error("Invalid config format");
      }
      const dataToSend = data.sources ? data : data;
      if (!confirm(language === "zh"
        ? "这将覆盖所有现有配置（信源、过滤规则、分类、AI预设、跟踪设置），不可撤销。确定继续吗？"
        : "This will overwrite all existing config (sources, filters, categories, AI presets, tracker settings). This cannot be undone. Continue?")) {
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      await backendApi.importConfigFull(dataToSend);
      setConfigMessage({ type: "success", text: language === "zh" ? "配置已导入，即将刷新" : "Config imported, reloading..." });
      setTimeout(() => window.location.reload(), 1000);
    } catch (e) {
      setConfigMessage({ type: "error", text: `${language === "zh" ? "导入失败" : "Import failed"}: ${e.message}` });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
    setTimeout(() => setConfigMessage(null), 5000);
  };

  const handleClearInsights = async () => {
    if (!confirm(language === "zh"
      ? "确定要清空所有洞察卡片吗？此操作不可撤销。"
      : "Are you sure you want to clear all insights? This cannot be undone.")) return;
    try {
      const res = await backendApi.clearInsights();
      setConfigMessage({ type: "success", text: language === "zh"
        ? `已清空 ${res.data.deleted} 条洞察`
        : `Cleared ${res.data.deleted} insights` });
    } catch (e) {
      setConfigMessage({ type: "error", text: e.message });
    }
    setTimeout(() => setConfigMessage(null), 3000);
  };

  const handleRestoreDefaults = async () => {
    if (!confirm(language === "zh"
      ? "这将用 sources.md 覆盖当前信源。确定继续吗？"
      : "This will overwrite current sources with defaults from sources.md. Continue?")) return;
    try {
      const res = await backendApi.importSourcesMd();
      setConfigMessage({ type: "success", text: language === "zh"
        ? `导入完成：新增 ${res.data.inserted} 条，已存在 ${res.data.existed} 条`
        : `Imported: ${res.data.inserted} new, ${res.data.existed} existed` });
      setTimeout(() => window.location.reload(), 1000);
    } catch (e) {
      setConfigMessage({ type: "error", text: e.message });
    }
    setTimeout(() => setConfigMessage(null), 5000);
  };

  // --- 全局模型配置 ---
  const handleAddModel = async () => {
    const f = modelForm;
    if (!f.baseUrl.trim() || !f.modelId.trim()) {
      setModelMessage({ type: "error", text: language === "zh" ? "Base URL 和模型 ID 必填" : "Base URL and model ID are required" });
      return;
    }
    try {
      const res = await backendApi.addModel({
        name: f.name.trim() || f.modelId.trim(),
        baseUrl: f.baseUrl.trim(),
        modelId: f.modelId.trim(),
        apiKey: f.apiKey.trim()
      });
      setSavedModels(res.data || []);
      setModelForm({ name: "", baseUrl: "", modelId: "", apiKey: "" });
      setModelMessage({ type: "success", text: language === "zh" ? "模型已添加并设为生效" : "Model added and activated" });
      // 通知 Header 刷新当前模型
      window.dispatchEvent(new Event("model-updated"));
    } catch (e) {
      setModelMessage({ type: "error", text: e.message });
    }
    setTimeout(() => setModelMessage(null), 3000);
  };

  const handleSetActiveModel = async (id) => {
    try {
      const res = await backendApi.setActiveModel(id);
      setSavedModels(res.data || []);
      setModelMessage({ type: "success", text: language === "zh" ? "已切换生效模型" : "Active model switched" });
      window.dispatchEvent(new Event("model-updated"));
    } catch (e) {
      setModelMessage({ type: "error", text: e.message });
    }
    setTimeout(() => setModelMessage(null), 3000);
  };

  const handleDeleteModel = async (id) => {
    if (!confirm(language === "zh" ? "确定删除该模型配置？" : "Delete this model config?")) return;
    try {
      await backendApi.deleteModel(id);
      await loadModels();
      window.dispatchEvent(new Event("model-updated"));
    } catch (e) {
      setModelMessage({ type: "error", text: e.message });
    }
  };

  // --- 搜索 API 配置 ---
  const handleAddSearchProvider = async () => {
    const f = searchForm;
    if (!f.name.trim() || !f.apiKey.trim()) {
      setSearchMessage({ type: "error", text: language === "zh" ? "名称和 API Key 必填" : "Name and API Key are required" });
      return;
    }
    try {
      const res = await backendApi.createSearchProvider({
        name: f.name.trim(),
        providerType: f.providerType,
        apiKey: f.apiKey.trim(),
        baseUrl: f.baseUrl.trim() || undefined
      });
      if (searchProviders.length === 0) {
        await backendApi.activateSearchProvider(res.data.id);
      }
      setSearchForm({ name: "", providerType: "bocha", apiKey: "", baseUrl: "" });
      await loadSearchProviders();
      setSearchMessage({ type: "success", text: language === "zh" ? "搜索 API 已添加" : "Search API added" });
    } catch (e) {
      setSearchMessage({ type: "error", text: e.message });
    }
    setTimeout(() => setSearchMessage(null), 3000);
  };

  const handleActivateSearchProvider = async (id) => {
    try {
      await backendApi.activateSearchProvider(id);
      await loadSearchProviders();
      setSearchMessage({ type: "success", text: language === "zh" ? "已切换生效搜索 API" : "Active search API switched" });
    } catch (e) {
      setSearchMessage({ type: "error", text: e.message });
    }
    setTimeout(() => setSearchMessage(null), 3000);
  };

  const handleDeleteSearchProvider = async (id) => {
    if (!confirm(language === "zh" ? "确定删除该搜索 API？" : "Delete this search API?")) return;
    try {
      await backendApi.deleteSearchProvider(id);
      await loadSearchProviders();
    } catch (e) {
      setSearchMessage({ type: "error", text: e.message });
    }
  };

  return (
    <div>
      {/* 2x2 Action Button Grid */}
      <div style={{
        display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20
      }}>
        <button onClick={handleExportConfig} style={{
          padding: "10px 16px", borderRadius: BORDER_RADIUS.md,
          border: `1px solid ${COLORS.primary}`, background: "transparent",
          color: COLORS.primary, fontSize: FONT_SIZES.sm, fontWeight: 600,
          cursor: "pointer"
        }}>
          📥 {language === "zh" ? "导出配置" : "Export Config"}
        </button>
        <button onClick={() => fileInputRef.current?.click()} style={{
          padding: "10px 16px", borderRadius: BORDER_RADIUS.md,
          border: `1px solid ${COLORS.primary}`, background: "transparent",
          color: COLORS.primary, fontSize: FONT_SIZES.sm, fontWeight: 600,
          cursor: "pointer"
        }}>
          📤 {language === "zh" ? "导入配置" : "Import Config"}
        </button>
        <button onClick={handleClearInsights} style={{
          padding: "10px 16px", borderRadius: BORDER_RADIUS.md,
          border: `1px solid ${COLORS.primary}`, background: "transparent",
          color: COLORS.primary, fontSize: FONT_SIZES.sm, fontWeight: 600,
          cursor: "pointer"
        }}>
          🗑 {language === "zh" ? "清空 Insights" : "Clear Insights"}
        </button>
        <button onClick={handleRestoreDefaults} style={{
          padding: "10px 16px", borderRadius: BORDER_RADIUS.md,
          border: `1px solid ${COLORS.primary}`, background: "transparent",
          color: COLORS.primary, fontSize: FONT_SIZES.sm, fontWeight: 600,
          cursor: "pointer"
        }}>
          🔄 {language === "zh" ? "恢复默认配置" : "Restore Defaults"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImportConfig}
          style={{ display: "none" }}
        />
      </div>

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

      {configMessage && (
        <div style={{
          padding: "10px 16px", borderRadius: 8, marginBottom: 16,
          background: configMessage.type === "success" ? "#e8f5ee" : "#fff0f0",
          border: configMessage.type === "success" ? "1px solid #1a6b3c" : "1px solid #fcc",
          color: configMessage.type === "success" ? "#1a6b3c" : "#c00",
          fontSize: FONT_SIZES.sm, fontWeight: 500
        }}>
          {configMessage.type === "success" ? "✓" : "✗"} {configMessage.text}
        </div>
      )}

      {tab === "sources" && <SourcesPage darkMode={darkMode} language={language} onTrackerComplete={onTrackerComplete} />}
      {tab === "filters" && <ContentFiltersPage darkMode={darkMode} language={language} />}
      {tab === "ai" && (
        <div style={{ background: cardBg, borderRadius: BORDER_RADIUS.lg, border: `1px solid ${border}`, padding: "24px" }}>
          {message && (
            <div style={{ padding: "10px 16px", borderRadius: 8, marginBottom: 16, background: message.type === "success" ? "#e8f5ee" : "#fff0f0", border: message.type === "success" ? "1px solid #1a6b3c" : "1px solid #fcc", color: message.type === "success" ? "#1a6b3c" : "#c00", fontSize: FONT_SIZES.sm, fontWeight: 500 }}>
              {message.type === "success" ? "✓" : "✗"} {message.text}
            </div>
          )}

          {/* Model selector */}
          <div style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: darkMode ? "#aaa" : "#666", whiteSpace: "nowrap" }}>
              {language === "zh" ? "解读模型" : "Model"}:
            </span>
            <select
              value={aiModelId}
              onChange={e => { setAiModelId(e.target.value); localStorage.setItem("ai_model_id", e.target.value); }}
              style={{
                padding: "6px 28px 6px 12px", borderRadius: BORDER_RADIUS.md, maxWidth: 320,
                border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
                backgroundColor: aiModelId ? COLORS.primaryLight : (darkMode ? COLORS.background.cardDark : COLORS.background.card),
                color: aiModelId ? COLORS.primary : (darkMode ? "#e8e8e8" : COLORS.text.primary),
                fontSize: FONT_SIZES.sm, fontWeight: 500, outline: "none", cursor: "pointer",
                appearance: "none", WebkitAppearance: "none",
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='${encodeURIComponent(darkMode ? "#aaa" : "#888")}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center"
              }}
            >
              <option key="global" value="">{language === "zh" ? "使用全局模型" : "Use global"}</option>
              {savedModels.map(m => (
                <option key={m.id} value={String(m.id)}>{m.name} / {m.modelId}</option>
              ))}
            </select>
          </div>

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
                  rows={20}
                  style={{
                    width: "100%", padding: "10px 14px", borderRadius: 8,
                    border: `1px solid ${border}`, background: darkMode ? "#1c1f2b" : "#fff",
                    color: text, fontSize: FONT_SIZES.sm, outline: "none", fontFamily: "inherit",
                    lineHeight: 1.5, boxSizing: "border-box", flex: 1, resize: "none",
                    overflowY: "auto", overflowX: "hidden"
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
      {tab === "feedback" && <FeedbackPage darkMode={darkMode} language={language} />}
      {tab === "tracker" && <TrackerSettingsPage darkMode={darkMode} language={language} />}
      {tab === "models" && (
        <>
        <div style={{ background: cardBg, borderRadius: BORDER_RADIUS.lg, border: `1px solid ${border}`, padding: "24px" }}>
          <h3 style={{ fontSize: FONT_SIZES.xl, fontWeight: 700, color: text, margin: "0 0 6px" }}>
            {language === "zh" ? "全局模型配置" : "Global Model Config"}
          </h3>
          <p style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#888" : "#999", marginBottom: 20 }}>
            {language === "zh"
              ? "模型配置保存在服务器端，API Key 不会暴露到浏览器/公网。添加后自动设为生效模型并同步服务器 .env。"
              : "Model configs are stored server-side; API keys never reach the browser. Adding a model activates it and syncs the server .env."}
          </p>

          {modelMessage && (
            <div style={{ padding: "10px 16px", borderRadius: 8, marginBottom: 16, background: modelMessage.type === "success" ? "#e8f5ee" : "#fff0f0", border: modelMessage.type === "success" ? "1px solid #1a6b3c" : "1px solid #fcc", color: modelMessage.type === "success" ? "#1a6b3c" : "#c00", fontSize: FONT_SIZES.sm, fontWeight: 500 }}>
              {modelMessage.type === "success" ? "✓" : "✗"} {modelMessage.text}
            </div>
          )}

          {/* 模型列表 */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: darkMode ? "#ccc" : COLORS.text.secondary, marginBottom: 8 }}>
              {language === "zh" ? "已配置模型" : "Configured Models"} ({savedModels.length})
            </div>
            {savedModels.length === 0 ? (
              <div style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#777" : "#999" }}>
                {language === "zh" ? "暂无模型，请在下方添加。" : "No models yet. Add one below."}
              </div>
            ) : (
              savedModels.map(m => (
                <div key={m.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 14px", borderRadius: 8, marginBottom: 6,
                  background: m.isActive ? COLORS.primaryLight : (darkMode ? "#1c1f2b" : "#f5f5f5"),
                  border: `1px solid ${m.isActive ? COLORS.primary : (darkMode ? COLORS.border.dark : "#e8e8e8")}`
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: darkMode ? "#e8e8e8" : "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                      {m.isActive && (
                        <span style={{ fontSize: 10, color: "#fff", background: COLORS.primary, padding: "1px 6px", borderRadius: 4, fontWeight: 600, flexShrink: 0 }}>
                          {language === "zh" ? "生效中" : "Active"}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: darkMode ? "#888" : "#999", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.modelId}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: 8 }}>
                    {!m.isActive && (
                      <button onClick={() => handleSetActiveModel(m.id)} style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${COLORS.primary}`, background: COLORS.primary, color: "#fff", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                        {language === "zh" ? "设为生效" : "Activate"}
                      </button>
                    )}
                    <button onClick={() => handleDeleteModel(m.id)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #c00", background: "transparent", color: "#c00", fontSize: 12, cursor: "pointer" }}>
                      {language === "zh" ? "删除" : "Delete"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 添加模型表单 */}
          <div style={{ borderTop: `1px dashed ${border}`, paddingTop: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: darkMode ? "#ccc" : COLORS.text.secondary, marginBottom: 12 }}>
              {language === "zh" ? "添加新模型" : "Add New Model"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: darkMode ? "#aaa" : "#666", marginBottom: 4 }}>{language === "zh" ? "名称（可选）" : "Name (optional)"}</label>
                <input
                  value={modelForm.name}
                  onChange={e => setModelForm({ ...modelForm, name: e.target.value })}
                  placeholder={language === "zh" ? "如：硅基流动 DeepSeek" : "e.g. SiliconFlow DeepSeek"}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${border}`, background: darkMode ? "#1c1f2b" : "#fff", color: text, fontSize: 13, outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: darkMode ? "#aaa" : "#666", marginBottom: 4 }}>Base URL *</label>
                <input
                  value={modelForm.baseUrl}
                  onChange={e => setModelForm({ ...modelForm, baseUrl: e.target.value })}
                  placeholder="https://api.siliconflow.cn/v1"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${border}`, background: darkMode ? "#1c1f2b" : "#fff", color: text, fontSize: 13, outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: darkMode ? "#aaa" : "#666", marginBottom: 4 }}>{language === "zh" ? "模型 ID *" : "Model ID *"}</label>
                <input
                  value={modelForm.modelId}
                  onChange={e => setModelForm({ ...modelForm, modelId: e.target.value })}
                  placeholder="deepseek-ai/DeepSeek-V4-Flash"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${border}`, background: darkMode ? "#1c1f2b" : "#fff", color: text, fontSize: 13, outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: darkMode ? "#aaa" : "#666", marginBottom: 4 }}>
                  API Key {language === "zh" ? "（仅存服务器）" : "(server only)"}
                </label>
                <input
                  type="password"
                  value={modelForm.apiKey}
                  onChange={e => setModelForm({ ...modelForm, apiKey: e.target.value })}
                  placeholder="sk-..."
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${border}`, background: darkMode ? "#1c1f2b" : "#fff", color: text, fontSize: 13, outline: "none", boxSizing: "border-box" }}
                />
              </div>
            </div>
            <button onClick={handleAddModel} style={{
              padding: "10px 20px", borderRadius: BORDER_RADIUS.md, border: "none",
              background: COLORS.primary, color: "#fff", fontSize: FONT_SIZES.md, fontWeight: 600, cursor: "pointer"
            }}>{language === "zh" ? "添加并设为生效" : "Add & Activate"}</button>
          </div>
        </div>

        {/* 搜索 API 配置 */}
        <div style={{ background: cardBg, borderRadius: BORDER_RADIUS.lg, border: `1px solid ${border}`, padding: "24px", marginTop: 20 }}>
          <h3 style={{ fontSize: FONT_SIZES.xl, fontWeight: 700, color: text, margin: "0 0 6px" }}>
            {language === "zh" ? "搜索 API 配置" : "Search API Config"}
          </h3>
          <p style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#888" : "#999", marginBottom: 20 }}>
            {language === "zh"
              ? "报告生成的联网搜索使用列表中的生效搜索 API（当前支持 博查 Bocha / Tavily）。API Key 仅存服务器，不会暴露到浏览器。"
              : "Report generation websearch uses the active provider below (Bocha / Tavily supported). API keys are stored server-side only."}
          </p>

          {searchMessage && (
            <div style={{ padding: "10px 16px", borderRadius: 8, marginBottom: 16, background: searchMessage.type === "success" ? "#e8f5ee" : "#fff0f0", border: searchMessage.type === "success" ? "1px solid #1a6b3c" : "1px solid #fcc", color: searchMessage.type === "success" ? "#1a6b3c" : "#c00", fontSize: FONT_SIZES.sm, fontWeight: 500 }}>
              {searchMessage.type === "success" ? "✓" : "✗"} {searchMessage.text}
            </div>
          )}

          {/* 搜索 API 列表 */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: darkMode ? "#ccc" : COLORS.text.secondary, marginBottom: 8 }}>
              {language === "zh" ? "已配置搜索 API" : "Configured Search APIs"} ({searchProviders.length})
            </div>
            {searchProviders.length === 0 ? (
              <div style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#777" : "#999" }}>
                {language === "zh" ? "暂无搜索 API，请在下方添加。" : "No search APIs yet. Add one below."}
              </div>
            ) : (
              searchProviders.map(p => (
                <div key={p.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 14px", borderRadius: 8, marginBottom: 6,
                  background: p.is_active ? COLORS.primaryLight : (darkMode ? "#1c1f2b" : "#f5f5f5"),
                  border: `1px solid ${p.is_active ? COLORS.primary : (darkMode ? COLORS.border.dark : "#e8e8e8")}`
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: darkMode ? "#e8e8e8" : "#333" }}>{p.name}</span>
                      {p.is_active && (
                        <span style={{ fontSize: 10, color: "#fff", background: COLORS.primary, padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>
                          {language === "zh" ? "生效中" : "Active"}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: darkMode ? "#888" : "#999" }}>
                      {p.provider_type === "bocha" ? "博查 Bocha" : "Tavily"} · Key: {p.api_key_masked}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: 8 }}>
                    {!p.is_active && (
                      <button onClick={() => handleActivateSearchProvider(p.id)} style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${COLORS.primary}`, background: COLORS.primary, color: "#fff", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                        {language === "zh" ? "设为生效" : "Activate"}
                      </button>
                    )}
                    <button onClick={() => handleDeleteSearchProvider(p.id)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #c00", background: "transparent", color: "#c00", fontSize: 12, cursor: "pointer" }}>
                      {language === "zh" ? "删除" : "Delete"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 添加搜索 API 表单 */}
          <div style={{ borderTop: `1px dashed ${border}`, paddingTop: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: darkMode ? "#ccc" : COLORS.text.secondary, marginBottom: 12 }}>
              {language === "zh" ? "添加搜索 API" : "Add Search API"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: darkMode ? "#aaa" : "#666", marginBottom: 4 }}>{language === "zh" ? "名称 *" : "Name *"}</label>
                <input
                  value={searchForm.name}
                  onChange={e => setSearchForm({ ...searchForm, name: e.target.value })}
                  placeholder={language === "zh" ? "如：博查搜索" : "e.g. Bocha Search"}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${border}`, background: darkMode ? "#1c1f2b" : "#fff", color: text, fontSize: 13, outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: darkMode ? "#aaa" : "#666", marginBottom: 4 }}>{language === "zh" ? "类型 *" : "Type *"}</label>
                <select
                  value={searchForm.providerType}
                  onChange={e => setSearchForm({ ...searchForm, providerType: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${border}`, background: darkMode ? "#1c1f2b" : "#fff", color: text, fontSize: 13, outline: "none", boxSizing: "border-box" }}
                >
                  <option value="bocha">博查 Bocha</option>
                  <option value="tavily">Tavily</option>
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: darkMode ? "#aaa" : "#666", marginBottom: 4 }}>
                  API Key * {language === "zh" ? "（仅存服务器）" : "(server only)"}
                </label>
                <input
                  type="password"
                  value={searchForm.apiKey}
                  onChange={e => setSearchForm({ ...searchForm, apiKey: e.target.value })}
                  placeholder="sk-... / api-key-..."
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${border}`, background: darkMode ? "#1c1f2b" : "#fff", color: text, fontSize: 13, outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: darkMode ? "#aaa" : "#666", marginBottom: 4 }}>{language === "zh" ? "Base URL（可选）" : "Base URL (optional)"}</label>
                <input
                  value={searchForm.baseUrl}
                  onChange={e => setSearchForm({ ...searchForm, baseUrl: e.target.value })}
                  placeholder={searchForm.providerType === "bocha" ? "https://api.bochaai.com/v1/web-search" : "https://api.tavily.com/search"}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${border}`, background: darkMode ? "#1c1f2b" : "#fff", color: text, fontSize: 13, outline: "none", boxSizing: "border-box" }}
                />
              </div>
            </div>
            <button onClick={handleAddSearchProvider} style={{
              padding: "10px 20px", borderRadius: BORDER_RADIUS.md, border: "none",
              background: COLORS.primary, color: "#fff", fontSize: FONT_SIZES.md, fontWeight: 600, cursor: "pointer"
            }}>{language === "zh" ? "添加搜索 API" : "Add Search API"}</button>
          </div>
        </div>
        </>
      )}
    </div>
  );
}
