import { useState } from "react";
import { COLORS, BORDER_RADIUS } from "../constants/theme";
import { storage } from "../utils/storage";

const API_PROVIDERS = [
  {
    id: "siliconflow",
    name: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: [
      { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1" },
      { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3" },
      { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B" },
      { id: "meta-llama/Llama-3.1-70B-Instruct", name: "Llama 3.1 70B" }
    ]
  },
  {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    models: [
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
      { id: "claude-3-opus-20240229", name: "Claude 3 Opus" }
    ]
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "gpt-4-turbo", name: "GPT-4 Turbo" }
    ]
  }
];

const SEARCH_PROVIDERS = [
  {
    id: "tavily",
    name: "Tavily",
    baseUrl: "https://api.tavily.com/search"
  },
  {
    id: "serper",
    name: "Serper",
    baseUrl: "https://google.serper.dev/search"
  }
];

export default function ApiConfig({ onClose, onSave, currentConfig, darkMode = false, inline = false }) {
  const [activeTab, setActiveTab] = useState("llm");

  // LLM Config State
  const [selectedProvider, setSelectedProvider] = useState(currentConfig?.providerId || "siliconflow");
  const [selectedModel, setSelectedModel] = useState(currentConfig?.modelId || "deepseek-ai/DeepSeek-R1");
  const [apiKey, setApiKey] = useState(currentConfig?.apiKey || "");
  const [showApiKey, setShowApiKey] = useState(false);
  const [llmTestResult, setLlmTestResult] = useState(null);
  const [llmTesting, setLlmTesting] = useState(false);

  // Search Config State
  const [searchConfig] = useState(() => storage.getSearchConfig() || {});
  const [selectedSearchProvider, setSelectedSearchProvider] = useState(searchConfig?.providerId || "tavily");
  const [searchApiKey, setSearchApiKey] = useState(searchConfig?.apiKey || "");
  const [showSearchApiKey, setShowSearchApiKey] = useState(false);
  const [searchTestResult, setSearchTestResult] = useState(null);
  const [searchTesting, setSearchTesting] = useState(false);

  const currentProvider = API_PROVIDERS.find(p => p.id === selectedProvider);
  const availableModels = currentProvider?.models || [];
  const currentSearchProvider = SEARCH_PROVIDERS.find(p => p.id === selectedSearchProvider);

  const handleSave = () => {
    if (activeTab === "llm") {
      if (!apiKey.trim()) {
        alert("请输入API Key");
        return;
      }
      const config = {
        providerId: selectedProvider,
        providerName: currentProvider.name,
        baseUrl: currentProvider.baseUrl,
        modelId: selectedModel,
        modelName: availableModels.find(m => m.id === selectedModel)?.name,
        apiKey: apiKey.trim()
      };
      onSave(config);
      onClose();
    } else {
      if (!searchApiKey.trim()) {
        alert("请输入搜索API Key");
        return;
      }
      const config = {
        providerId: selectedSearchProvider,
        providerName: currentSearchProvider.name,
        baseUrl: currentSearchProvider.baseUrl,
        apiKey: searchApiKey.trim()
      };
      storage.saveSearchConfig(config);
      // 搜索配置不调用onSave，避免覆盖LLM配置
      onClose();
    }
  };

  const handleLlmTest = async () => {
    if (!apiKey.trim()) {
      alert("请输入API Key");
      return;
    }
    setLlmTesting(true);
    setLlmTestResult(null);
    try {
      let response;
      
      // Anthropic 使用不同的 API 格式
      if (selectedProvider === "anthropic") {
        response = await fetch(`${currentProvider.baseUrl}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey.trim(),
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: selectedModel,
            messages: [{ role: "user", content: "测试连接" }],
            max_tokens: 10
          })
        });
      } else {
        // OpenAI 格式（包括硅基流动）
        response = await fetch(`${currentProvider.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey.trim()}`
          },
          body: JSON.stringify({
            model: selectedModel,
            messages: [{ role: "user", content: "测试连接" }],
            max_tokens: 10
          })
        });
      }
      
      if (response.ok) {
        setLlmTestResult({ success: true, message: "连接成功！" });
      } else {
        const error = await response.json();
        setLlmTestResult({ success: false, message: error.error?.message || `连接失败: HTTP ${response.status}` });
      }
    } catch (error) {
      setLlmTestResult({ success: false, message: error.message || "连接失败" });
    }
    setLlmTesting(false);
  };

  const handleSearchTest = async () => {
    if (!searchApiKey.trim()) {
      alert("请输入搜索API Key");
      return;
    }
    setSearchTesting(true);
    setSearchTestResult(null);
    try {
      let response;
      if (selectedSearchProvider === "tavily") {
        response = await fetch(currentSearchProvider.baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": searchApiKey.trim()
          },
          body: JSON.stringify({
            query: "latest energy news",
            search_depth: "basic",
            max_results: 3
          })
        });
      } else if (selectedSearchProvider === "serper") {
        response = await fetch(currentSearchProvider.baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-KEY": searchApiKey.trim()
          },
          body: JSON.stringify({
            q: "latest energy news",
            num: 3
          })
        });
      }

      if (response.ok) {
        setSearchTestResult({ success: true, message: "连接成功！" });
      } else {
        const error = await response.json();
        setSearchTestResult({ success: false, message: error.error?.message || "连接失败" });
      }
    } catch (error) {
      setSearchTestResult({ success: false, message: error.message || "连接失败" });
    }
    setSearchTesting(false);
  };

  const content = (
    <div style={{
      background: darkMode ? COLORS.background.cardDark : "#fff",
      borderRadius: inline ? BORDER_RADIUS.lg : 16,
      width: "100%",
      maxWidth: inline ? "100%" : 600,
      maxHeight: inline ? "none" : "90vh",
      overflow: inline ? "visible" : "auto",
      boxShadow: inline ? "none" : "0 20px 60px rgba(0,0,0,0.3)",
      border: inline ? `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}` : "none"
    }}>
      {!inline && (
        <div style={{
          background: "#1a6b3c",
          borderRadius: "16px 16px 0 0",
          padding: "20px 28px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 18 }}>⚙️ API 配置</div>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 2 }}>配置大模型和搜索API</div>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1.5px solid rgba(255,255,255,0.4)",
              background: "transparent",
              color: "#fff",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer"
            }}
          >
            ✕ 关闭
          </button>
        </div>
      )}

      {/* Tabs */}
      <div style={{
        display: "flex",
        borderBottom: `1px solid ${darkMode ? COLORS.border.dark : "#e0e0e0"}`,
        background: darkMode ? COLORS.background.cardDark : "#f9f9f9"
      }}>
        <button
          onClick={() => setActiveTab("llm")}
          style={{
            flex: 1,
            padding: "14px 20px",
            border: "none",
            borderBottom: activeTab === "llm" ? "2px solid #1a6b3c" : "none",
            background: "transparent",
            color: activeTab === "llm" ? "#1a6b3c" : (darkMode ? "#888" : "#666"),
            fontSize: 14,
            fontWeight: activeTab === "llm" ? 600 : 400,
            cursor: "pointer"
          }}
        >
          🤖 大模型配置
        </button>
        <button
          onClick={() => setActiveTab("search")}
          style={{
            flex: 1,
            padding: "14px 20px",
            border: "none",
            borderBottom: activeTab === "search" ? "2px solid #1a6b3c" : "none",
            background: "transparent",
            color: activeTab === "search" ? "#1a6b3c" : (darkMode ? "#888" : "#666"),
            fontSize: 14,
            fontWeight: activeTab === "search" ? 600 : 400,
            cursor: "pointer"
          }}
        >
          🔍 搜索配置
        </button>
      </div>

      <div style={{ padding: "28px" }}>
        {activeTab === "llm" ? (
          <>
            <div style={{ marginBottom: 24 }}>
              <label style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: darkMode ? "#e8e8e8" : "#333",
                marginBottom: 8
              }}>
                API 提供商
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {API_PROVIDERS.map(provider => (
                  <button
                    key={provider.id}
                    onClick={() => {
                      setSelectedProvider(provider.id);
                      setSelectedModel(provider.models[0].id);
                    }}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 8,
                      border: selectedProvider === provider.id ? "none" : `1.5px solid ${darkMode ? COLORS.border.dark : "#e0e0e0"}`,
                      background: selectedProvider === provider.id ? "#1a6b3c" : (darkMode ? COLORS.background.cardDark : "#fff"),
                      color: selectedProvider === provider.id ? "#fff" : (darkMode ? "#e8e8e8" : "#555"),
                      fontSize: 13,
                      cursor: "pointer",
                      fontWeight: selectedProvider === provider.id ? 600 : 400,
                      transition: "all 0.15s"
                    }}
                  >
                    {provider.name}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: darkMode ? "#e8e8e8" : "#333",
                marginBottom: 8
              }}>
                模型选择
              </label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  borderRadius: 8,
                  border: `1.5px solid ${darkMode ? COLORS.border.dark : "#e0e0e0"}`,
                  fontSize: 14,
                  outline: "none",
                  background: darkMode ? COLORS.background.cardDark : "#fff",
                  color: darkMode ? "#e8e8e8" : "#333",
                  cursor: "pointer"
                }}
              >
                {availableModels.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: darkMode ? "#e8e8e8" : "#333",
                marginBottom: 8
              }}>
                API Key
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="输入您的API Key"
                  style={{
                    flex: 1,
                    padding: "12px 16px",
                    borderRadius: 8,
                    border: `1.5px solid ${darkMode ? COLORS.border.dark : "#e0e0e0"}`,
                    fontSize: 14,
                    outline: "none",
                    background: darkMode ? COLORS.background.cardDark : "#fff",
                    color: darkMode ? "#e8e8e8" : "#333"
                  }}
                />
                <button
                  onClick={() => setShowApiKey(!showApiKey)}
                  style={{
                    padding: "12px 16px",
                    borderRadius: 8,
                    border: `1.5px solid ${darkMode ? COLORS.border.dark : "#e0e0e0"}`,
                    background: darkMode ? COLORS.background.cardDark : "#fff",
                    color: darkMode ? "#e8e8e8" : "#555",
                    fontSize: 13,
                    cursor: "pointer",
                    fontWeight: 500
                  }}
                >
                  {showApiKey ? "🙈" : "👁️"}
                </button>
              </div>
              <div style={{ fontSize: 12, color: darkMode ? "#888" : "#999", marginTop: 6 }}>
                API Key 将安全保存在您的浏览器本地存储中
              </div>
            </div>

            {llmTestResult && (
              <div style={{
                padding: "12px 16px",
                borderRadius: 8,
                background: llmTestResult.success ? "#e8f5ee" : "#fff0f0",
                border: llmTestResult.success ? "1px solid #1a6b3c" : "1px solid #fcc",
                color: llmTestResult.success ? "#1a6b3c" : "#c00",
                fontSize: 13,
                marginBottom: 20
              }}>
                {llmTestResult.success ? "✓" : "✗"} {llmTestResult.message}
              </div>
            )}

            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={handleLlmTest}
                disabled={llmTesting}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 8,
                  border: "1.5px solid #1a6b3c",
                  background: darkMode ? COLORS.background.cardDark : "#fff",
                  color: "#1a6b3c",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: llmTesting ? "not-allowed" : "pointer"
                }}
              >
                {llmTesting ? "测试中..." : "🧪 测试连接"}
              </button>
              <button
                onClick={handleSave}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 8,
                  border: "none",
                  background: "#1a6b3c",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                💾 保存配置
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 24 }}>
              <label style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: darkMode ? "#e8e8e8" : "#333",
                marginBottom: 8
              }}>
                搜索提供商
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {SEARCH_PROVIDERS.map(provider => (
                  <button
                    key={provider.id}
                    onClick={() => setSelectedSearchProvider(provider.id)}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 8,
                      border: selectedSearchProvider === provider.id ? "none" : `1.5px solid ${darkMode ? COLORS.border.dark : "#e0e0e0"}`,
                      background: selectedSearchProvider === provider.id ? "#1a6b3c" : (darkMode ? COLORS.background.cardDark : "#fff"),
                      color: selectedSearchProvider === provider.id ? "#fff" : (darkMode ? "#e8e8e8" : "#555"),
                      fontSize: 13,
                      cursor: "pointer",
                      fontWeight: selectedSearchProvider === provider.id ? 600 : 400,
                      transition: "all 0.15s"
                    }}
                  >
                    {provider.name}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: darkMode ? "#e8e8e8" : "#333",
                marginBottom: 8
              }}>
                搜索 API Key
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type={showSearchApiKey ? "text" : "password"}
                  value={searchApiKey}
                  onChange={(e) => setSearchApiKey(e.target.value)}
                  placeholder={`输入${currentSearchProvider?.name}的API Key`}
                  style={{
                    flex: 1,
                    padding: "12px 16px",
                    borderRadius: 8,
                    border: `1.5px solid ${darkMode ? COLORS.border.dark : "#e0e0e0"}`,
                    fontSize: 14,
                    outline: "none",
                    background: darkMode ? COLORS.background.cardDark : "#fff",
                    color: darkMode ? "#e8e8e8" : "#333"
                  }}
                />
                <button
                  onClick={() => setShowSearchApiKey(!showSearchApiKey)}
                  style={{
                    padding: "12px 16px",
                    borderRadius: 8,
                    border: `1.5px solid ${darkMode ? COLORS.border.dark : "#e0e0e0"}`,
                    background: darkMode ? COLORS.background.cardDark : "#fff",
                    color: darkMode ? "#e8e8e8" : "#555",
                    fontSize: 13,
                    cursor: "pointer",
                    fontWeight: 500
                  }}
                >
                  {showSearchApiKey ? "🙈" : "👁️"}
                </button>
              </div>
              <div style={{ fontSize: 12, color: darkMode ? "#888" : "#999", marginTop: 6 }}>
                搜索API Key 将安全保存在您的浏览器本地存储中
              </div>
            </div>

            {searchTestResult && (
              <div style={{
                padding: "12px 16px",
                borderRadius: 8,
                background: searchTestResult.success ? "#e8f5ee" : "#fff0f0",
                border: searchTestResult.success ? "1px solid #1a6b3c" : "1px solid #fcc",
                color: searchTestResult.success ? "#1a6b3c" : "#c00",
                fontSize: 13,
                marginBottom: 20
              }}>
                {searchTestResult.success ? "✓" : "✗"} {searchTestResult.message}
              </div>
            )}

            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={handleSearchTest}
                disabled={searchTesting}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 8,
                  border: "1.5px solid #1a6b3c",
                  background: darkMode ? COLORS.background.cardDark : "#fff",
                  color: "#1a6b3c",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: searchTesting ? "not-allowed" : "pointer"
                }}
              >
                {searchTesting ? "测试中..." : "🧪 测试连接"}
              </button>
              <button
                onClick={handleSave}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 8,
                  border: "none",
                  background: "#1a6b3c",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                💾 保存配置
              </button>
            </div>
          </>
        )}

        {/* 重置配置按钮 */}
        <div style={{ marginTop: 24, paddingTop: 24, borderTop: `1px solid ${darkMode ? COLORS.border.dark : "#e0e0e0"}` }}>
          <button
            onClick={() => {
              if (confirm("确定要重置所有API配置吗？这将清除大模型和搜索API的配置。")) {
                storage.saveApiConfig(null);
                storage.saveSearchConfig(null);
                onClose();
                window.location.reload();
              }
            }}
            style={{
              width: "100%",
              padding: "10px",
              borderRadius: 8,
              border: `1.5px solid ${darkMode ? "#c00" : "#c00"}`,
              background: "transparent",
              color: "#c00",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer"
            }}
          >
            🗑️ 重置所有配置
          </button>
        </div>
      </div>
    </div>
  );

  if (inline) return content;

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.5)",
      zIndex: 1000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px"
    }}>
      {content}
    </div>
  );
}
