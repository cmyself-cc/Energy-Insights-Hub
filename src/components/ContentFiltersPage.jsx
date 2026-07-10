import { useState, useEffect, useCallback, useRef } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { i18n } from "../constants/i18n";
import { backendApi } from "../utils/backendApi";

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return value.split(",").map(s => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function toCsv(arr) {
  if (!Array.isArray(arr)) return "";
  return arr.join(", ");
}

function fromCsv(str) {
  return str.split(",").map(s => s.trim()).filter(Boolean);
}

export default function ContentFiltersPage({ darkMode, language }) {
  const t = i18n[language]?.contentFilters || i18n.en.contentFilters;
  const [rules, setRules] = useState([]);
  const [categories, setCategories] = useState([]);
  const [semanticConfig, setSemanticConfig] = useState({ content: "", active: 1 });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  const [uploadMode, setUploadMode] = useState("append");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const [newKeyword, setNewKeyword] = useState("");
  const [ruleForm, setRuleForm] = useState({
    name: "",
    mustInclude: "",
    mustExclude: "",
    priority: "0"
  });

  const border = darkMode ? COLORS.border.dark : COLORS.border.light;
  const cardBg = darkMode ? COLORS.background.cardDark : COLORS.background.card;
  const text = darkMode ? "#e8e8e8" : COLORS.text.primary;
  const secondaryText = darkMode ? "#aaa" : COLORS.text.secondary;

  const inputStyle = {
    padding: "8px 12px",
    borderRadius: BORDER_RADIUS.md,
    border: `1px solid ${border}`,
    background: darkMode ? "#1c1f2b" : "#fff",
    color: text,
    fontSize: FONT_SIZES.base,
    outline: "none"
  };

  const labelStyle = {
    display: "block",
    marginBottom: 6,
    fontSize: FONT_SIZES.sm,
    color: secondaryText,
    fontWeight: 500
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, categoriesRes, configRes] = await Promise.all([
        backendApi.getFilterRules(),
        backendApi.getBusinessCategories(),
        backendApi.getSemanticConfig()
      ]);
      setRules(rulesRes.data || []);
      setCategories(categoriesRes.data || []);
      setSemanticConfig(configRes.data || { content: "", active: 1 });
    } catch (err) {
      setMessage({ type: "error", text: `${t.loadFailed}: ${err.message}` });
    }
    setLoading(false);
  }, [t.loadFailed]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const showMessage = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = String(event.target?.result || "");
        const base64Payload = base64.includes(",") ? base64.split(",")[1] : base64;
        try {
          const res = await backendApi.importConfig(base64Payload, file.name, uploadMode);
          showMessage("success", `${t.importSuccess}: ${res.data.rulesImported} ${t.rules}, ${res.data.categoriesImported} ${t.categories}, ${res.data.sourcesImported} ${t.sources}`);
          loadAll();
        } catch (err) {
          showMessage("error", `${t.importFailed}: ${err.message}`);
        } finally {
          setUploading(false);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }
      };
      reader.onerror = () => {
        showMessage("error", t.readFileFailed);
        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      showMessage("error", err.message);
      setUploading(false);
    }
  };

  const addKeyword = async (e) => {
    e.preventDefault();
    if (!newKeyword.trim()) return;
    try {
      await backendApi.createFilterRule({
        type: "exclude_keyword",
        name: newKeyword.trim(),
        mustInclude: [],
        mustExclude: [newKeyword.trim()],
        active: true,
        priority: 0
      });
      setNewKeyword("");
      loadAll();
      showMessage("success", t.keywordAdded);
    } catch (err) {
      showMessage("error", `${t.saveFailed}: ${err.message}`);
    }
  };

  const deleteKeyword = async (id) => {
    if (!confirm(t.confirmDelete)) return;
    try {
      await backendApi.deleteFilterRule(id);
      loadAll();
    } catch (err) {
      showMessage("error", err.message);
    }
  };

  const toggleRuleActive = async (rule) => {
    try {
      await backendApi.updateFilterRule(rule.id, {
        name: rule.name,
        mustInclude: parseJsonArray(rule.must_include),
        mustExclude: parseJsonArray(rule.must_exclude),
        active: !rule.active,
        priority: rule.priority || 0
      });
      loadAll();
    } catch (err) {
      showMessage("error", err.message);
    }
  };

  const addCompositeRule = async (e) => {
    e.preventDefault();
    if (!ruleForm.mustInclude.trim()) return;
    try {
      await backendApi.createFilterRule({
        type: "composite",
        name: ruleForm.name.trim() || null,
        mustInclude: fromCsv(ruleForm.mustInclude),
        mustExclude: fromCsv(ruleForm.mustExclude),
        active: true,
        priority: Number(ruleForm.priority) || 0
      });
      setRuleForm({ name: "", mustInclude: "", mustExclude: "", priority: "0" });
      loadAll();
      showMessage("success", t.ruleAdded);
    } catch (err) {
      showMessage("error", `${t.saveFailed}: ${err.message}`);
    }
  };

  const deleteCompositeRule = async (id) => {
    if (!confirm(t.confirmDelete)) return;
    try {
      await backendApi.deleteFilterRule(id);
      loadAll();
    } catch (err) {
      showMessage("error", err.message);
    }
  };

  const saveSemanticConfig = async (e) => {
    e.preventDefault();
    try {
      await backendApi.updateSemanticConfig({
        content: semanticConfig.content,
        active: semanticConfig.active ? 1 : 0
      });
      showMessage("success", t.saved);
    } catch (err) {
      showMessage("error", `${t.saveFailed}: ${err.message}`);
    }
  };

  const toggleCategory = async (category) => {
    try {
      await backendApi.updateBusinessCategory(category.id, {
        description: category.description,
        inclusion_prompt: category.inclusion_prompt,
        active: category.active ? 0 : 1
      });
      loadAll();
    } catch (err) {
      showMessage("error", err.message);
    }
  };

  const excludeKeywords = rules.filter(r => r.type === "exclude_keyword");
  const compositeRules = rules.filter(r => r.type === "composite");

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
          background: message.type === "success" ? "#e8f5ee" : message.type === "warning" ? "#fff8e6" : "#fff0f0",
          border: `1px solid ${message.type === "success" ? COLORS.primary : message.type === "warning" ? COLORS.status.warning : "#c00"}`,
          color: message.type === "success" ? COLORS.primary : message.type === "warning" ? "#b38600" : "#c00",
          marginBottom: 16
        }}>
          {message.text}
        </div>
      )}

      <div style={{
        background: cardBg,
        borderRadius: BORDER_RADIUS.lg,
        border: `1px solid ${border}`,
        padding: "16px 20px",
        marginBottom: 20
      }}>
        <h3 style={{ margin: "0 0 12px", color: darkMode ? "#fff" : COLORS.text.primary }}>{t.importConfig}</h3>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input
              type="radio"
              value="append"
              checked={uploadMode === "append"}
              onChange={() => setUploadMode("append")}
            />
            <span style={{ color: text }}>{t.modeAppend}</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input
              type="radio"
              value="replace"
              checked={uploadMode === "replace"}
              onChange={() => setUploadMode("replace")}
            />
            <span style={{ color: text }}>{t.modeReplace}</span>
          </label>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.xlsx"
          onChange={handleFileChange}
          disabled={uploading}
          style={{ color: text }}
        />
        {uploading && <div style={{ marginTop: 8, color: secondaryText, fontSize: FONT_SIZES.sm }}>{t.uploading}</div>}
      </div>

      <div style={{
        background: cardBg,
        borderRadius: BORDER_RADIUS.lg,
        border: `1px solid ${border}`,
        padding: "16px 20px",
        marginBottom: 20
      }}>
        <h3 style={{ margin: "0 0 12px", color: darkMode ? "#fff" : COLORS.text.primary }}>{t.excludeKeywords}</h3>
        <form onSubmit={addKeyword} style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <input
            type="text"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            placeholder={t.keywordPlaceholder}
            style={{ ...inputStyle, flex: 1, minWidth: 180 }}
          />
          <button type="submit" style={{
            padding: "8px 16px",
            borderRadius: BORDER_RADIUS.md,
            border: "none",
            background: COLORS.primary,
            color: "#fff",
            fontSize: FONT_SIZES.md,
            fontWeight: 600,
            cursor: "pointer"
          }}>{t.add}</button>
        </form>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {excludeKeywords.map(rule => {
            const keyword = parseJsonArray(rule.must_exclude)[0] || rule.name;
            return (
              <div key={rule.id} style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                borderRadius: BORDER_RADIUS.md,
                background: rule.active ? COLORS.primaryLight : darkMode ? "#2a2d3a" : "#f0f0f0",
                border: `1px solid ${rule.active ? COLORS.primary : border}`,
                opacity: rule.active ? 1 : 0.6,
                transition: `all ${TRANSITIONS.fast}`
              }}>
                <span style={{
                  color: rule.active ? COLORS.primary : secondaryText,
                  fontSize: FONT_SIZES.sm,
                  fontWeight: 500,
                  cursor: "pointer"
                }} onClick={() => toggleRuleActive(rule)}>{keyword}</span>
                <button
                  onClick={() => deleteKeyword(rule.id)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#c00",
                    cursor: "pointer",
                    fontSize: FONT_SIZES.md,
                    lineHeight: 1,
                    padding: 0
                  }}
                  title={t.delete}
                >×</button>
              </div>
            );
          })}
          {excludeKeywords.length === 0 && (
            <div style={{ color: secondaryText, fontSize: FONT_SIZES.sm }}>{t.noKeywords}</div>
          )}
        </div>
      </div>

      <div style={{
        background: cardBg,
        borderRadius: BORDER_RADIUS.lg,
        border: `1px solid ${border}`,
        padding: "16px 20px",
        marginBottom: 20
      }}>
        <h3 style={{ margin: "0 0 12px", color: darkMode ? "#fff" : COLORS.text.primary }}>{t.compositeRules}</h3>
        <form onSubmit={addCompositeRule} style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 160px", minWidth: 160 }}>
            <label style={labelStyle}>{t.ruleName}</label>
            <input
              type="text"
              value={ruleForm.name}
              onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
              placeholder={t.ruleNamePlaceholder}
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ flex: "2 1 200px", minWidth: 200 }}>
            <label style={labelStyle}>{t.mustInclude}</label>
            <input
              type="text"
              value={ruleForm.mustInclude}
              onChange={(e) => setRuleForm({ ...ruleForm, mustInclude: e.target.value })}
              placeholder={t.mustIncludePlaceholder}
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ flex: "2 1 200px", minWidth: 200 }}>
            <label style={labelStyle}>{t.mustExclude}</label>
            <input
              type="text"
              value={ruleForm.mustExclude}
              onChange={(e) => setRuleForm({ ...ruleForm, mustExclude: e.target.value })}
              placeholder={t.mustExcludePlaceholder}
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ flex: "0 0 100px" }}>
            <label style={labelStyle}>{t.priority}</label>
            <input
              type="number"
              value={ruleForm.priority}
              onChange={(e) => setRuleForm({ ...ruleForm, priority: e.target.value })}
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
            />
          </div>
          <button type="submit" style={{
            padding: "8px 16px",
            borderRadius: BORDER_RADIUS.md,
            border: "none",
            background: COLORS.primary,
            color: "#fff",
            fontSize: FONT_SIZES.md,
            fontWeight: 600,
            cursor: "pointer"
          }}>{t.add}</button>
        </form>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {compositeRules.map(rule => (
            <div key={rule.id} style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "12px 16px",
              borderRadius: BORDER_RADIUS.md,
              background: darkMode ? "#1c1f2b" : "#f9f9f9",
              border: `1px solid ${border}`,
              opacity: rule.active ? 1 : 0.5
            }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 16, flex: 1, alignItems: "center" }}>
                <div style={{ minWidth: 120, fontWeight: 600, color: rule.active ? text : secondaryText }}>
                  {rule.name || t.unnamedRule}
                </div>
                <div style={{ fontSize: FONT_SIZES.sm, color: secondaryText, minWidth: 160, flex: 1 }}>
                  <span style={{ color: COLORS.status.success, fontWeight: 500 }}>{t.include}: </span>
                  {toCsv(parseJsonArray(rule.must_include)) || "-"}
                </div>
                <div style={{ fontSize: FONT_SIZES.sm, color: secondaryText, minWidth: 160, flex: 1 }}>
                  <span style={{ color: COLORS.status.error, fontWeight: 500 }}>{t.exclude}: </span>
                  {toCsv(parseJsonArray(rule.must_exclude)) || "-"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  onClick={() => toggleRuleActive(rule)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: BORDER_RADIUS.md,
                    border: `1px solid ${rule.active ? COLORS.primary : border}`,
                    background: rule.active ? COLORS.primary : "transparent",
                    color: rule.active ? "#fff" : text,
                    fontSize: FONT_SIZES.sm,
                    cursor: "pointer"
                  }}
                >{rule.active ? t.active : t.inactive}</button>
                <button
                  onClick={() => deleteCompositeRule(rule.id)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: BORDER_RADIUS.md,
                    border: `1px solid #c00`,
                    background: "transparent",
                    color: "#c00",
                    fontSize: FONT_SIZES.sm,
                    cursor: "pointer"
                  }}
                >{t.delete}</button>
              </div>
            </div>
          ))}
          {compositeRules.length === 0 && (
            <div style={{ textAlign: "center", padding: "24px", color: secondaryText, fontSize: FONT_SIZES.sm }}>
              {t.noRules}
            </div>
          )}
        </div>
      </div>

      <form onSubmit={saveSemanticConfig} style={{
        background: cardBg,
        borderRadius: BORDER_RADIUS.lg,
        border: `1px solid ${border}`,
        padding: "16px 20px",
        marginBottom: 20,
        display: "flex",
        flexDirection: "column",
        gap: 12
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <h3 style={{ margin: 0, color: darkMode ? "#fff" : COLORS.text.primary }}>{t.semanticPrompt}</h3>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: text, fontSize: FONT_SIZES.sm }}>
            <input
              type="checkbox"
              checked={!!semanticConfig.active}
              onChange={(e) => setSemanticConfig({ ...semanticConfig, active: e.target.checked })}
            />
            {t.enableSemantic}
          </label>
        </div>
        <textarea
          value={semanticConfig.content || ""}
          onChange={(e) => setSemanticConfig({ ...semanticConfig, content: e.target.value })}
          rows={6}
          style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontFamily: "inherit" }}
        />
        <button type="submit" style={{
          padding: "8px 16px",
          borderRadius: BORDER_RADIUS.md,
          border: "none",
          background: COLORS.primary,
          color: "#fff",
          fontSize: FONT_SIZES.md,
          fontWeight: 600,
          cursor: "pointer",
          alignSelf: "flex-start"
        }}>{t.save}</button>
      </form>

      <div style={{
        background: cardBg,
        borderRadius: BORDER_RADIUS.lg,
        border: `1px solid ${border}`,
        padding: "16px 20px"
      }}>
        <h3 style={{ margin: "0 0 12px", color: darkMode ? "#fff" : COLORS.text.primary }}>{t.businessCategories}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {categories.map(category => (
            <div key={category.id} style={{
              padding: "14px 16px",
              borderRadius: BORDER_RADIUS.md,
              background: category.active ? (darkMode ? "#1c2b22" : "#f6fdf8") : darkMode ? "#1c1f2b" : "#f9f9f9",
              border: `1px solid ${category.active ? COLORS.primary : border}`,
              opacity: category.active ? 1 : 0.6,
              transition: `all ${TRANSITIONS.fast}`
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div style={{ fontWeight: 700, color: darkMode ? "#fff" : COLORS.text.primary, fontSize: FONT_SIZES.lg }}>
                  {category.name}
                </div>
                <button
                  onClick={() => toggleCategory(category)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: BORDER_RADIUS.md,
                    border: `1px solid ${category.active ? COLORS.primary : border}`,
                    background: category.active ? COLORS.primary : "transparent",
                    color: category.active ? "#fff" : text,
                    fontSize: FONT_SIZES.xs,
                    cursor: "pointer"
                  }}
                >{category.active ? t.active : t.inactive}</button>
              </div>
              <div style={{ fontSize: FONT_SIZES.sm, color: secondaryText, lineHeight: 1.4 }}>
                {category.description}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
