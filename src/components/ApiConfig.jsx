import { useState, useEffect } from "react";
import { COLORS, BORDER_RADIUS } from "../constants/theme";
import { storage } from "../utils/storage";
import { backendApi } from "../utils/backendApi";

const emptyLlm = () => ({ providerName: "", baseUrl: "", modelId: "", apiKey: "" });
const emptySearch = () => ({ providerName: "", baseUrl: "", apiKey: "" });

export default function ApiConfig({ onClose, onSave, currentConfig, darkMode = false, inline = false }) {
  const [activeTab, setActiveTab] = useState("llm");
  const [saved, setSaved] = useState([]);
  const [searchSaved, setSearchSaved] = useState(null);
  const [activeId, setActiveId] = useState(() => {
    const configs = storage.getApiConfigs();
    return configs.length > 0 ? configs[0].id : null;
  });
  const [editingId, setEditingId] = useState(null);

  // LLM form
  const [llm, setLlm] = useState(currentConfig?.providerName ? currentConfig : emptyLlm());
  const [showApiKey, setShowApiKey] = useState(false);
  const [llmTestResult, setLlmTestResult] = useState(null);
  const [llmTesting, setLlmTesting] = useState(false);

  // Search form
  const [search, setSearch] = useState(emptySearch());
  const [showSearchKey, setShowSearchKey] = useState(false);
  const [searchTestResult, setSearchTestResult] = useState(null);
  const [searchTesting, setSearchTesting] = useState(false);

  useEffect(() => { setSaved(storage.getApiConfigs()); setSearchSaved(storage.getSearchConfig()); }, []);

  const inputStyle = {
    width: "100%", padding: "10px 14px", borderRadius: 8,
    border: `1.5px solid ${darkMode ? COLORS.border.dark : "#e0e0e0"}`,
    fontSize: 14, outline: "none", boxSizing: "border-box",
    background: darkMode ? COLORS.background.cardDark : "#fff",
    color: darkMode ? "#e8e8e8" : "#333"
  };
  const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, color: darkMode ? "#e8e8e8" : "#333", marginBottom: 6 };
  const hintStyle = { fontSize: 11, color: darkMode ? "#777" : "#999", marginTop: 4 };

  const isDuplicate = () => {
    const form = activeTab === "llm" ? llm : search;
    return saved.some(c =>
      c.providerName === (form.providerName || "") &&
      c.baseUrl === (form.baseUrl || "") &&
      c.modelId === (form.modelId || "") &&
      c.apiKey === form.apiKey
    );
  };

  const handleSave = () => {
    const form = activeTab === "llm" ? llm : search;
    if (!form.apiKey.trim()) { alert("请输入API Key"); return; }
    if (!editingId && isDuplicate()) { alert("该配置已存在，不允许重复添加"); return; }

    if (activeTab === "llm") {
      const config = {
        id: editingId || `${form.providerName || "custom"}-${Date.now()}`,
        providerName: form.providerName.trim() || "Custom",
        baseUrl: form.baseUrl.trim() || "https://api.openai.com/v1",
        modelId: form.modelId.trim() || "gpt-4o-mini",
        apiKey: form.apiKey.trim()
      };
      if (editingId) {
        const configs = storage.getApiConfigs();
        const idx = configs.findIndex(c => c.id === editingId);
        if (idx >= 0) configs[idx] = config;
        localStorage.setItem("energy_insights_api_config", JSON.stringify(configs));
        window.dispatchEvent(new Event("api-config-updated"));
      } else {
        onSave(config);
      }
      backendApi.saveLlmEnv(config).catch(() => {});
    } else {
      storage.saveSearchConfig({
        providerName: form.providerName.trim() || "Search",
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim()
      });
      setSearchSaved(storage.getSearchConfig());
    }
    setSaved(storage.getApiConfigs());
    setActiveId(storage.getApiConfigs()?.[0]?.id || null);
    setEditingId(null);
    setLlm(emptyLlm());
    setSearch(emptySearch());
  };

  const setActive = (id) => {
    storage.switchApiConfig(id);
    setActiveId(id);
    setSaved(storage.getApiConfigs());
    window.dispatchEvent(new Event("api-config-updated"));
  };

  const handleDelete = (id) => {
    const configs = storage.getApiConfigs().filter(c => c.id !== id);
    localStorage.setItem("energy_insights_api_config", JSON.stringify(configs));
    setSaved(configs);
    if (id === activeId) setActiveId(null);
    window.dispatchEvent(new Event("api-config-updated"));
  };

  const handleEdit = (config) => {
    setEditingId(config.id);
    setLlm({ providerName: config.providerName, baseUrl: config.baseUrl, modelId: config.modelId, apiKey: config.apiKey });
    setActiveTab("llm");
  };

  const testLlm = async () => {
    if (!llm.apiKey.trim() || !llm.baseUrl.trim()) { alert("请填写URL和Key"); return; }
    setLlmTesting(true); setLlmTestResult(null);
    try {
      const resp = await fetch(`${llm.baseUrl.trim()}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${llm.apiKey.trim()}` },
        body: JSON.stringify({ model: llm.modelId.trim() || "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], max_tokens: 5 })
      });
      setLlmTestResult(resp.ok ? { success: true, message: "连接成功" } : { success: false, message: `HTTP ${resp.status}` });
    } catch (e) { setLlmTestResult({ success: false, message: e.message }); }
    setLlmTesting(false);
  };

  const testSearch = async () => {
    if (!search.apiKey.trim() || !search.baseUrl.trim()) { alert("请填写搜索URL和Key"); return; }
    setSearchTesting(true); setSearchTestResult(null);
    try {
      const resp = await fetch(search.baseUrl.trim(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: search.apiKey.trim() },
        body: JSON.stringify({ query: "test", max_results: 1 })
      });
      setSearchTestResult(resp.ok ? { success: true, message: "连接成功" } : { success: false, message: `HTTP ${resp.status}` });
    } catch (e) { setSearchTestResult({ success: false, message: e.message }); }
    setSearchTesting(false);
  };

  const content = (
    <div style={{
      background: darkMode ? COLORS.background.cardDark : "#fff", borderRadius: inline ? BORDER_RADIUS.lg : 16,
      width: "100%", maxWidth: inline ? "100%" : 560, maxHeight: inline ? "none" : "90vh", overflow: "auto",
      boxShadow: inline ? "none" : "0 20px 60px rgba(0,0,0,0.3)",
      border: inline ? `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}` : "none"
    }}>
      {!inline && (
        <div style={{ background: COLORS.primary, borderRadius: "16px 16px 0 0", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 17 }}>API 配置</div>
          {onClose && <button onClick={onClose} style={{ padding: "6px 12px", borderRadius: 8, border: "1.5px solid rgba(255,255,255,0.4)", background: "transparent", color: "#fff", fontSize: 13, cursor: "pointer" }}>关闭</button>}
        </div>
      )}

      {/* Saved configs list */}
      {saved.length > 0 && (
        <div style={{ padding: "0 24px 16px", borderTop: `1px solid ${darkMode ? COLORS.border.dark : "#e0e0e0"}` }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: darkMode ? "#888" : "#999", marginBottom: 8, marginTop: 16, textTransform: "uppercase" }}>已保存的配置</div>
          {saved.map(c => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderRadius: 8, marginBottom: 6, background: editingId === c.id ? COLORS.primaryLight : (darkMode ? "#222" : "#f5f5f5"), border: `1px solid ${darkMode ? COLORS.border.dark : "#e8e8e8"}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: darkMode ? "#e8e8e8" : "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.providerName}</span>
                  {c.id === activeId && (
                    <span style={{ fontSize: 10, color: "#fff", background: COLORS.primary, padding: "1px 6px", borderRadius: 4, fontWeight: 600, flexShrink: 0 }}>生效中</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: darkMode ? "#888" : "#999", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.modelId} · {c.baseUrl}</div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: 8 }}>
                {c.id !== activeId && (
                  <button onClick={() => setActive(c.id)} style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${COLORS.primary}`, background: COLORS.primary, color: "#fff", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>设为生效</button>
                )}
                <button onClick={() => handleEdit(c)} style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${COLORS.primary}`, background: "transparent", color: COLORS.primary, fontSize: 12, cursor: "pointer" }}>编辑</button>
                <button onClick={() => handleDelete(c.id)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #c00", background: "transparent", color: "#c00", fontSize: 12, cursor: "pointer" }}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Search API saved config */}
      {searchSaved && searchSaved.providerName && (
        <div style={{ padding: "0 24px 16px", borderTop: `1px solid ${darkMode ? COLORS.border.dark : "#e0e0e0"}` }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: darkMode ? "#888" : "#999", marginBottom: 8, marginTop: 16, textTransform: "uppercase" }}>搜索 API</div>
          <div style={{ padding: "10px 14px", borderRadius: 8, background: darkMode ? "#222" : "#f5f5f5", border: `1px solid ${darkMode ? COLORS.border.dark : "#e8e8e8"}` }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: darkMode ? "#e8e8e8" : "#333" }}>{searchSaved.providerName}</div>
            <div style={{ fontSize: 11, color: darkMode ? "#888" : "#999" }}>{searchSaved.baseUrl}</div>
          </div>
        </div>
      )}

      {/* Form - always visible */}
      <div style={{ padding: "20px 24px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: darkMode ? "#888" : "#999", marginBottom: 12, textTransform: "uppercase" }}>
          {editingId ? "编辑配置" : "新增配置"}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {[{ k: "llm", label: "大模型" }, { k: "search", label: "搜索API" }].map(t => (
            <button key={t.k} onClick={() => setActiveTab(t.k)} style={{
              flex: 1, padding: "10px", borderRadius: 8, border: activeTab === t.k ? "none" : `1px solid ${darkMode ? COLORS.border.dark : "#e0e0e0"}`,
              background: activeTab === t.k ? COLORS.primary : "transparent", color: activeTab === t.k ? "#fff" : (darkMode ? "#888" : "#666"),
              fontSize: 13, fontWeight: activeTab === t.k ? 600 : 400, cursor: "pointer"
            }}>{t.label}</button>
          ))}
        </div>

        {activeTab === "llm" ? (
          <>
            <div style={{ marginBottom: 16 }}><label style={labelStyle}>提供商名称</label><input style={inputStyle} value={llm.providerName} onChange={e => setLlm({ ...llm, providerName: e.target.value })} placeholder="硅基流动 / OpenAI / Anthropic" /></div>
            <div style={{ marginBottom: 16 }}><label style={labelStyle}>Base URL</label><input style={inputStyle} value={llm.baseUrl} onChange={e => setLlm({ ...llm, baseUrl: e.target.value })} placeholder="https://api.siliconflow.cn/v1" /></div>
            <div style={{ marginBottom: 16 }}><label style={labelStyle}>模型 ID</label><input style={inputStyle} value={llm.modelId} onChange={e => setLlm({ ...llm, modelId: e.target.value })} placeholder="deepseek-ai/DeepSeek-R1" /></div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>API Key</label>
              <div style={{ display: "flex", gap: 8 }}><input style={inputStyle} type={showApiKey ? "text" : "password"} value={llm.apiKey} onChange={e => setLlm({ ...llm, apiKey: e.target.value })} placeholder="sk-..." /><button onClick={() => setShowApiKey(!showApiKey)} style={{ padding: "10px 14px", borderRadius: 8, border: `1.5px solid ${darkMode ? COLORS.border.dark : "#e0e0e0"}`, background: darkMode ? COLORS.background.cardDark : "#fff", color: darkMode ? "#e8e8e8" : "#555", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>{showApiKey ? "隐藏" : "显示"}</button></div>
              <div style={hintStyle}>保存到浏览器和服务器 .env 文件</div>
            </div>
            {llmTestResult && (<div style={{ padding: "8px 12px", borderRadius: 8, background: llmTestResult.success ? "#e8f5ee" : "#fff0f0", border: llmTestResult.success ? "1px solid #1a6b3c" : "1px solid #fcc", color: llmTestResult.success ? "#1a6b3c" : "#c00", fontSize: 13, marginBottom: 16 }}>{llmTestResult.success ? "✓" : "✗"} {llmTestResult.message}</div>)}
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={testLlm} disabled={llmTesting} style={{ flex: 1, padding: "12px", borderRadius: 8, border: `1.5px solid ${COLORS.primary}`, background: "transparent", color: COLORS.primary, fontSize: 14, fontWeight: 600, cursor: llmTesting ? "not-allowed" : "pointer" }}>{llmTesting ? "测试中..." : "测试连接"}</button>
              <button onClick={handleSave} style={{ flex: 1, padding: "12px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{editingId ? "更新配置" : "保存配置"}</button>
            </div>
            {editingId && <button onClick={() => { setEditingId(null); setLlm(emptyLlm()); }} style={{ width: "100%", marginTop: 10, padding: "10px", borderRadius: 8, border: `1px solid ${darkMode ? COLORS.border.dark : "#e0e0e0"}`, background: "transparent", color: darkMode ? "#aaa" : "#888", fontSize: 13, cursor: "pointer" }}>取消编辑</button>}
          </>
        ) : (
          <>
            <div style={{ marginBottom: 16 }}><label style={labelStyle}>服务名称</label><input style={inputStyle} value={search.providerName} onChange={e => setSearch({ ...search, providerName: e.target.value })} placeholder="Tavily / Serper" /></div>
            <div style={{ marginBottom: 16 }}><label style={labelStyle}>API URL</label><input style={inputStyle} value={search.baseUrl} onChange={e => setSearch({ ...search, baseUrl: e.target.value })} placeholder="https://api.tavily.com/search" /></div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>API Key</label>
              <div style={{ display: "flex", gap: 8 }}><input style={inputStyle} type={showSearchKey ? "text" : "password"} value={search.apiKey} onChange={e => setSearch({ ...search, apiKey: e.target.value })} placeholder="tvly-..." /><button onClick={() => setShowSearchKey(!showSearchKey)} style={{ padding: "10px 14px", borderRadius: 8, border: `1.5px solid ${darkMode ? COLORS.border.dark : "#e0e0e0"}`, background: darkMode ? COLORS.background.cardDark : "#fff", color: darkMode ? "#e8e8e8" : "#555", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>{showSearchKey ? "隐藏" : "显示"}</button></div>
            </div>
            {searchTestResult && (<div style={{ padding: "8px 12px", borderRadius: 8, background: searchTestResult.success ? "#e8f5ee" : "#fff0f0", border: searchTestResult.success ? "1px solid #1a6b3c" : "1px solid #fcc", color: searchTestResult.success ? "#1a6b3c" : "#c00", fontSize: 13, marginBottom: 16 }}>{searchTestResult.success ? "✓" : "✗"} {searchTestResult.message}</div>)}
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={testSearch} disabled={searchTesting} style={{ flex: 1, padding: "12px", borderRadius: 8, border: `1.5px solid ${COLORS.primary}`, background: "transparent", color: COLORS.primary, fontSize: 14, fontWeight: 600, cursor: searchTesting ? "not-allowed" : "pointer" }}>{searchTesting ? "测试中..." : "测试连接"}</button>
              <button onClick={handleSave} style={{ flex: 1, padding: "12px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>保存配置</button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  if (inline) return content;
  return <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>{content}</div>;
}
