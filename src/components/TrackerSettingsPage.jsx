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

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const PURPOSE_KEYS = ["competitor", "policy", "tech"];

// 与后端 server/lib/trackerSettings.js 的 SOURCE_TYPES 保持一致，
// 即"数据来源"页可创建的合法类型（rss/website/wechat_mcp）。
const SOURCE_TYPES = ["rss", "website", "wechat_mcp"];

const DEFAULT_SETTINGS = {
  lookbackHours: 24,
  maxPerSource: 3,
  wechatMcpPerFeedLimit: 10,
  includeBusinessDomains: "",
  includeEnterpriseTypes: "",
  includeCategories: "",
  excludeKeywords: "",
  requiredIndustryKeywords: "",
  requiredCompanyKeywords: "",
  fuzzyDeduplicationThreshold: 0.85,
  scheduleEnabled: true,
  scheduleFrequency: "daily",
  scheduleTime: "05:00",
  scheduleWeekday: 1,
  enabledSourceTypes: ["rss", "website", "wechat_mcp"]
};

export default function TrackerSettingsPage({ darkMode, language }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [purposeRules, setPurposeRules] = useState([]);
  const [purposeSources, setPurposeSources] = useState([]);
  const [togglingPurpose, setTogglingPurpose] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const t = i18n[language]?.trackerSettings || i18n.zh.trackerSettings;
  const purposeLabels = i18n[language]?.purposeLabels || i18n.zh.purposeLabels;

  useEffect(() => {
    Promise.all([
      backendApi.getTrackerSettings(),
      backendApi.getFilterRules(),
      backendApi.getSources()
    ])
      .then(([res, rulesRes, sourcesRes]) => {
        const s = res.data;
        setSettings({
          lookbackHours: s.lookbackHours,
          maxPerSource: s.maxPerSource,
          wechatMcpPerFeedLimit: s.wechatMcpPerFeedLimit,
          includeBusinessDomains: toCsv(s.includeBusinessDomains),
          includeEnterpriseTypes: toCsv(s.includeEnterpriseTypes),
          includeCategories: toCsv(s.includeCategories),
          excludeKeywords: toCsv(s.excludeKeywords),
          requiredIndustryKeywords: toCsv(s.requiredIndustryKeywords),
          requiredCompanyKeywords: toCsv(s.requiredCompanyKeywords),
          fuzzyDeduplicationThreshold: Number.isFinite(s.fuzzyDeduplicationThreshold)
            ? s.fuzzyDeduplicationThreshold
            : 0.85,
          scheduleEnabled: s.scheduleEnabled !== false,
          scheduleFrequency: s.scheduleFrequency === "weekly" ? "weekly" : "daily",
          scheduleTime: s.scheduleTime || "05:00",
          scheduleWeekday: Number.isInteger(s.scheduleWeekday) ? s.scheduleWeekday : 1,
          enabledSourceTypes: Array.isArray(s.enabledSourceTypes) ? s.enabledSourceTypes : []
        });
        setPurposeRules(rulesRes.data || []);
        setPurposeSources(sourcesRes.data || []);
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

  // A purpose is "configured" when it has filter rules, and "on" when at
  // least one of its rules is active. Toggling flips the active flag of all
  // rules tagged with that purpose (tracker only loads active rules).
  const purposeStats = {};
  for (const key of PURPOSE_KEYS) purposeStats[key] = { total: 0, active: 0, sources: 0 };
  for (const rule of purposeRules) {
    const p = rule.purpose || "competitor";
    if (!purposeStats[p]) continue;
    purposeStats[p].total += 1;
    if (rule.active) purposeStats[p].active += 1;
  }
  for (const source of purposeSources) {
    const list = (source.purpose || "competitor").split(",").map(s => s.trim()).filter(Boolean);
    for (const p of list) {
      if (purposeStats[p]) purposeStats[p].sources += 1;
    }
  }

  const handleTogglePurpose = async (purposeKey, enable) => {
    setTogglingPurpose(purposeKey);
    setMessage(null);
    try {
      const targets = purposeRules.filter(
        r => (r.purpose || "competitor") === purposeKey && (enable ? !r.active : r.active)
      );
      await Promise.all(targets.map(rule => backendApi.updateFilterRule(rule.id, {
        name: rule.name,
        mustInclude: parseJsonArray(rule.must_include),
        mustExclude: parseJsonArray(rule.must_exclude),
        active: enable,
        priority: rule.priority || 0,
        purpose: rule.purpose || ""
      })));
      setPurposeRules(prev => prev.map(r => (
        (r.purpose || "competitor") === purposeKey ? { ...r, active: enable ? 1 : 0 } : r
      )));
      setMessage({
        type: "success",
        text: language === "zh"
          ? `${purposeLabels[purposeKey]}已${enable ? "启用" : "停用"}`
          : `${purposeLabels[purposeKey]} ${enable ? "enabled" : "disabled"}`
      });
    } catch (err) {
      setMessage({
        type: "error",
        text: `${language === "zh" ? "更新失败" : "Update failed"}: ${err.message}`
      });
    } finally {
      setTogglingPurpose(null);
    }
  };

  // 监控信源选项 = 系统支持并可在"数据来源"页创建的合法类型
  const sourceTypeOptions = [...SOURCE_TYPES];

  const toggleSourceType = (type) => {
    setSettings(prev => ({
      ...prev,
      enabledSourceTypes: prev.enabledSourceTypes.includes(type)
        ? prev.enabledSourceTypes.filter(x => x !== type)
        : [...prev.enabledSourceTypes, type]
    }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await backendApi.updateTrackerSettings({
        lookbackHours: Number(settings.lookbackHours),
        maxPerSource: Number(settings.maxPerSource),
        wechatMcpPerFeedLimit: Number(settings.wechatMcpPerFeedLimit),
        requiredIndustryKeywords: fromCsv(settings.requiredIndustryKeywords),
        fuzzyDeduplicationThreshold: Number(settings.fuzzyDeduplicationThreshold),
        scheduleEnabled: settings.scheduleEnabled === true,
        scheduleFrequency: settings.scheduleFrequency,
        scheduleTime: settings.scheduleTime,
        scheduleWeekday: Number(settings.scheduleWeekday),
        enabledSourceTypes: settings.enabledSourceTypes
      });
      setMessage({ type: "success", text: t.saved });
    } catch (err) {
      setMessage({ type: "error", text: `${t.saveFailed}: ${err.message}` });
    }
    setSaving(false);
  };

  const secondaryText = darkMode ? "#aaa" : COLORS.text.secondary;

  const inputStyle = {
    padding: "8px 12px",
    borderRadius: BORDER_RADIUS.md,    border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
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

      <div style={{
        background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
        borderRadius: BORDER_RADIUS.lg,
        border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
        padding: "16px 20px",
        marginBottom: 20,
        maxWidth: 640
      }}>
        <h3 style={{ margin: "0 0 4px", color: darkMode ? "#fff" : COLORS.text.primary }}>
          {language === "zh" ? "监控目的" : "Monitoring Purposes"}
        </h3>
        <p style={{ margin: "0 0 12px", fontSize: FONT_SIZES.sm, color: darkMode ? "#888" : COLORS.text.secondary }}>
          {language === "zh"
            ? "停用某个目的会将其所有过滤规则设为不启用，跟踪器将不再按该目的过滤。"
            : "Disabling a purpose deactivates all of its filter rules; the tracker will no longer filter by it."}
        </p>
        {PURPOSE_KEYS.map(key => {
          const stats = purposeStats[key];
          const enabled = stats.active > 0;
          const busy = togglingPurpose === key;
          return (
            <div key={key} style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 0",
              borderTop: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`
            }}>
              <input
                type="checkbox"
                checked={enabled}
                disabled={busy || stats.total === 0}
                onChange={e => handleTogglePurpose(key, e.target.checked)}
                style={{ width: 16, height: 16, cursor: busy || stats.total === 0 ? "not-allowed" : "pointer" }}
              />
              <span style={{
                fontWeight: 600,
                color: darkMode ? "#e8e8e8" : COLORS.text.primary,
                fontSize: FONT_SIZES.base,
                minWidth: 160
              }}>
                {purposeLabels[key] || key}
              </span>
              <span style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#888" : COLORS.text.secondary }}>
                {stats.total === 0
                  ? (language === "zh" ? "未配置规则" : "No rules configured")
                  : (language === "zh"
                    ? `${stats.active}/${stats.total} 条规则启用 · ${stats.sources} 个来源`
                    : `${stats.active}/${stats.total} rules active · ${stats.sources} sources`)}
              </span>
              {busy && (
                <span style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#888" : "#aaa" }}>
                  {language === "zh" ? "更新中..." : "Updating..."}
                </span>
              )}
            </div>
          );
        })}

        <div style={{ borderTop: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`, marginTop: 8, paddingTop: 12 }}>
          <h4 style={{ margin: "0 0 4px", color: darkMode ? "#fff" : COLORS.text.primary, fontSize: FONT_SIZES.base }}>
            {t.sourcesTitle}
          </h4>
          <p style={{ margin: "0 0 10px", fontSize: FONT_SIZES.sm, color: darkMode ? "#888" : COLORS.text.secondary }}>
            {t.sourcesDesc}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 18px" }}>
            {sourceTypeOptions.map(type => (
              <label key={type} style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: FONT_SIZES.sm, color: darkMode ? "#e8e8e8" : COLORS.text.primary,
                cursor: "pointer"
              }}>
                <input
                  type="checkbox"
                  checked={settings.enabledSourceTypes.includes(type)}
                  onChange={() => toggleSourceType(type)}
                  style={{ width: 16, height: 16, cursor: "pointer" }}
                />
                {t.sourceTypes?.[type] || type}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div style={{
        background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
        borderRadius: BORDER_RADIUS.lg,
        border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
        padding: "16px 20px",
        marginBottom: 20,
        maxWidth: 640
      }}>
        <h3 style={{ margin: "0 0 4px", color: darkMode ? "#fff" : COLORS.text.primary }}>
          {t.scheduleTitle}
        </h3>
        <p style={{ margin: "0 0 12px", fontSize: FONT_SIZES.sm, color: darkMode ? "#888" : COLORS.text.secondary }}>
          {t.scheduleDesc}
        </p>

        <label style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
          fontSize: FONT_SIZES.base, color: darkMode ? "#e8e8e8" : COLORS.text.primary, cursor: "pointer"
        }}>
          <input
            type="checkbox"
            checked={settings.scheduleEnabled}
            onChange={e => handleChange("scheduleEnabled", e.target.checked)}
            style={{ width: 16, height: 16, cursor: "pointer" }}
          />
          {t.scheduleToggle}
        </label>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", opacity: settings.scheduleEnabled ? 1 : 0.5, pointerEvents: settings.scheduleEnabled ? "auto" : "none" }}>
          <div style={{ flex: "0 0 auto" }}>
            <label style={labelStyle}>{t.frequencyLabel}</label>
            <select
              value={settings.scheduleFrequency}
              onChange={e => handleChange("scheduleFrequency", e.target.value)}
              style={inputStyle}
            >
              <option value="daily">{t.daily}</option>
              <option value="weekly">{t.weekly}</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>{t.timeLabel}</label>
            <input
              type="time"
              value={settings.scheduleTime}
              onChange={e => handleChange("scheduleTime", e.target.value)}
              style={{ ...inputStyle, width: 140 }}
            />
          </div>
          {settings.scheduleFrequency === "weekly" && (
            <div>
              <label style={labelStyle}>{t.weekdayLabel}</label>
              <select
                value={settings.scheduleWeekday === 0 ? 7 : settings.scheduleWeekday}
                onChange={e => {
                  const v = Number(e.target.value);
                  handleChange("scheduleWeekday", v === 7 ? 0 : v);
                }}
                style={inputStyle}
              >
                {t.weekdays.map((label, idx) => (
                  <option key={idx} value={idx + 1}>{label}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

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
          <label style={labelStyle}>{t.wechatMcpPerFeedLimit}</label>
          <input
            type="number"
            min={1}
            max={50}
            value={settings.wechatMcpPerFeedLimit}
            onChange={e => handleChange("wechatMcpPerFeedLimit", e.target.value)}
            style={inputStyle}
          />
          <div style={{ fontSize: 11, color: secondaryText, marginTop: 2 }}>
            {language === "zh" ? "微信公众号每个公众号抓取的文章数量上限" : "Max articles fetched per WeChat official account"}
          </div>
        </div>

        <div>
          <label style={labelStyle}>{t.requiredIndustryKeywords}</label>
          <input
            type="text"
            value={settings.requiredIndustryKeywords}
            style={{ ...inputStyle, background: darkMode ? "#222" : "#f0f0f0", cursor: "not-allowed" }}
            readOnly
          />
          <div style={{ fontSize: 11, color: darkMode ? "#777" : "#999", marginTop: 4 }}>
            {language === "zh" ? "由内容过滤页的行业初筛管理" : "Managed by industry filter in Content Filters"}
          </div>
        </div>

        <div>
          <label style={labelStyle}>{t.fuzzyDeduplicationThreshold}</label>
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={settings.fuzzyDeduplicationThreshold}
            onChange={e => handleChange("fuzzyDeduplicationThreshold", e.target.value)}
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
