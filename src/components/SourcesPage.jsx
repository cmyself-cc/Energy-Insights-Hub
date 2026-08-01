import { useState, useEffect, useRef } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { backendApi } from "../utils/backendApi";

const PURPOSES = [
  { value: "competitor", zh: "竞争对手", en: "Competitor" },
  { value: "policy", zh: "政策动态", en: "Policy" },
  { value: "tech", zh: "技术突破", en: "Tech" }
];

export default function SourcesPage({ darkMode, language, onTrackerComplete }) {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", type: "rss", active: true, mcpUrl: "", feedId: "", purpose: ["competitor"] });
  const [trackerRunning, setTrackerRunning] = useState(false);
  const [message, setMessage] = useState(null);
  const [activeRun, setActiveRun] = useState(null);
  const [runProgress, setRunProgress] = useState(0);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", url: "", type: "rss", active: true, mcpUrl: "", feedId: "", purpose: [] });
  const languageRef = useRef(language);
  const onTrackerCompleteRef = useRef(onTrackerComplete);
  const activeRunRef = useRef(activeRun);

  useEffect(() => { languageRef.current = language; }, [language]);
  useEffect(() => { onTrackerCompleteRef.current = onTrackerComplete; }, [onTrackerComplete]);
  useEffect(() => { activeRunRef.current = activeRun; }, [activeRun]);

  useEffect(() => {
    loadSources();
  }, []);

  const loadSources = async () => {
    setLoading(true);
    try {
      const res = await backendApi.getSources();
      setSources(res.data || []);
    } catch (e) {
      console.error("Failed to load sources:", e);
    }
    setLoading(false);
  };

  const saveSource = async (e) => {
    e.preventDefault();
    if (!form.name) return;
    if (form.type !== "wechat_mcp" && !form.url) return;
    if (form.type === "wechat_mcp" && !form.mcpUrl) return;

    let payload;
    if (form.type === "wechat_mcp") {
      payload = {
        name: form.name,
        url: form.mcpUrl.trim(),
        type: form.type,
        active: form.active,
        purpose: form.purpose.join(","),
        config: { feedId: form.feedId.trim(), articleLimit: 20 }
      };
    } else {
      payload = {
        name: form.name,
        url: form.url,
        type: form.type,
        active: form.active,
        purpose: form.purpose.join(","),
        config: {}
      };
    }

    try {
      await backendApi.createSource(payload);
      setForm({ name: "", url: "", type: "rss", active: true, mcpUrl: "", feedId: "", purpose: ["competitor"] });
      loadSources();
      setMessage({ type: "success", text: language === "zh" ? "来源已添加" : "Source added" });
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    }
  };

  const deleteSource = async (id) => {
    if (!confirm(language === "zh" ? "确定删除该来源？" : "Delete this source?")) return;
    try {
      await backendApi.deleteSource(id);
      loadSources();
    } catch (err) {
      console.error("Delete source failed:", err);
    }
  };

  const startEdit = (source) => {
    setEditingId(source.id);
    setEditForm({
      name: source.name || "",
      url: source.type === "wechat_mcp" ? "" : (source.url || ""),
      type: source.type || "rss",
      active: source.active !== false,
      mcpUrl: source.type === "wechat_mcp" ? (source.url || "") : "",
      feedId: source.config?.feedId || "",
      purpose: (source.purpose || "").split(",").map(s => s.trim()).filter(Boolean)
    });
  };

  const saveEdit = async (id) => {
    try {
      let payload;
      if (editForm.type === "wechat_mcp") {
        payload = {
          name: editForm.name,
          url: editForm.mcpUrl.trim(),
          type: editForm.type,
          active: editForm.active,
          purpose: editForm.purpose.join(","),
          config: { feedId: editForm.feedId.trim(), articleLimit: 20 }
        };
      } else {
        payload = {
          name: editForm.name,
          url: editForm.url,
          type: editForm.type,
          active: editForm.active,
          purpose: editForm.purpose.join(","),
          config: {}
        };
      }
      await backendApi.updateSource(id, payload);
      setEditingId(null);
      loadSources();
      setMessage({ type: "success", text: language === "zh" ? "来源已更新" : "Source updated" });
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    }
  };

  const runTracker = async () => {
    setTrackerRunning(true);
    setActiveRun(null);
    setRunProgress(0);
    try {
      const res = await backendApi.runTracker();
      const runId = res.data.runId;
      setActiveRun({ id: runId, status: "running" });
    } catch (err) {
      setMessage({ type: "error", text: err.message });
      setTrackerRunning(false);
    }
  };

  const stopTracker = async () => {
    if (!confirm(language === "zh" ? "确定要终止当前跟踪吗？已抓取的内容将被保留。" : "Stop the current tracker? Content already fetched will be kept.")) return;
    try {
      await backendApi.stopTracker();
      setTimeout(async () => {
        try {
          const res = await backendApi.getTrackerStatus();
          if (!res.data.active) {
            setTrackerRunning(false);
            setActiveRun(null);
          }
        } catch (e) { /* ignore */ }
      }, 2000);
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    }
  };

  const importFromMd = async () => {
    if (!confirm(language === "zh"
      ? "这将用 sources.md 中的默认配置覆盖当前信源。确定继续吗？"
      : "This will overwrite current sources with defaults from sources.md. Continue?")) return;
    setLoading(true);
    try {
      const res = await backendApi.importSourcesMd();
      const { inserted, existed, failed } = res.data;
      loadSources();
      setMessage({
        type: failed.length ? "warning" : "success",
        text: language === "zh"
          ? `导入完成：新增 ${inserted} 条，已存在 ${existed} 条，失败 ${failed.length} 条`
          : `Imported: ${inserted} new, ${existed} existed, ${failed.length} failed`
      });
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    }
    setLoading(false);
  };

  useEffect(() => {
    const run = activeRunRef.current;
    if (!run?.id || run?.status !== "running") return;

    let pollFailures = 0;
    const interval = setInterval(async () => {
      const currentRun = activeRunRef.current;
      if (!currentRun || currentRun.status !== "running") {
        clearInterval(interval);
        return;
      }
      try {
        const res = await backendApi.getTrackerRun(currentRun.id);
        pollFailures = 0;
        const data = res.data;
        const total = data.sources_total || 1;
        const done = (data.sources_success || 0) + (data.sources_failed || 0);
        const progress = Math.round((done / total) * 100);
        setRunProgress(progress);
        setActiveRun({ ...currentRun, status: data.status });

        if (data.status === "completed" || data.status === "completed_with_errors") {
          clearInterval(interval);
          setTrackerRunning(false);
          setMessage({
            type: data.status === "completed" ? "success" : "warning",
            text: languageRef.current === "zh"
              ? `跟踪完成：成功 ${data.sources_success || 0} 个来源，失败 ${data.sources_failed || 0} 个，新增 ${data.insights_created || 0} 条洞察`
              : `Tracker finished: ${data.sources_success || 0} success, ${data.sources_failed || 0} failed, ${data.insights_created || 0} insights created`
          });
          if (onTrackerCompleteRef.current) onTrackerCompleteRef.current();
        }
      } catch (e) {
        pollFailures++;
        console.error("Poll tracker run failed:", e);
        if (pollFailures >= 3) {
          clearInterval(interval);
          setTrackerRunning(false);
          setActiveRun({ ...currentRun, status: "poll_failed" });
          setMessage({
            type: "error",
            text: languageRef.current === "zh"
              ? "无法获取跟踪进度，已停止轮询。请刷新页面后重试。"
              : "Unable to retrieve tracker progress. Polling has stopped. Please refresh and try again."
          });
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [activeRun?.id]);

  const inputStyle = {
    padding: "8px 12px",
    borderRadius: BORDER_RADIUS.md,
    border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
    background: darkMode ? "#1c1f2b" : "#fff",
    color: darkMode ? "#e8e8e8" : COLORS.text.primary,
    fontSize: FONT_SIZES.base,
    outline: "none"
  };

  const togglePurpose = (formObj, setFormObj, value) => {
    const next = formObj.purpose.includes(value)
      ? formObj.purpose.filter(p => p !== value)
      : [...formObj.purpose, value];
    setFormObj({ ...formObj, purpose: next });
  };

  const renderPurposeCheckboxes = (formObj, setFormObj) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#aaa" : COLORS.text.secondary }}>
        {language === "zh" ? "用途" : "Purpose"}:
      </span>
      {PURPOSES.map(p => (
        <label key={p.value} style={{ display: "flex", alignItems: "center", gap: 4, color: darkMode ? "#e8e8e8" : COLORS.text.primary, fontSize: FONT_SIZES.sm }}>
          <input
            type="checkbox"
            checked={formObj.purpose.includes(p.value)}
            onChange={() => togglePurpose(formObj, setFormObj, p.value)}
          />
          {language === "zh" ? p.zh : p.en}
        </label>
      ))}
    </div>
  );

  const purposeLabel = (value) => {
    const p = PURPOSES.find(item => item.value === value);
    if (!p) return value;
    return language === "zh" ? p.zh : p.en;
  };

  return (
    <div>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 20,
        flexWrap: "wrap",
        gap: 12
      }}>
        <h1 style={{
          fontSize: FONT_SIZES["3xl"],
          fontWeight: 700,
          color: darkMode ? "#fff" : COLORS.text.primary,
          margin: 0
        }}>
          {language === "zh" ? "数据来源" : "Data Sources"}
        </h1>
        <button
          onClick={trackerRunning ? stopTracker : runTracker}
          style={{
            padding: "8px 16px",
            borderRadius: BORDER_RADIUS.md,
            border: "none",
            background: trackerRunning ? "#d32f2f" : COLORS.primary,
            color: "#fff",
            fontSize: FONT_SIZES.md,
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          {trackerRunning
            ? `⏹ ${language === "zh" ? "终止跟踪" : "Stop Tracker"}`
            : (language === "zh" ? "立即运行跟踪" : "Run Tracker Now")}
        </button>
        <button
          onClick={importFromMd}
          disabled={loading}
          style={{
            padding: "8px 16px",
            borderRadius: BORDER_RADIUS.md,
            border: `1px solid ${COLORS.primary}`,
            background: "transparent",
            color: COLORS.primary,
            fontSize: FONT_SIZES.md,
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer"
          }}
        >
          {language === "zh" ? "🔄 恢复默认配置" : "🔄 Restore Defaults"}
        </button>
      </div>

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
        background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
        borderRadius: BORDER_RADIUS.lg,
        border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
        padding: "16px 20px",
        marginBottom: 20
      }}>
        <h3 style={{ margin: "0 0 12px", color: darkMode ? "#fff" : COLORS.text.primary }}>
          {language === "zh" ? "添加来源" : "Add Source"}
        </h3>
        <form onSubmit={saveSource} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={language === "zh" ? "名称" : "Name"}
            style={{ ...inputStyle, minWidth: 160 }}
          />
          <input
            type="text"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            placeholder={language === "zh" ? "URL / RSS Feed" : "URL / RSS Feed"}
            style={{ ...inputStyle, flex: 1, minWidth: 240 }}
          />
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            style={inputStyle}
          >
            <option value="rss">RSS</option>
            <option value="website">Website</option>
            <option value="wechat_mcp">WeChat MCP</option>
          </select>
          {form.type === "wechat_mcp" && (
            <>
              <input
                type="text"
                value={form.mcpUrl}
                onChange={(e) => setForm({ ...form, mcpUrl: e.target.value })}
                placeholder={language === "zh" ? "MCP SSE URL" : "MCP SSE URL"}
                style={{ ...inputStyle, flex: 1, minWidth: 240 }}
              />
              <input
                type="text"
                value={form.feedId}
                onChange={(e) => setForm({ ...form, feedId: e.target.value })}
                placeholder={language === "zh" ? "Feed ID（可选，留空抓取全部）" : "Feed ID (optional)"}
                style={{ ...inputStyle, minWidth: 220 }}
              />
            </>
          )}
          {renderPurposeCheckboxes(form, setForm)}
          <button type="submit" style={{
            padding: "8px 16px",
            borderRadius: BORDER_RADIUS.md,
            border: "none",
            background: COLORS.primary,
            color: "#fff",
            fontSize: FONT_SIZES.md,
            fontWeight: 600,
            cursor: "pointer"
          }}>
            {language === "zh" ? "添加" : "Add"}
          </button>
        </form>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: darkMode ? "#888" : "#aaa" }}>Loading...</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sources.map(source => {
            const isEditing = editingId === source.id;
            return (
              <div key={source.id} style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: isEditing ? "flex-start" : "center",
                padding: "12px 16px",
                borderRadius: BORDER_RADIUS.md,
                background: darkMode ? "#1c1f2b" : "#f9f9f9",
                border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
                transition: `all ${TRANSITIONS.fast}`,
                flexDirection: isEditing ? "column" : "row",
                gap: isEditing ? 12 : 0
              }}>
                {isEditing ? (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", width: "100%" }}>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      placeholder={language === "zh" ? "名称" : "Name"}
                      style={{ ...inputStyle, minWidth: 160 }}
                    />
                    {editForm.type !== "wechat_mcp" && (
                      <input
                        type="text"
                        value={editForm.url}
                        onChange={(e) => setEditForm({ ...editForm, url: e.target.value })}
                        placeholder={language === "zh" ? "URL / RSS Feed" : "URL / RSS Feed"}
                        style={{ ...inputStyle, flex: 1, minWidth: 240 }}
                      />
                    )}
                    {editForm.type === "wechat_mcp" && (
                      <>
                        <input
                          type="text"
                          value={editForm.mcpUrl}
                          onChange={(e) => setEditForm({ ...editForm, mcpUrl: e.target.value })}
                          placeholder={language === "zh" ? "MCP SSE URL" : "MCP SSE URL"}
                          style={{ ...inputStyle, flex: 1, minWidth: 240 }}
                        />
                        <input
                          type="text"
                          value={editForm.feedId}
                          onChange={(e) => setEditForm({ ...editForm, feedId: e.target.value })}
                          placeholder={language === "zh" ? "Feed ID（可选，留空抓取全部）" : "Feed ID (optional)"}
                          style={{ ...inputStyle, minWidth: 220 }}
                        />
                      </>
                    )}
                    <select
                      value={editForm.type}
                      onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                      style={inputStyle}
                    >
                      <option value="rss">RSS</option>
                      <option value="website">Website</option>
                      <option value="wechat_mcp">WeChat MCP</option>
                    </select>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, color: darkMode ? "#e8e8e8" : COLORS.text.primary, fontSize: FONT_SIZES.sm }}>
                      <input
                        type="checkbox"
                        checked={editForm.active}
                        onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })}
                      />
                      {language === "zh" ? "启用" : "Active"}
                    </label>
                    {renderPurposeCheckboxes(editForm, setEditForm)}
                    <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                      <button
                        onClick={() => saveEdit(source.id)}
                        style={{
                          padding: "8px 16px",
                          borderRadius: BORDER_RADIUS.md,
                          border: "none",
                          background: COLORS.primary,
                          color: "#fff",
                          fontSize: FONT_SIZES.sm,
                          fontWeight: 600,
                          cursor: "pointer"
                        }}
                      >{language === "zh" ? "保存" : "Save"}</button>
                      <button
                        onClick={() => setEditingId(null)}
                        style={{
                          padding: "8px 16px",
                          borderRadius: BORDER_RADIUS.md,
                          border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
                          background: "transparent",
                          color: darkMode ? "#e8e8e8" : COLORS.text.primary,
                          fontSize: FONT_SIZES.sm,
                          cursor: "pointer"
                        }}
                      >{language === "zh" ? "取消" : "Cancel"}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <div style={{ fontWeight: 600, color: darkMode ? "#fff" : COLORS.text.primary }}>
                        {source.name}
                        <span style={{
                          marginLeft: 8,
                          fontSize: FONT_SIZES.xs,
                          color: source.active ? COLORS.primary : "#999",
                          background: source.active ? COLORS.primaryLight : "#f0f0f0",
                          padding: "2px 6px",
                          borderRadius: BORDER_RADIUS.sm
                        }}>
                          {source.active ? (language === "zh" ? "启用" : "Active") : (language === "zh" ? "禁用" : "Inactive")}
                        </span>
                        {(source.purpose || "").split(",").map(s => s.trim()).filter(Boolean).map(p => (
                          <span key={p} style={{
                            marginLeft: 6,
                            fontSize: FONT_SIZES.xs,
                            color: darkMode ? "#9ec3ff" : "#3a6ea5",
                            background: darkMode ? "#26324a" : "#e8f0fa",
                            padding: "2px 6px",
                            borderRadius: BORDER_RADIUS.sm
                          }}>
                            {purposeLabel(p)}
                          </span>
                        ))}
                      </div>
                      <div style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#888" : COLORS.text.light, marginTop: 2 }}>
                        {source.url ? `${source.url} · ` : ""}{source.type}
                        {source.config?.feedId ? ` · ${source.config.feedId}` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => startEdit(source)}
                        style={{
                          padding: "6px 12px",
                          borderRadius: BORDER_RADIUS.md,
                          border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
                          background: "transparent",
                          color: darkMode ? "#e8e8e8" : COLORS.text.primary,
                          fontSize: FONT_SIZES.sm,
                          cursor: "pointer"
                        }}
                      >{language === "zh" ? "编辑" : "Edit"}</button>
                      <button
                        onClick={() => deleteSource(source.id)}
                        style={{
                          padding: "6px 12px",
                          borderRadius: BORDER_RADIUS.md,
                          border: `1px solid ${darkMode ? "#c00" : "#c00"}`,
                          background: "transparent",
                          color: "#c00",
                          fontSize: FONT_SIZES.sm,
                          cursor: "pointer"
                        }}
                      >
                        {language === "zh" ? "删除" : "Delete"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
          {sources.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px", color: darkMode ? "#888" : "#aaa" }}>
              {language === "zh" ? "暂无数据来源" : "No sources yet"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
