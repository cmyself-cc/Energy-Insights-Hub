import { useState, useEffect, useCallback } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { i18n } from "../constants/i18n";
import { backendApi } from "../utils/backendApi";
import KeywordList from "./KeywordList";

const PURPOSES = [
  { value: "competitor", zh: "竞争对手", en: "Competitor" },
  { value: "policy", zh: "政策动态", en: "Policy" },
  { value: "tech", zh: "技术突破", en: "Tech" }
];

export default function ContentFiltersPage({ darkMode, language }) {
  const t = i18n[language]?.contentFilters || i18n.en.contentFilters;
  const [rules, setRules] = useState([]);
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
  const [activePurposeTab, setActivePurposeTab] = useState("competitor");

  // Semantic prompts state
  const [semanticPrompts, setSemanticPrompts] = useState({
    competitor: { content: "", active: 1 },
    policy: { content: "", active: 1 },
    tech: { content: "", active: 1 },
  });

  const PURPOSE_DOTS = {
    competitor: "#e74c3c",
    policy: "#3498db",
    tech: "#27ae60"
  };

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
      const [rulesRes, settingsRes, compPrompt, policyPrompt, techPrompt, industriesRes] = await Promise.all([
        backendApi.getFilterRules(),
        backendApi.getTrackerSettings(),
        backendApi.getSemanticConfig("competitor"),
        backendApi.getSemanticConfig("policy"),
        backendApi.getSemanticConfig("tech"),
        backendApi.getIndustryCategories(),
      ]);
      setRules(rulesRes.data || []);
      setTrackerSettings(settingsRes.data || {});
      setIndustryCategories((industriesRes.data || []).map(cat => ({
        ...cat,
        keywords: (cat.keywords || []).filter(k => k && k.trim())
      })));
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
    if (e.key === "Enter") {
      e.preventDefault();
      const val = e.target.value.trim();
      if (val) {
        setSuggestedKeywords(prev => [...prev, val]);
        e.target.value = "";
      }
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
    if (e.key === "Enter") {
      e.preventDefault();
      const val = e.target.value.trim();
      if (val) {
        setEditingCategoryKeywords(prev => [...prev, val]);
        e.target.value = "";
      }
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

  // --- Keyword filter handlers (local-save: no global refresh) ---
  const addTypedKeyword = async (type, purpose, name = "", aliases = []) => {
    const value = String(name || "").trim();
    if (!value) return;
    // Duplicate check (base name only)
    const duplicate = rules.some(r => r.type === type && (r.purpose || "competitor") === purpose && r.name === value);
    if (duplicate) {
      showMessage("error", `${t.keywordExists || "关键词已存在"}: "${value}"`);
      return;
    }
    try {
      const res = await backendApi.createFilterRule({
        type,
        name: value,
        mustInclude: [],
        mustExclude: type === "exclude_keyword" ? [value] : [],
        active: true,
        priority: 0,
        purpose,
        aliases
      });
      const id = res.data?.id;
      if (id) {
        setRules(prev => [...prev, {
          id,
          type,
          name: value,
          must_include: "[]",
          must_exclude: type === "exclude_keyword" ? JSON.stringify([value]) : "[]",
          active: 1,
          priority: 0,
          purpose,
          aliases: (res.data?.aliases || []).filter(Boolean)
        }]);
      }
      showMessage("success", t.keywordAdded);
    } catch (err) {
      showMessage("error", `${t.saveFailed}: ${err.message}`);
    }
  };

  const deleteTypedKeyword = async (id) => {
    if (!confirm(t.confirmDelete)) return;
    try {
      await backendApi.deleteFilterRule(id);
      setRules(prev => prev.filter(r => r.id !== id));
    } catch (err) {
      showMessage("error", err.message);
    }
  };

  // id = ruleId → regenerate (persist=true 默认存库; persist=false 仅预览);
  // id = null, name given → generate preview only (add dialog)
  const regenerateAliases = async (id, name = null, opts = {}) => {
    if (id === null) {
      const preview = await backendApi.generateAliasesPreview(name);
      return preview.data?.keywords || preview.data?.aliases || [];
    }
    try {
      const res = await backendApi.regenerateAliases(id, { persist: opts.persist !== false, keyword: opts.keyword });
      const aliases = (res.data?.aliases || []).filter(Boolean);
      if (opts.persist === false) return aliases; // 编辑态预览：只返回，不更新列表
      // Dedup: drop aliases that are already another rule's name (same type+purpose)
      const rule = rules.find(r => r.id === id);
      const others = rules.filter(r => r.id !== id && r.type === rule?.type && (r.purpose || "competitor") === rule?.purpose);
      const deduped = aliases.filter(a => !others.some(o => o.name === a));
      if (deduped.length !== aliases.length) {
        await backendApi.updateFilterRule(id, { name: rule.name, aliases: deduped });
      }
      setRules(prev => prev.map(r => r.id === id ? { ...r, aliases: deduped } : r));
      showMessage("success", t.keywordUpdated || "同义词已更新");
    } catch (err) {
      showMessage("error", `${t.saveFailed}: ${err.message}`);
    }
  };

  // Save edited keyword name + aliases together (local save, comma-separated aliases)
  const saveEditKeyword = async (id, name, aliasString) => {
    const rule = rules.find(r => r.id === id);
    if (!rule) return;
    const value = String(name || "").trim();
    if (!value) return;
    const aliases = String(aliasString || "").split(",").map(s => s.trim()).filter(Boolean);
    try {
      await backendApi.updateFilterRule(id, {
        name: value,
        mustInclude: [],
        mustExclude: rule.type === "exclude_keyword" ? [value] : [],
        active: true,
        priority: rule.priority || 0,
        purpose: rule.purpose || "",
        aliases
      });
      setRules(prev => prev.map(r => r.id === id ? { ...r, name: value, aliases } : r));
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
                    onKeyUp={addEditKeyword}
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
              暂无业务方向，点击&ldquo;＋ 添加业务方向&rdquo;创建
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
                业务方向名称 <span style={{ color: "#c00" }}>*</span>
              </label>
              <input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="方向名称，例如：氢能产业"
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
              />
            </div>

              <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", marginBottom: 4, color: text, fontSize: FONT_SIZES.sm, fontWeight: 600 }}>
                核心关键词 <span style={{ color: "#c00" }}>*</span>
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={newCategoryMainKeyword}
                  onChange={(e) => setNewCategoryMainKeyword(e.target.value)}
                  placeholder="输入核心关键词，例如：氢能"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button onClick={handleSuggestKeywords} disabled={suggesting || !newCategoryMainKeyword.trim()} style={{
                  padding: "8px 14px", borderRadius: BORDER_RADIUS.md,
                  border: "none",
                  background: (suggesting || !newCategoryMainKeyword.trim()) ? "#aaa" : COLORS.primary,
                  color: "#fff", fontSize: FONT_SIZES.sm, fontWeight: 600,
                  cursor: (suggesting || !newCategoryMainKeyword.trim()) ? "not-allowed" : "pointer",
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

      {/* ========== Section 2: Purpose Cards (keywords + semantic prompt) ========== */}
      <div style={{ marginBottom: 16 }}>
        {/* Purpose tab switcher */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {PURPOSES.map(p => {
            const totalCount = rulesByPurpose[p.value].enterprise.length + rulesByPurpose[p.value].include_keyword.length + rulesByPurpose[p.value].exclude_keyword.length;
            const isActive = activePurposeTab === p.value;
            return (
              <button
                key={p.value}
                onClick={() => setActivePurposeTab(p.value)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "10px 20px",
                  borderRadius: BORDER_RADIUS.md,
                  border: `1px solid ${isActive ? PURPOSE_DOTS[p.value] : border}`,
                  background: isActive ? (darkMode ? "#1c1f2b" : "#f5f5f5") : "transparent",
                  color: isActive ? PURPOSE_DOTS[p.value] : text,
                  fontSize: FONT_SIZES.md,
                  fontWeight: isActive ? 700 : 500,
                  cursor: "pointer",
                  transition: `all ${TRANSITIONS.fast}`
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: PURPOSE_DOTS[p.value] }} />
                {language === "zh" ? p.zh : p.en}
                <span style={{ fontSize: FONT_SIZES.xs, opacity: 0.7 }}>({totalCount})</span>
              </button>
            );
          })}
        </div>

        {PURPOSES.filter(p => p.value === activePurposeTab).map(p => {
          const purposeRules = rulesByPurpose[p.value];
          const totalCount = purposeRules.enterprise.length + purposeRules.include_keyword.length + purposeRules.exclude_keyword.length;
          const cfg = semanticPrompts[p.value] || { content: "", active: 1 };

          const keywordGroups = [{
            type: "enterprise",
            label: t.enterpriseLabel || (language === "zh" ? "🏢 企业/主体关键词" : "🏢 Enterprise Keywords"),
            items: purposeRules.enterprise,
            placeholder: t.enterpriseKeywordPlaceholder || (language === "zh" ? "输入企业名，如：宁德时代" : "Enter company name...")
          }, {
            type: "include_keyword",
            label: t.includeLabel || (language === "zh" ? "➕ 包含关键词" : "➕ Include Keywords"),
            items: purposeRules.include_keyword,
            placeholder: t.includeKeywordPlaceholder || (language === "zh" ? "输入动作词，如：合作、投资" : "Enter action word...")
          }, {
            type: "exclude_keyword",
            label: t.excludeLabel || (language === "zh" ? "➖ 排除关键词" : "➖ Exclude Keywords"),
            items: purposeRules.exclude_keyword,
            placeholder: t.keywordPlaceholder || (language === "zh" ? "输入排除词，如：股价、涨停" : "Enter exclude word...")
          }];

          return (
            <div key={p.value} style={{
              background: cardBg,
              borderRadius: BORDER_RADIUS.lg,
              border: `1px solid ${border}`,
              padding: "16px 20px",
              alignSelf: "start"
            }}>
              {/* Card header: name + count（默认样式，不加彩色） */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                <h3 style={{ margin: 0, fontSize: FONT_SIZES.xl, fontWeight: 700, color: darkMode ? "#fff" : COLORS.text.primary }}>
                  {language === "zh" ? p.zh : p.en}
                </h3>
                <span style={{
                  background: COLORS.primaryLight, color: COLORS.primary,
                  fontSize: FONT_SIZES.xs, fontWeight: 700,
                  padding: "2px 8px", borderRadius: 10
                }}>{totalCount}</span>
              </div>

              {/* Keyword groups — KeywordList browser */}
              {keywordGroups.map(({ type, label, items, placeholder }) => (
                <KeywordList
                  key={type}
                  items={items}
                  label={label}
                  placeholder={placeholder}
                  language={language}
                  darkMode={darkMode}
                  onAdd={(name, aliases) => addTypedKeyword(type, p.value, name, aliases)}
                  onSaveEdit={(id, name, aliasString) => saveEditKeyword(id, name, aliasString)}
                  onDelete={deleteTypedKeyword}
                  onRegenerateAliases={regenerateAliases}
                />
              ))}

              {/* Semantic prompt inside the card */}
              <div style={{
                borderTop: `1px dashed ${border}`,
                paddingTop: 14,
                marginTop: 4
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <h4 style={{ margin: 0, color: darkMode ? "#ccc" : COLORS.text.secondary, fontSize: FONT_SIZES.md, fontWeight: 600 }}>
                    ⚙️ {t.semanticPromptShort || (language === "zh" ? "语义处理提示词" : "Semantic Prompt")}
                  </h4>
                  <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", color: text, fontSize: FONT_SIZES.xs }}>
                    <input
                      type="checkbox"
                      checked={!!cfg.active}
                      onChange={(e) => setSemanticPrompts(prev => ({
                        ...prev,
                        [p.value]: { ...prev[p.value], active: e.target.checked ? 1 : 0 }
                      }))}
                    />
                    {t.enableSemantic}
                  </label>
                </div>
                <textarea
                  value={cfg.content || ""}
                  onChange={(e) => setSemanticPrompts(prev => ({
                    ...prev,
                    [p.value]: { ...prev[p.value], content: e.target.value }
                  }))}
                  rows={5}
                  placeholder={language === "zh" ? "输入该监控类型的语义判断提示词..." : "Semantic prompt for this monitoring type..."}
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontFamily: "inherit", resize: "vertical", fontSize: FONT_SIZES.xs }}
                />
                <button onClick={() => saveSemanticPrompt(p.value)} style={{
                  padding: "6px 16px", marginTop: 8,
                  borderRadius: BORDER_RADIUS.md, border: "none",
                  background: COLORS.primary, color: "#fff",
                  fontSize: FONT_SIZES.sm, fontWeight: 600, cursor: "pointer",
                  alignSelf: "flex-start"
                }}>{t.save}</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
