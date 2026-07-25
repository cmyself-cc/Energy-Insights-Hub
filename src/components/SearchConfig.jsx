import { useState } from "react";
import { COLORS } from "../constants/theme";
import { i18n } from "../constants/i18n";

export default function SearchConfig({ onClose, onSave, currentConfig, darkMode = false, language = "en" }) {
  const t = i18n[language];
  const [selectedProvider, setSelectedProvider] = useState(currentConfig?.providerId || "tavily");
  const [apiKey, setApiKey] = useState(currentConfig?.apiKey || "");
  const [showApiKey, setShowApiKey] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  const SEARCH_PROVIDERS = [
    {
      id: "tavily",
      name: "Tavily",
      baseUrl: "https://api.tavily.com/search",
      testQuery: "latest energy news"
    },
    {
      id: "serper",
      name: "Serper",
      baseUrl: "https://google.serper.dev/search",
      testQuery: "latest energy news"
    }
  ];

  const currentProvider = SEARCH_PROVIDERS.find(p => p.id === selectedProvider);

  const handleSave = () => {
    if (!apiKey.trim()) {
      alert("请输入API Key");
      return;
    }
    const config = {
      providerId: selectedProvider,
      providerName: currentProvider.name,
      baseUrl: currentProvider.baseUrl,
      apiKey: apiKey.trim()
    };
    onSave(config);
    onClose();
  };

  const handleTest = async () => {
    if (!apiKey.trim()) {
      alert("请输入API Key");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      let response;
      if (selectedProvider === "tavily") {
        response = await fetch(currentProvider.baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": apiKey.trim()
          },
          body: JSON.stringify({
            query: currentProvider.testQuery,
            search_depth: "basic",
            max_results: 3
          })
        });
      } else if (selectedProvider === "serper") {
        response = await fetch(currentProvider.baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-KEY": apiKey.trim()
          },
          body: JSON.stringify({
            q: currentProvider.testQuery,
            num: 3
          })
        });
      }

      if (response.ok) {
        setTestResult({ success: true, message: "连接成功！" });
      } else {
        const error = await response.json();
        setTestResult({ success: false, message: error.error?.message || "连接失败" });
      }
    } catch (error) {
      setTestResult({ success: false, message: error.message || "连接失败" });
    }
    setTesting(false);
  };

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
      <div style={{
        background: darkMode ? COLORS.background.cardDark : "#fff",
        borderRadius: 16,
        width: "100%",
        maxWidth: 600,
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)"
      }}>
        <div style={{
          background: COLORS.primary,
          borderRadius: "16px 16px 0 0",
          padding: "20px 28px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 18 }}>{t.searchConfig.title}</div>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 2 }}>{t.searchConfig.subtitle}</div>
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
            {t.buttons.close}
          </button>
        </div>

        <div style={{ padding: "28px" }}>
          <div style={{ marginBottom: 24 }}>
            <label style={{
              display: "block",
              fontSize: 13,
              fontWeight: 600,
              color: darkMode ? "#e8e8e8" : "#333",
              marginBottom: 8
            }}>
              {t.searchConfig.provider}
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {SEARCH_PROVIDERS.map(provider => (
                <button
                  key={provider.id}
                  onClick={() => setSelectedProvider(provider.id)}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 8,
                    border: selectedProvider === provider.id ? "none" : `1.5px solid ${darkMode ? COLORS.border.dark : "#e0e0e0"}`,
                    background: selectedProvider === provider.id ? COLORS.primary : (darkMode ? COLORS.background.cardDark : "#fff"),
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
              {t.apiConfig.apiKey}
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={t.searchConfig.apiKeyPlaceholder.replace("{provider}", currentProvider?.name)}
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
                {showApiKey ? "Hide" : "Show"}
              </button>
            </div>
            <div style={{ fontSize: 12, color: darkMode ? "#888" : "#999", marginTop: 6 }}>
              {t.apiConfig.apiKeyInfo}
            </div>
          </div>

          {testResult && (
            <div style={{
              padding: "12px 16px",
              borderRadius: 8,
              background: testResult.success ? "#e8f5ee" : "#fff0f0",
              border: testResult.success ? "1px solid #1a6b3c" : "1px solid #fcc",
              color: testResult.success ? "#1a6b3c" : "#c00",
              fontSize: 13,
              marginBottom: 20
            }}>
              {testResult.success ? "✓" : "✗"} {testResult.message}
            </div>
          )}

          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={handleTest}
              disabled={testing}
              style={{
                flex: 1,
                padding: "12px",
                borderRadius: 8,
                border: "1.5px solid #1a6b3c",
                background: darkMode ? COLORS.background.cardDark : "#fff",
                color: "#1a6b3c",
                fontSize: 14,
                fontWeight: 600,
                cursor: testing ? "not-allowed" : "pointer"
              }}
            >
              {testing ? t.buttons.testing : t.buttons.testConnection}
            </button>
            <button
              onClick={handleSave}
              style={{
                flex: 1,
                padding: "12px",
                borderRadius: 8,
                border: "none",
                background: COLORS.primary,
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              {t.buttons.saveConfig}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}