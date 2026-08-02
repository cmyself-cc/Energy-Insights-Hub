import { useMemo, useRef, useState, useEffect } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { getInitial, initialsSequence } from "../utils/pinyinIndex";

const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"];

export default function KeywordList({ items, label, placeholder, language, darkMode, onAdd, onSaveEdit, onDelete, onRegenerateAliases }) {
  const text = darkMode ? "#e8e8e8" : COLORS.text.primary;
  const secondaryText = darkMode ? "#aaa" : COLORS.text.secondary;
  const border = darkMode ? COLORS.border.dark : COLORS.border.light;
  const cardBg = darkMode ? COLORS.background.cardDark : COLORS.background.card;
  const inputStyle = {
    padding: "6px 10px",
    borderRadius: BORDER_RADIUS.md,
    border: `1px solid ${border}`,
    background: darkMode ? "#1c1f2b" : "#fff",
    color: text,
    outline: "none",
    width: "100%",
    boxSizing: "border-box"
  };

  const [query, setQuery] = useState("");
  // 行编辑态：同时编辑关键词 + 同义词
  const [editingId, setEditingId] = useState(null);
  const [editNameValue, setEditNameValue] = useState("");
  const [editAliasValue, setEditAliasValue] = useState("");
  const [regeneratingId, setRegeneratingId] = useState(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addName, setAddName] = useState("");
  const [addAliases, setAddAliases] = useState([]);
  const [generatingAdd, setGeneratingAdd] = useState(false);
  const listRef = useRef(null);
  const editRowRef = useRef(null);

  // 编辑态：点击行外部 → 退出且不保存
  useEffect(() => {
    if (!editingId) return;
    const handler = (e) => {
      if (editRowRef.current && !editRowRef.current.contains(e.target)) {
        cancelEdit();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editingId]);

  const q = query.trim();
  const isInitialQuery = /^[A-Za-z]{2}$/.test(q);
  const qLower = q.toLowerCase();

  const filtered = useMemo(() => {
    let list = items;
    if (q) {
      if (isInitialQuery) {
        const seq = q.toUpperCase();
        list = list.filter(r => initialsSequence(r.name).startsWith(seq));
      } else {
        list = list.filter(r =>
          String(r.name || "").toLowerCase().includes(qLower) ||
          (Array.isArray(r.aliases) && r.aliases.some(a => String(a).toLowerCase().includes(qLower)))
        );
      }
    }
    return [...list].sort((a, b) => {
      const ia = getInitial(a.name);
      const ib = getInitial(b.name);
      if (ia !== ib) return ia < ib ? -1 : 1;
      return String(a.name).localeCompare(String(b.name), "zh");
    });
  }, [items, q, isInitialQuery, qLower]);

  const grouped = useMemo(() => {
    const map = {};
    for (const r of filtered) {
      const k = getInitial(r.name);
      if (!map[k]) map[k] = [];
      map[k].push(r);
    }
    return map;
  }, [filtered]);

  const presentLetters = new Set(Object.keys(grouped));

  const scrollToLetter = (letter) => {
    const el = listRef.current?.querySelector(`[data-letter="${letter}"]`);
    el?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  // --- 添加弹窗 ---
  const openAdd = () => {
    setAddName("");
    setAddAliases([]);
    setShowAddDialog(true);
  };

  const closeAdd = () => {
    setShowAddDialog(false);
    setAddName("");
    setAddAliases([]);
    setGeneratingAdd(false);
  };

  const generateAddAliases = async () => {
    const name = addName.trim();
    if (!name || generatingAdd) return;
    setGeneratingAdd(true);
    try {
      const aliases = await onRegenerateAliases(null, name);
      setAddAliases(aliases || []);
    } finally {
      setGeneratingAdd(false);
    }
  };

  const confirmAdd = () => {
    const name = addName.trim();
    if (!name) return;
    onAdd(name, addAliases);
    closeAdd();
  };

  // --- 行编辑 ---
  const startEdit = (rule) => {
    setEditingId(rule.id);
    setEditNameValue(rule.name);
    setEditAliasValue((rule.aliases || []).join(", "));
  };

  const saveEdit = async (rule) => {
    const name = editNameValue.trim();
    if (!name) return;
    setEditingId(null);
    await onSaveEdit(rule.id, name, editAliasValue);
  };

  // 编辑态：按输入框里修改后的主关键词生成同义词（不直接保存到 DB）
  const handleRegenerateInEdit = async (rule) => {
    setRegeneratingId(rule.id);
    try {
      const aliases = await onRegenerateAliases(rule.id, null, { persist: false, keyword: editNameValue.trim() });
      if (Array.isArray(aliases)) setEditAliasValue(aliases.join(", "));
    } finally {
      setRegeneratingId(null);
    }
  };

  const cancelEdit = () => setEditingId(null);

  return (
    <div style={{ marginBottom: 18 }}>
      {/* 标题 + 计数 + 添加按钮 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <h4 style={{ margin: 0, color: secondaryText, fontSize: FONT_SIZES.md, fontWeight: 600 }}>{label}</h4>
        <span style={{ background: COLORS.primaryLight, color: COLORS.primary, fontSize: FONT_SIZES.xs, fontWeight: 700, padding: "2px 8px", borderRadius: 10 }}>
          {filtered.length}/{items.length}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={openAdd} style={{ padding: "4px 12px", borderRadius: BORDER_RADIUS.md, border: `1px dashed ${COLORS.primary}`, background: "transparent", color: COLORS.primary, fontSize: FONT_SIZES.xs, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
          {language === "zh" ? "＋ 添加" : "＋ Add"}
        </button>
      </div>

      {/* 仅查询框 */}
      <div style={{ marginBottom: 8 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={language === "zh" ? "🔍 关键词 或 首字母如 FB..." : "🔍 keyword or initials e.g. FB..."}
          style={{ ...inputStyle }}
        />
      </div>

      {/* 字母索引条 */}
      <div style={{ display: "flex", gap: 2, marginBottom: 6, flexWrap: "wrap" }}>
        {LETTERS.map(letter => {
          const has = presentLetters.has(letter);
          return (
            <span
              key={letter}
              onClick={() => has && scrollToLetter(letter)}
              style={{
                width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: FONT_SIZES.xs, borderRadius: 4,
                color: has ? COLORS.primary : (darkMode ? "#555" : "#ccc"),
                fontWeight: has ? 700 : 400,
                cursor: has ? "pointer" : "default",
                userSelect: "none"
              }}
            >{letter}</span>
          );
        })}
      </div>

      {/* 滚动窗口 — 表格风格 */}
      <div
        ref={listRef}
        style={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${border}`, borderRadius: BORDER_RADIUS.md, padding: "6px 10px", transition: `all ${TRANSITIONS.fast}` }}
      >
        {Object.keys(grouped).sort().map(letter => (
          <div key={letter} data-letter={letter}>
            <div style={{ fontSize: FONT_SIZES.xs, fontWeight: 700, color: COLORS.primary, margin: "6px 0 4px" }}>
              {letter} ({grouped[letter].length})
            </div>
            {grouped[letter].map(rule => {
              const aliases = Array.isArray(rule.aliases) ? rule.aliases : [];
              const isEditing = editingId === rule.id;
              const isRegenerating = regeneratingId === rule.id;
              return (
                <div
                  key={rule.id}
                  ref={isEditing ? editRowRef : undefined}
                  style={{
                    display: "grid",
                    gridTemplateColumns: isEditing ? "minmax(110px, 1.1fr) 1.6fr auto" : "minmax(120px, 1.2fr) 1.8fr auto auto",
                    gap: 8,
                    alignItems: "center",
                    padding: "5px 4px",
                    borderBottom: `1px solid ${border}`,
                    background: isEditing ? (darkMode ? "#1a1d28" : "#f5f7f6") : "transparent",
                    transition: `all ${TRANSITIONS.fast}`
                  }}
                >
                  {/* 关键词列 */}
                  {isEditing ? (
                    <input
                      type="text"
                      value={editNameValue}
                      autoFocus
                      onChange={(e) => setEditNameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(rule); if (e.key === "Escape") cancelEdit(); }}
                      style={{ ...inputStyle, padding: "2px 6px", fontSize: FONT_SIZES.xs }}
                    />
                  ) : (
                    <span
                      onDoubleClick={() => startEdit(rule)}
                      title={language === "zh" ? "双击编辑" : "Double-click to edit"}
                      style={{
                        color: COLORS.primary,
                        fontSize: FONT_SIZES.sm,
                        fontWeight: 500,
                        cursor: "pointer",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}
                    >{rule.name}</span>
                  )}

                  {/* 同义词列 */}
                  {isEditing ? (
                    <input
                      type="text"
                      value={editAliasValue}
                      onChange={(e) => setEditAliasValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(rule); if (e.key === "Escape") cancelEdit(); }}
                      placeholder={language === "zh" ? "逗号分隔多个同义词" : "comma-separated synonyms"}
                      style={{ ...inputStyle, padding: "2px 6px", fontSize: FONT_SIZES.xs }}
                    />
                  ) : (
                    <span
                      style={{
                        color: darkMode ? "#9a9a9a" : "#777",
                        fontSize: FONT_SIZES.xs,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        display: "block"
                      }}
                      title={aliases.join(", ")}
                    >{aliases.length > 0 ? aliases.join(", ") : "—"}</span>
                  )}

                  {/* 操作列 */}
                  {isEditing ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap" }}>
                      <button
                        onClick={() => handleRegenerateInEdit(rule)}
                        disabled={isRegenerating}
                        title={language === "zh" ? "LLM 生成同义词（填入输入框）" : "Generate synonyms"}
                        style={{
                          padding: "3px 8px",
                          borderRadius: BORDER_RADIUS.sm,
                          border: `1px solid ${COLORS.primary}`,
                          background: "transparent",
                          color: COLORS.primary,
                          fontSize: FONT_SIZES.xs,
                          cursor: isRegenerating ? "wait" : "pointer",
                          whiteSpace: "nowrap"
                        }}
                      >{isRegenerating ? "生成中…" : (language === "zh" ? "同义词生成" : "Gen")}</button>
                      <button
                        onClick={() => saveEdit(rule)}
                        title={language === "zh" ? "保存" : "Save"}
                        style={{
                          padding: "3px 8px",
                          borderRadius: BORDER_RADIUS.sm,
                          border: "none",
                          background: COLORS.primary,
                          color: "#fff",
                          fontSize: FONT_SIZES.xs,
                          cursor: "pointer",
                          whiteSpace: "nowrap"
                        }}
                      >{language === "zh" ? "保存" : "Save"}</button>
                      <button
                        onClick={() => onDelete(rule.id)}
                        title={language === "zh" ? "删除" : "Delete"}
                        style={{ background: "transparent", border: "none", color: "#c00", cursor: "pointer", fontSize: FONT_SIZES.md, lineHeight: 1, padding: "0 4px", flexShrink: 0 }}
                      >×</button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => startEdit(rule)}
                        title={language === "zh" ? "编辑" : "Edit"}
                        style={{
                          padding: "3px 8px",
                          borderRadius: BORDER_RADIUS.sm,
                          border: `1px solid ${border}`,
                          background: "transparent",
                          color: text,
                          fontSize: FONT_SIZES.xs,
                          cursor: "pointer",
                          whiteSpace: "nowrap"
                        }}
                      >{language === "zh" ? "编辑" : "Edit"}</button>
                      {/* 删除 */}
                      <button
                        onClick={() => onDelete(rule.id)}
                        title={language === "zh" ? "删除" : "Delete"}
                        style={{ background: "transparent", border: "none", color: "#c00", cursor: "pointer", fontSize: FONT_SIZES.md, lineHeight: 1, padding: 0 }}
                      >×</button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ color: secondaryText, fontSize: FONT_SIZES.xs, padding: 12 }}>
            {q ? (language === "zh" ? `无匹配"${q}"的关键词` : `No keywords match "${q}"`) : (language === "zh" ? "暂无关键词" : "No keywords")}
          </div>
        )}
      </div>

      {/* 添加弹窗 */}
      {showAddDialog && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={closeAdd}>
          <div style={{ background: cardBg, borderRadius: BORDER_RADIUS.lg, border: `1px solid ${border}`, padding: 20, width: "90%", maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <h4 style={{ margin: "0 0 12px", color: text, fontSize: FONT_SIZES.lg, fontWeight: 700 }}>
              {language === "zh" ? "添加关键词" : "Add Keyword"}
            </h4>
            <input
              type="text"
              value={addName}
              autoFocus
              onChange={(e) => setAddName(e.target.value)}
              placeholder={placeholder}
              style={{ ...inputStyle, marginBottom: 8 }}
            />
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button onClick={generateAddAliases} disabled={generatingAdd || !addName.trim()} style={{
                padding: "6px 12px", borderRadius: BORDER_RADIUS.md, border: `1px solid ${COLORS.primary}`, background: "transparent", color: COLORS.primary, fontSize: FONT_SIZES.xs, cursor: "pointer", whiteSpace: "nowrap"
              }}>{generatingAdd ? "生成中…" : (language === "zh" ? "🤖 生成同义词" : "Generate synonyms")}</button>
              <span style={{ fontSize: FONT_SIZES.xs, color: secondaryText, alignSelf: "center" }}>
                {language === "zh" ? "已生成 " : ""}{addAliases.length}{language === "zh" ? " 个" : " generated"}
              </span>
            </div>
            {addAliases.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                {addAliases.map((a, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 10, background: COLORS.primaryLight, color: COLORS.primary, fontSize: FONT_SIZES.xs }}>
                    {a}
                    <span onClick={() => setAddAliases(prev => prev.filter((_, j) => j !== i))} style={{ cursor: "pointer", fontWeight: 700 }}>×</span>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={closeAdd} style={{ padding: "6px 14px", borderRadius: BORDER_RADIUS.md, border: `1px solid ${border}`, background: "transparent", color: text, fontSize: FONT_SIZES.sm, cursor: "pointer" }}>
                {language === "zh" ? "取消" : "Cancel"}
              </button>
              <button onClick={confirmAdd} disabled={!addName.trim()} style={{
                padding: "6px 16px", borderRadius: BORDER_RADIUS.md, border: "none", background: COLORS.primary, color: "#fff", fontSize: FONT_SIZES.sm, fontWeight: 600, cursor: "pointer"
              }}>{language === "zh" ? "确认添加" : "Confirm Add"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
