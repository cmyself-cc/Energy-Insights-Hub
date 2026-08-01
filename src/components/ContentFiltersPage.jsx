import { useState, useEffect, useCallback } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { i18n } from "../constants/i18n";
import { backendApi } from "../utils/backendApi";

const PURPOSES = [
  { value: "competitor", zh: "竞争对手", en: "Competitor" },
  { value: "policy", zh: "政策动态", en: "Policy" },
  { value: "tech", zh: "技术突破", en: "Tech" }
];

const SEMANTIC_TABS = [
  { value: "competitor", labelKey: "competitorPrompt" },
  { value: "policy", labelKey: "policyPrompt" },
  { value: "tech", labelKey: "techPrompt" },
];

export default function ContentFiltersPage({ darkMode, language }) {
  const t = i18n[language]?.contentFilters || i18n.en.contentFilters;
  const [rules, setRules] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  // Industry pre-filter state
  const [activeIndustryCategories, setActiveIndustryCategories] = useState({});
  const [trackerSettings, setTrackerSettings] = useState(null);
  const [industryCategories, setIndustryCategories] = useState([]);

  // Add category dialog state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryMainKeyword, setNewCategoryMainKeyword] = useState("");
  const [suggestedKeywords, setSuggestedKeywords] = useState([]);
  const [suggesting, setSuggesting] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);

  // Edit category state
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [editingCategoryKeywords, setEditingCategoryKeywords] = useState([]);

  // Keyword filter state

  const [editingKeyword, setEditingKeyword] = useState(null);
  const [editKeywordValue, setEditKeywordValue] = useState("");
  const [newKeywordForType, setNewKeywordForType] = useState({});
  const [collapsedPurposes, setCollapsedPurposes] = useState({});

  // Semantic prompts state
  const [semanticTab, setSemanticTab] = useState("competitor");
  const [semanticPrompts, setSemanticPrompts] = useState({
    competitor: { content: "", active: 1 },
    policy: { content: "", active: 1 },
    tech: { content: "", active: 1 },
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

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, categoriesRes, settingsRes, compPrompt, policyPrompt, techPrompt, industriesRes] = await Promise.all([
        backendApi.getFilterRules(),
        backendApi.getBusinessCategories(),
        backendApi.getTrackerSettings(),
        backendApi.getSemanticConfig("competitor"),
        backendApi.getSemanticConfig("policy"),
        backendApi.getSemanticConfig("tech"),
        backendApi.getIndustryCategories(),
      ]);
      setRules(rulesRes.data || []);
      setCategories(categoriesRes.data || []);
      setTrackerSettings(settingsRes.data || {});
      setIndustryCategories(industriesRes.data || []);
      setSemanticPrompts({
        competitor: compPrompt.data || { content: "", active: 1 },
        policy: policyPrompt.data || { content: "", active: 1 },
        tech: techPrompt.data || { content: "", active: 1 },
      });
      // Determine active industry categories from settings
      const requiredKeywords = settingsRes.data?.requiredIndustryKeywords || [];
      const activeMap = {};
      const cats = industriesRes.data || [];
      for (const cat of cats) {
        const kw = cat.keywords || [];
        activeMap[cat.name] = kw.length > 0 && kw.every(k => requiredKeywords.includes(k));
      }
      setActiveIndustryCategories(activeMap);
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

  // --- Industry filter handlers ---
  const toggleIndustryCategory = async (name) => {
    const newActive = { ...activeIndustryCategories, [name]: !activeIndustryCategories[name] };
    setActiveIndustryCategories(newActive);
    // Build combined keywords from all active categories
    const combined = [];
    for (const cat of industryCategories) {
      if (newActive[cat.name]) {
        combined.push(...(cat.keywords || []));
      }
    }
    try {
      const current = trackerSettings || { lookbackHours: 24, maxPerSource: 3, fuzzyDeduplicationThreshold: 0.85 };
      await backendApi.updateTrackerSettings({
        ...current,
        requiredIndustryKeywords: [...new Set(combined)],
      });
    } catch (err) {
      showMessage("error", `${t.saveFailed}: ${err.message}`);
    }
  };

  const selectAllIndustry = async () => {
    const allActive = {};
    const combined = [];
    for (const cat of industryCategories) {
      allActive[cat.name] = true;
      combined.push(...(cat.keywords || []));
    }
    setActiveIndustryCategories(allActive);
    try {
      const current = trackerSettings || { lookbackHours: 24, maxPerSource: 3, fuzzyDeduplicationThreshold: 0.85 };
      await backendApi.updateTrackerSettings({
        ...current,
        requiredIndustryKeywords: [...new Set(combined)],
      });
    } catch (err) {
      showMessage("error", `${t.saveFailed}: ${err.message}`);
    }
  };

  const deselectAllIndustry = async () => {
    const allInactive = {};
    for (const cat of industryCategories) {
      allInactive[cat.name] = false;
    }
    setActiveIndustryCategories(allInactive);
    try {
      const current = trackerSettings || { lookbackHours: 24, maxPerSource: 3, fuzzyDeduplicationThreshold: 0.85 };
      await backendApi.updateTrackerSettings({
        ...current,
        requiredIndustryKeywords: [],
      });
    } catch (err) {
      showMessage("error", `${t.saveFailed}: ${err.message}`);
    }
  };

  // --- Add category handlers ---
  const openAddDialog = () => {
    setNewCategoryName("");
    setNewCategoryMainKeyword("");
    setSuggestedKeywords([]);
    setShowAddDialog(true);
  };

  const handleSuggestKeywords = async () => {
    const kw = newCategoryMainKeyword.trim();
    if (!kw) return;
    setSuggesting(true);
    try {
      const res = await backendApi.suggestIndustryKeywords(kw);
      setSuggestedKeywords(res.data?.keywords || []);
    } catch (err) {
      showMessage("error", `关键词建议失败: ${err.message}`);
    }
    setSuggesting(false);
  };

  const removeSuggestedKeyword = (idx) => {
    setSuggestedKeywords(prev => prev.filter((_, i) => i !== idx));
  };

  const addSuggestedKeywordInput = (e) => {
    if (e.key === "Enter" && e.target.value.trim()) {
      setSuggestedKeywords(prev => [...prev, e.target.value.trim()]);
      e.target.value = "";
    }
  };

  const handleSaveCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    setSavingCategory(true);
    try {
      await backendApi.createIndustryCategory({ name, keywords: suggestedKeywords });
      showMessage("success", `业务方向 "${name}" 已创建`);
      setShowAddDialog(false);
      loadAll();
    } catch (err) {
      showMessage("error", `创建失败: ${err.message}`);
    }
    setSavingCategory(false);
  };

  // --- Edit category handlers ---
  const startEditCategory = (cat) => {
    setEditingCategoryId(cat.id);
    setEditingCategoryName(cat.name);
    setEditingCategoryKeywords([...(cat.keywords || [])]);
  };

  const cancelEditCategory = () => {
    setEditingCategoryId(null);
    setEditingCategoryName("");
    setEditingCategoryKeywords([]);
  };

  const saveEditCategory = async (id) => {
    const name = editingCategoryName.trim();
    if (!name) return;
    try {
      await backendApi.updateIndustryCategory(id, { name, keywords: editingCategoryKeywords });
      showMessage("success", "已更新");
      cancelEditCategory();
      loadAll();
    } catch (err) {
      showMessage("error", `更新失败: ${err.message}`);
    }
  };

  const addEditKeyword = (e) => {
    if (e.key === "Enter" && e.target.value.trim()) {
      setEditingCategoryKeywords(prev => [...prev, e.target.value.trim()]);
      e.target.value = "";
    }
  };

  const removeEditKeyword = (idx) => {
    setEditingCategoryKeywords(prev => prev.filter((_, i) => i !== idx));
  };

  const deleteCategory = async (cat) => {
    if (!confirm(`确定删除业务方向 "${cat.name}"？`)) return;
    try {
      await backendApi.deleteIndustryCategory(cat.id);
      showMessage("success", `已删除 "${cat.name}"`);
      loadAll();
    } catch (err) {
      showMessage("error", `删除失败: ${err.message}`);
    }
  };

  // --- Keyword filter handlers ---
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

  // --- Semantic prompt handlers ---
  const saveSemanticPrompt = async (purpose) => {
    const cfg = semanticPrompts[purpose];
    try {
      await backendApi.updateSemanticConfig({
        content: cfg.content,
        active: cfg.active ? 1 : 0
      }, purpose);
      showMessage("success", t.saved);
    } catch (err) {
      showMessage("error", `${t.saveFailed}: ${err.message}`);
    }
  };

  const togglePurposeSection = (value) => {
    setCollapsedPurposes(prev => ({ ...prev, [value]: !prev[value] }));
  };

  // --- Derived data ---
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

      {/* ========== Section 1: Industry Pre-filter ========== */}
      <div style={{
        background: cardBg,
        borderRadius: BORDER_RADIUS.lg,
        border: `1px solid ${border}`,
        padding: "16px 20px",
        marginBottom: 20
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ margin: 0, color: darkMode ? "#fff" : COLORS.text.primary, fontSize: FONT_SIZES.xl, fontWeight: 700 }}>
            {t.industryFilter}
          </h3>
          <button onClick={openAddDialog} style={{
            padding: "6px 14px", borderRadius: BORDER_RADIUS.md,
            border: `1px dashed ${COLORS.primary}`,
            background: "transparent", color: COLORS.primary,
            fontSize: FONT_SIZES.sm, fontWeight: 600, cursor: "pointer"
          }}>＋ 添加业务方向</button>
        </div>
        <p style={{ margin: "0 0 16px", color: secondaryText, fontSize: FONT_SIZES.sm }}>
          {t.industryFilterDesc}
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <button onClick={selectAllIndustry} style={{
            padding: "6px 14px", borderRadius: BORDER_RADIUS.md,
            border: `1px solid ${COLORS.primary}`,
            background: "transparent", color: COLORS.primary,
            fontSize: FONT_SIZES.sm, fontWeight: 600, cursor: "pointer"
          }}>{t.selectAll}</button>
          <button onClick={deselectAllIndustry} style={{
            padding: "6px 14px", borderRadius: BORDER_RADIUS.md,
            border: `1px solid ${border}`,
            background: darkMode ? "#1c1f2b" : "#fff", color: text,
            fontSize: FONT_SIZES.sm, fontWeight: 600, cursor: "pointer"
          }}>{t.deselectAll}</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {industryCategories.map(cat => {
            const isActive = !!activeIndustryCategories[cat.name];
            const isEditing = editingCategoryId === cat.id;
            if (isEditing) {
              return (
                <div key={cat.id} style={{
                  padding: "10px 14px", borderRadius: BORDER_RADIUS.md,
                  border: `1px solid ${COLORS.primary}`,
                  background: darkMode ? "#1c1f2b" : "#fff",
                  minWidth: 260
                }}>
                  <input
                    value={editingCategoryName}
                    onChange={(e) => setEditingCategoryName(e.target.value)}
                    style={{ ...inputStyle, width: "100%", marginBottom: 8, fontSize: FONT_SIZES.sm }}
                    placeholder="业务方向名称"
                  />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                    {editingCategoryKeywords.map((kw, i) => (
                      <span key={i} style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: "2px 8px", borderRadius: 10,
                        background: COLORS.primaryLight, color: COLORS.primary,
                        fontSize: FONT_SIZES.xs
                      }}>
                        {kw}
                        <span onClick={() => removeEditKeyword(i)} style={{ cursor: "pointer", fontWeight: 700 }}>×</span>
                      </span>
                    ))}
                  </div>
                  <input
                    placeholder="输入关键词后按回车添加..."
                    onKeyDown={addEditKeyword}
                    style={{ ...inputStyle, width: "100%", fontSize: FONT_SIZES.xs, padding: "4px 8px" }}
                  />
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <button onClick={() => saveEditCategory(cat.id)} style={{
                      padding: "4px 12px", borderRadius: BORDER_RADIUS.sm,
                      border: "none", background: COLORS.primary, color: "#fff",
                      fontSize: FONT_SIZES.xs, cursor: "pointer"
                    }}>保存</button>
                    <button onClick={cancelEditCategory} style={{
                      padding: "4px 12px", borderRadius: BORDER_RADIUS.sm,
                      border: `1px solid ${border}`, background: "transparent",
                      color: text, fontSize: FONT_SIZES.xs, cursor: "pointer"
                    }}>取消</button>
                  </div>
                </div>
              );
            }
            return (
              <div key={cat.id} style={{
                display: "flex", alignItems: "center", gap: 6
              }}>
                <button
                  onClick={() => toggleIndustryCategory(cat.name)}
                  style={{
                    padding: "10px 18px",
                    borderRadius: BORDER_RADIUS.md,
                    border: `1px solid ${isActive ? COLORS.primary : border}`,
                    background: isActive ? COLORS.primary : (darkMode ? "#1c1f2b" : "#fff"),
                    color: isActive ? "#fff" : text,
                    fontSize: FONT_SIZES.md,
                    fontWeight: isActive ? 700 : 500,
                    cursor: "pointer",
                    transition: `all ${TRANSITIONS.fast}`
                  }}
                >
                  {cat.name}
                  <span style={{ fontSize: FONT_SIZES.xs, marginLeft: 4, opacity: 0.7 }}>
                    ({(cat.keywords || []).length})
                  </span>
                </button>
                <span
                  onClick={() => startEditCategory(cat)}
                  style={{ cursor: "pointer", fontSize: FONT_SIZES.xs, color: secondaryText, userSelect: "none" }}
                  title="编辑"
                >✎</span>
                <span
                  onClick={() => deleteCategory(cat)}
                  style={{ cursor: "pointer", fontSize: FONT_SIZES.xs, color: "#c00", userSelect: "none" }}
                  title="删除"
                >×</span>
              </div>
            );
          })}
          {industryCategories.length === 0 && (
            <div style={{ color: secondaryText, fontSize: FONT_SIZES.sm }}>
              暂无业务方向，点击"＋ 添加业务方向"创建
            </div>
          )}
        </div>
      </div>

      {/* Add Category Dialog */}
      {showAddDialog && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.5)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center"
        }} onClick={() => setShowAddDialog(false)}>
          <div style={{
            background: cardBg,
            borderRadius: BORDER_RADIUS.lg,
            border: `1px solid ${border}`,
            padding: "24px",
            width: "90%",
            maxWidth: 500,
            maxHeight: "80vh",
            overflowY: "auto"
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 16px", color: darkMode ? "#fff" : COLORS.text.primary, fontSize: FONT_SIZES.lg, fontWeight: 700 }}>
              添加业务方向
            </h3>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", marginBottom: 4, color: text, fontSize: FONT_SIZES.sm, fontWeight: 600 }}>
                业务方向名称
              </label>
              <input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="例如：氢能"
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", marginBottom: 4, color: text, fontSize: FONT_SIZES.sm, fontWeight: 600 }}>
                核心关键词
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={newCategoryMainKeyword}
                  onChange={(e) => setNewCategoryMainKeyword(e.target.value)}
                  placeholder="例如：氢能"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button onClick={handleSuggestKeywords} disabled={suggesting || !newCategoryMainKeyword.trim()} style={{
                  padding: "8px 14px", borderRadius: BORDER_RADIUS.md,
                  border: "none", background: suggesting ? "#aaa" : COLORS.primary,
                  color: "#fff", fontSize: FONT_SIZES.sm, fontWeight: 600,
                  cursor: suggesting ? "not-allowed" : "pointer",
                  whiteSpace: "nowrap"
                }}>
                  {suggesting ? "建议中..." : "🤖 智能建议关键词"}
                </button>
              </div>
            </div>

            {suggestedKeywords.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", marginBottom: 8, color: text, fontSize: FONT_SIZES.sm, fontWeight: 600 }}>
                  建议关键词 ({suggestedKeywords.length}) — 点击 × 移除
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                  {suggestedKeywords.map((kw, i) => (
                    <span key={i} style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "4px 10px", borderRadius: 12,
                      background: COLORS.primaryLight, color: COLORS.primary,
                      fontSize: FONT_SIZES.sm
                    }}>
                      {kw}
                      <span onClick={() => removeSuggestedKeyword(i)} style={{ cursor: "pointer", fontWeight: 700 }}>×</span>
                    </span>
                  ))}
                </div>
                <input
                  placeholder="手动添加关键词，回车确认..."
                  onKeyDown={addSuggestedKeywordInput}
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontSize: FONT_SIZES.sm }}
                />
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setShowAddDialog(false)} style={{
                padding: "8px 16px", borderRadius: BORDER_RADIUS.md,
                border: `1px solid ${border}`, background: "transparent",
                color: text, fontSize: FONT_SIZES.md, cursor: "pointer"
              }}>取消</button>
              <button onClick={handleSaveCategory} disabled={savingCategory || !newCategoryName.trim()} style={{
                padding: "8px 16px", borderRadius: BORDER_RADIUS.md,
                border: "none", background: (savingCategory || !newCategoryName.trim()) ? "#aaa" : COLORS.primary,
                color: "#fff", fontSize: FONT_SIZES.md, fontWeight: 600,
                cursor: (savingCategory || !newCategoryName.trim()) ? "not-allowed" : "pointer"
              }}>
                {savingCategory ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== Section 2: Keyword Filter ========== */}
      <div style={{
        background: cardBg,
        borderRadius: BORDER_RADIUS.lg,
        border: `1px solid ${border}`,
        padding: "16px 20px",
        marginBottom: 20
      }}>
        <h3 style={{ margin: "0 0 16px", color: darkMode ? "#fff" : COLORS.text.primary, fontSize: FONT_SIZES.xl, fontWeight: 700 }}>
          {t.keywordFilter}
        </h3>

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
                label: t.enterpriseLabel || (language === "zh" ? "🏢 企业/主体关键词" : "🏢 Enterprise/Entity Keywords"),
                items: purposeRules.enterprise,
                placeholder: t.enterpriseKeywordPlaceholder
              }, {
                type: "include_keyword",
                label: t.includeLabel || (language === "zh" ? "➕ 包含关键词" : "➕ Include Keywords"),
                items: purposeRules.include_keyword,
                placeholder: t.includeKeywordPlaceholder
              }, {
                type: "exclude_keyword",
                label: t.excludeLabel || (language === "zh" ? "➖ 排除关键词" : "➖ Exclude Keywords"),
                items: purposeRules.exclude_keyword,
                placeholder: t.keywordPlaceholder
              }].map(({ type, label, items, placeholder }) => {
                const inputKey = `${p.value}:${type}`;
                return (
          <div key={type} style={{ marginBottom: 20, paddingLeft: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <h4 style={{ margin: 0, color: darkMode ? "#ccc" : COLORS.text.secondary, fontSize: FONT_SIZES.md, fontWeight: 600 }}>{label}</h4>
              <span style={{
                background: COLORS.primaryLight,
                color: COLORS.primary,
                fontSize: FONT_SIZES.xs,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 10
              }}>{items.length}</span>
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
              <input
                type="text"
                value={newKeywordForType[inputKey] || ""}
                onChange={(e) => setNewKeywordForType(prev => ({ ...prev, [inputKey]: e.target.value }))}
                placeholder={placeholder}
                style={{ ...inputStyle, flex: 1, minWidth: 180 }}
                onKeyDown={(e) => { if (e.key === "Enter") addTypedKeyword(type, p.value); }}
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

      {/* ========== Section 3: Semantic Prompts ========== */}
      <div style={{
        background: cardBg,
        borderRadius: BORDER_RADIUS.lg,
        border: `1px solid ${border}`,
        padding: "16px 20px",
        marginBottom: 20
      }}>
        <h3 style={{ margin: "0 0 8px", color: darkMode ? "#fff" : COLORS.text.primary, fontSize: FONT_SIZES.xl, fontWeight: 700 }}>
          {t.semanticPrompts}
        </h3>
        <p style={{ margin: "0 0 16px", color: secondaryText, fontSize: FONT_SIZES.sm }}>
          LLM 将根据此提示词判断文章是否属于该监控类型
        </p>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, marginBottom: 16 }}>
          {SEMANTIC_TABS.map((tab, idx) => {
            const isActive = semanticTab === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => setSemanticTab(tab.value)}
                style={{
                  padding: "10px 20px",
                  border: `1px solid ${border}`,
                  borderBottom: isActive ? `2px solid ${COLORS.primary}` : `1px solid ${border}`,
                  borderTopLeftRadius: idx === 0 ? BORDER_RADIUS.md : 0,
                  borderTopRightRadius: idx === SEMANTIC_TABS.length - 1 ? BORDER_RADIUS.md : 0,
                  background: isActive ? (darkMode ? "#1c1f2b" : "#f5f5f5") : "transparent",
                  color: isActive ? COLORS.primary : text,
                  fontSize: FONT_SIZES.md,
                  fontWeight: isActive ? 700 : 500,
                  cursor: "pointer",
                  borderBottomColor: isActive ? COLORS.primary : border,
                  marginRight: -1,
                }}
              >
                {t[tab.labelKey] || (language === "zh" ? PURPOSES.find(p => p.value === tab.value)?.zh : PURPOSES.find(p => p.value === tab.value)?.en)}
              </button>
            );
          })}
        </div>

        {/* Active tab content */}
        {SEMANTIC_TABS.map(tab => {
          if (semanticTab !== tab.value) return null;
          const cfg = semanticPrompts[tab.value] || { content: "", active: 1 };
          return (
            <div key={tab.value} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: text, fontSize: FONT_SIZES.sm }}>
                <input
                  type="checkbox"
                  checked={!!cfg.active}
                  onChange={(e) => setSemanticPrompts(prev => ({
                    ...prev,
                    [tab.value]: { ...prev[tab.value], active: e.target.checked ? 1 : 0 }
                  }))}
                />
                {t.enableSemantic}
              </label>
              <textarea
                value={cfg.content || ""}
                onChange={(e) => setSemanticPrompts(prev => ({
                  ...prev,
                  [tab.value]: { ...prev[tab.value], content: e.target.value }
                }))}
                rows={8}
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontFamily: "inherit", resize: "vertical" }}
              />
              <button onClick={() => saveSemanticPrompt(tab.value)} style={{
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
