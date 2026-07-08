import { useState, useEffect } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS } from "../constants/theme";
import { i18n } from "../constants/i18n";
import { backendApi } from "../utils/backendApi";

function toCsv(arr) {
  if (!Array.isArray(arr)) return "";
  return arr.join(", ");
}

function fromCsv(str) {
  return str.split(",").map(s => s.trim()).filter(Boolean);
}

export default function TrackerSettingsPage({ darkMode, language }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const t = i18n[language]?.trackerSettings || i18n.zh.trackerSettings;

  useEffect(() => {
    backendApi.getTrackerSettings()
      .then(res => {
        const s = res.data;
        setSettings({
          lookbackHours: s.lookbackHours,
          maxPerSource: s.maxPerSource,
          includeBusinessDomains: toCsv(s.includeBusinessDomains),
          includeEnterpriseTypes: toCsv(s.includeEnterpriseTypes),
          includeCategories: toCsv(s.includeCategories),
          excludeKeywords: toCsv(s.excludeKeywords)
        });
        setLoading(false);
      })
      .catch(err => {
        setMessage({ type: "error", text: err.message });
        setLoading(false);
      });
  }, []);

  const handleChange = (field, value) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await backendApi.updateTrackerSettings({
        lookbackHours: Number(settings.lookbackHours),
        maxPerSource: Number(settings.maxPerSource),
        includeBusinessDomains: fromCsv(settings.includeBusinessDomains),
        includeEnterpriseTypes: fromCsv(settings.includeEnterpriseTypes),
        includeCategories: fromCsv(settings.includeCategories),
        excludeKeywords: fromCsv(settings.excludeKeywords)
      });
      setMessage({ type: "success", text: t.saved });
    } catch (err) {
      setMessage({ type: "error", text: `${t.saveFailed}: ${err.message}` });
    }
    setSaving(false);
  };

  const inputStyle = {
    padding: "8px 12px",
    borderRadius: BORDER_RADIUS.md,
    border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
    background: darkMode ? "#1c1f2b" : "#fff",
    color: darkMode ? "#e8e8e8" : COLORS.text.primary,
    fontSize: FONT_SIZES.base,
    outline: "none",
    width: "100%",
    boxSizing: "border-box"
  };

  const labelStyle = {
    display: "block",
    marginBottom: 6,
    fontSize: FONT_SIZES.sm,
    color: darkMode ? "#aaa" : COLORS.text.secondary,
    fontWeight: 500
  };

  if (loading) {
    return <div style={{ color: darkMode ? "#888" : "#aaa", padding: 40 }}>{t.loading}</div>;
  }

  return (
    <div>
      <h1 style={{
        fontSize: FONT_SIZES["3xl"],
        fontWeight: 700,
        color: darkMode ? "#fff" : COLORS.text.primary,
        margin: "0 0 20px"
      }}>{t.title}</h1>

      {message && (
        <div style={{
          padding: "12px 16px",
          borderRadius: BORDER_RADIUS.md,
          background: message.type === "success" ? "#e8f5ee" : "#fff0f0",
          border: `1px solid ${message.type === "success" ? COLORS.primary : "#c00"}`,
          color: message.type === "success" ? COLORS.primary : "#c00",
          marginBottom: 16
        }}>{message.text}</div>
      )}

      <form onSubmit={handleSave} style={{
        background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
        borderRadius: BORDER_RADIUS.lg,
        border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
        padding: "20px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 640
      }}>
        <div>
          <label style={labelStyle}>{t.lookback}</label>
          <input
            type="number"
            min={1}
            max={168}
            value={settings.lookbackHours}
            onChange={e => handleChange("lookbackHours", e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>{t.maxPerSource}</label>
          <input
            type="number"
            min={1}
            max={50}
            value={settings.maxPerSource}
            onChange={e => handleChange("maxPerSource", e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>{t.includeDomains}</label>
          <input
            type="text"
            value={settings.includeBusinessDomains}
            onChange={e => handleChange("includeBusinessDomains", e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>{t.includeEnterprises}</label>
          <input
            type="text"
            value={settings.includeEnterpriseTypes}
            onChange={e => handleChange("includeEnterpriseTypes", e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>{t.includeCategories}</label>
          <input
            type="text"
            value={settings.includeCategories}
            onChange={e => handleChange("includeCategories", e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>{t.excludeKeywords}</label>
          <input
            type="text"
            value={settings.excludeKeywords}
            onChange={e => handleChange("excludeKeywords", e.target.value)}
            style={inputStyle}
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          style={{
            padding: "10px 20px",
            borderRadius: BORDER_RADIUS.md,
            border: "none",
            background: saving ? "#aaa" : COLORS.primary,
            color: "#fff",
            fontSize: FONT_SIZES.md,
            fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer",
            alignSelf: "flex-start"
          }}
        >{saving ? "..." : t.save}</button>
      </form>
    </div>
  );
}
