import { useState, useEffect, useCallback, useRef } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { i18n } from "../constants/i18n";
import { backendApi } from "../utils/backendApi";
import { parseContentFiltersCsv, buildContentFiltersCsv, downloadCsv } from "../utils/csvConfig";

const PURPOSES = [
  { value: "competitor", zh: "竞争对手", en: "Competitor" },
  { value: "policy", zh: "政策动态", en: "Policy" },
  { value: "tech", zh: "技术突破", en: "Tech" }
];

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

  const [editingKeyword, setEditingKeyword] = useState(null);
  const [editKeywordValue, setEditKeywordValue] = useState("");
  const [newKeywordForType, setNewKeywordForType] = useState({});
  const [collapsedPurposes, setCollapsedPurposes] = useState({});

  const [editingCategory, setEditingCategory] = useState(null);
  const [editCategoryForm, setEditCategoryForm] = useState({ description: "", prompt: "" });

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
      const text = await file.text();
      const parsed = parseContentFiltersCsv(text);

      const payload = {
        excludeKeywords: parsed.excludeKeywords,
        enterpriseKeywords: parsed.enterpriseKeywords || [],
        includeKeywords: parsed.includeKeywords || [],
        semanticPrompt: parsed.semanticPrompt,
        categories: parsed.categories,
        sources: []
      };

      const jsonStr = JSON.stringify(payload);
      const base64Payload = btoa(unescape(encodeURIComponent(jsonStr)));

      const res = await backendApi.importConfig(base64Payload, "filters.csv", uploadMode);
      showMessage("success", `${t.importSuccess}: ${res.data.rulesImported} ${t.rules}, ${res.data.categoriesImported} ${t.categories}`);
      loadAll();
    } catch (err) {
      showMessage("error", `${t.importFailed}: ${err.message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const exportCsv = async () => {
    try {
      const [rulesRes, categoriesRes, configRes] = await Promise.all([
        backendApi.getFilterRules(),
        backendApi.getBusinessCategories(),
        backendApi.getSemanticConfig()
      ]);
      const csv = buildContentFiltersCsv(rulesRes.data || [], categoriesRes.data || [], configRes.data || { content: "" });
      downloadCsv(`content-filters-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    } catch (err) {
      showMessage("error", `${t.exportFailed}: ${err.message}`);
    }
  };

  const downloadTemplate = () => {
    const a = document.createElement("a");
    a.href = "/content-filters-template.csv";
    a.download = "content-filters-template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };



  const addTypedKeyword = async (type, purpose) => {
    const key = `${purpose}:${type}`;
    const value = (newKeywordForType[key] || "").trim();
    if (!value) return;
    try {
      await backendApi.createFilterRule({
        type,
        name: value,
        mustInclude: [],
        mustExclude: type === "exclude_keyword" ? [value] : [],
        active: true,
        priority: 0,
        purpose
      });
      setNewKeywordForType(prev => ({ ...prev, [key]: "" }));
      loadAll();
      showMessage("success", t.keywordAdded);
    } catch (err) {
      showMessage("error", `${t.saveFailed}: ${err.message}`);
    }
  };

  const deleteTypedKeyword = async (id) => {
    if (!confirm(t.confirmDelete)) return;
    try {
      await backendApi.deleteFilterRule(id);
      loadAll();
    } catch (err) {
      showMessage("error", err.message);
    }
  };

  const startEditTypedKeyword = (rule) => {
    setEditingKeyword(rule.id);
    setEditKeywordValue(rule.name || "");
  };

  const saveTypedKeyword = async (id) => {
    const rule = rules.find(r => r.id === id);
    if (!rule) return;
    const value = editKeywordValue.trim();
    if (!value) return;
    try {
      await backendApi.updateFilterRule(id, {
        name: value,
        mustInclude: [],
        mustExclude: rule.type === "exclude_keyword" ? [value] : [],
        active: true,
        priority: rule.priority || 0,
        purpose: rule.purpose || ""
      });
      setEditingKeyword(null);
      loadAll();
      showMessage("success", t.keywordUpdated);
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

  const startEditCategory = (category) => {
    setEditingCategory(category.id);
    setEditCategoryForm({
      description: category.description || "",
      prompt: category.inclusion_prompt || ""
    });
  };

  const saveCategory = async (category) => {
    try {
      await backendApi.updateBusinessCategory(category.id, {
        description: editCategoryForm.description,
        inclusion_prompt: editCategoryForm.prompt,
        active: category.active ? 1 : 0
      });
      setEditingCategory(null);
      loadAll();
      showMessage("success", t.categoryUpdated);
    } catch (err) {
      showMessage("error", err.message);
    }
  };

  const enterpriseKeywords = rules.filter(r => r.type === "enterprise");
  const includeKeywords = rules.filter(r => r.type === "include_keyword");
  const excludeKeywords = rules.filter(r => r.type === "exclude_keyword");

  const rulesByPurpose = {};
  for (const p of PURPOSES) {
    rulesByPurpose[p.value] = {
      enterprise: enterpriseKeywords.filter(r => (r.purpose || "competitor") === p.value),
      include_keyword: includeKeywords.filter(r => (r.purpose || "competitor") === p.value),
      exclude_keyword: excludeKeywords.filter(r => (r.purpose || "competitor") === p.value)
    };
  }

  const togglePurposeSection = (value) => {
    setCollapsedPurposes(prev => ({ ...prev, [value]: !prev[value] }));
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
        <h3 style={{ margin: "0 0 12px", color: darkMode ? "#fff" : COLORS.text.primary }}>{t.importCsv}</h3>
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
          accept=".csv"
          onChange={handleFileChange}
          disabled={uploading}
          style={{ color: text, marginBottom: 12 }}
        />
        {uploading && <div style={{ marginTop: 8, color: secondaryText, fontSize: FONT_SIZES.sm }}>{t.uploading}</div>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={exportCsv}
            style={{
              padding: "8px 16px",
              borderRadius: BORDER_RADIUS.md,
              border: `1px solid ${COLORS.primary}`,
              background: "transparent",
              color: COLORS.primary,
              fontSize: FONT_SIZES.sm,
              fontWeight: 600,
              cursor: "pointer"
            }}
          >{t.exportCsv}</button>
          <button
            type="button"
            onClick={downloadTemplate}
            style={{
              padding: "8px 16px",
              borderRadius: BORDER_RADIUS.md,
              border: `1px solid ${border}`,
              background: darkMode ? "#1c1f2b" : "#fff",
              color: text,
              fontSize: FONT_SIZES.sm,
              fontWeight: 600,
              cursor: "pointer"
            }}
          >{t.downloadTemplate}</button>
        </div>
      </div>

      <div style={{
        background: cardBg,
        borderRadius: BORDER_RADIUS.lg,
        border: `1px solid ${border}`,
        padding: "16px 20px",
        marginBottom: 20
      }}>
        <h3 style={{ margin: "0 0 16px", color: darkMode ? "#fff" : COLORS.text.primary }}>{t.compositeRules}</h3>

        {PURPOSES.map(p => {
          const purposeRules = rulesByPurpose[p.value];
          const collapsed = !!collapsedPurposes[p.value];
          const totalCount = purposeRules.enterprise.length + purposeRules.include_keyword.length + purposeRules.exclude_keyword.length;
          return (
            <div key={p.value} style={{ marginBottom: 16 }}>
              <div
                onClick={() => togglePurposeSection(p.value)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  userSelect: "none",
                  marginBottom: collapsed ? 0 : 12,
                  color: darkMode ? "#fff" : COLORS.text.primary
                }}
              >
                <span style={{ fontSize: FONT_SIZES.sm, color: secondaryText }}>{collapsed ? "▶" : "▼"}</span>
                <h4 style={{ margin: 0, fontSize: FONT_SIZES.lg, fontWeight: 700 }}>
                  {language === "zh" ? p.zh : p.en}
                </h4>
                <span style={{ fontSize: FONT_SIZES.sm, color: secondaryText }}>({totalCount})</span>
              </div>
              {!collapsed && [{
                type: "enterprise",
                label: t.enterpriseKeywords,
                items: purposeRules.enterprise,
                placeholder: t.enterpriseKeywordPlaceholder
              }, {
                type: "include_keyword",
                label: t.includeKeywords,
                items: purposeRules.include_keyword,
                placeholder: t.includeKeywordPlaceholder
              }, {
                type: "exclude_keyword",
                label: t.excludeKeywords,
                items: purposeRules.exclude_keyword,
                placeholder: t.keywordPlaceholder
              }].map(({ type, label, items, placeholder }) => {
                const inputKey = `${p.value}:${type}`;
                return (
          <div key={type} style={{ marginBottom: 20, paddingLeft: 20 }}>
            <h4 style={{ margin: "0 0 10px", color: darkMode ? "#ccc" : COLORS.text.secondary, fontSize: FONT_SIZES.md, fontWeight: 600 }}>{label}</h4>
            <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
              <input
                type="text"
                value={newKeywordForType[inputKey] || ""}
                onChange={(e) => setNewKeywordForType(prev => ({ ...prev, [inputKey]: e.target.value }))}
                placeholder={placeholder}
                style={{ ...inputStyle, flex: 1, minWidth: 180 }}
              />
              <button type="button" onClick={() => addTypedKeyword(type, p.value)} style={{
                padding: "8px 16px",
                borderRadius: BORDER_RADIUS.md,
                border: "none",
                background: COLORS.primary,
                color: "#fff",
                fontSize: FONT_SIZES.md,
                fontWeight: 600,
                cursor: "pointer"
              }}>{t.add}</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {items.map(rule => {
                const isEditing = editingKeyword === rule.id;
                return (
                  <div key={rule.id} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    borderRadius: BORDER_RADIUS.md,
                    background: COLORS.primaryLight,
                    border: `1px solid ${COLORS.primary}`,
                    transition: `all ${TRANSITIONS.fast}`
                  }}>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editKeywordValue}
                        onChange={(e) => setEditKeywordValue(e.target.value)}
                        onBlur={() => saveTypedKeyword(rule.id)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveTypedKeyword(rule.id); if (e.key === "Escape") setEditingKeyword(null); }}
                        autoFocus
                        style={{ ...inputStyle, width: 120, padding: "4px 8px", fontSize: FONT_SIZES.sm }}
                      />
                    ) : (
                      <span style={{
                        color: COLORS.primary,
                        fontSize: FONT_SIZES.sm,
                        fontWeight: 500,
                        cursor: "pointer"
                      }} onClick={() => startEditTypedKeyword(rule)}>{rule.name}</span>
                    )}
                    <button
                      onClick={() => deleteTypedKeyword(rule.id)}
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
              {items.length === 0 && (
                <div style={{ color: secondaryText, fontSize: FONT_SIZES.sm }}>{t.noKeywords}</div>
              )}
            </div>
          </div>
                );
              })}
            </div>
          );
        })}
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
          {categories.map(category => {
            const isEditing = editingCategory === category.id;
            return (
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
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => isEditing ? setEditingCategory(null) : startEditCategory(category)}
                      style={{
                        padding: "4px 10px",
                        borderRadius: BORDER_RADIUS.md,
                        border: `1px solid ${border}`,
                        background: "transparent",
                        color: text,
                        fontSize: FONT_SIZES.xs,
                        cursor: "pointer"
                      }}
                    >{isEditing ? t.cancel : t.edit}</button>
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
                </div>
                {isEditing ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <textarea
                      value={editCategoryForm.description}
                      onChange={(e) => setEditCategoryForm({ ...editCategoryForm, description: e.target.value })}
                      rows={2}
                      placeholder="Description"
                      style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontFamily: "inherit" }}
                    />
                    <textarea
                      value={editCategoryForm.prompt}
                      onChange={(e) => setEditCategoryForm({ ...editCategoryForm, prompt: e.target.value })}
                      rows={4}
                      placeholder="Inclusion prompt"
                      style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontFamily: "inherit" }}
                    />
                    <button onClick={() => saveCategory(category)} style={{
                      padding: "6px 12px",
                      borderRadius: BORDER_RADIUS.md,
                      border: "none",
                      background: COLORS.primary,
                      color: "#fff",
                      fontSize: FONT_SIZES.sm,
                      fontWeight: 600,
                      cursor: "pointer",
                      alignSelf: "flex-start"
                    }}>{t.save}</button>
                  </div>
                ) : (
                  <div style={{ fontSize: FONT_SIZES.sm, color: secondaryText, lineHeight: 1.4 }}>
                    {category.description}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
