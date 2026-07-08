import { useState, useEffect } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { backendApi } from "../utils/backendApi";

export default function SourcesPage({ darkMode, language }) {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", type: "rss", active: true });
  const [bulkJson, setBulkJson] = useState("");
  const [trackerRunning, setTrackerRunning] = useState(false);
  const [message, setMessage] = useState(null);

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
    if (!form.name || !form.url) return;
    try {
      await backendApi.createSource(form);
      setForm({ name: "", url: "", type: "rss", active: true });
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

  const importBulk = async (e) => {
    e.preventDefault();
    try {
      const items = JSON.parse(bulkJson);
      if (!Array.isArray(items)) throw new Error("Must be an array");
      for (const item of items) {
        await backendApi.createSource({
          name: item.name,
          url: item.url,
          type: item.type || "rss",
          active: item.active !== false
        });
      }
      setBulkJson("");
      loadSources();
      setMessage({ type: "success", text: `${language === "zh" ? "已导入" : "Imported"} ${items.length} ${language === "zh" ? "条来源" : "sources"}` });
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    }
  };

  const runTracker = async () => {
    setTrackerRunning(true);
    try {
      await backendApi.runTracker();
      setMessage({ type: "success", text: language === "zh" ? "跟踪任务已启动，请稍后刷新页面查看结果" : "Tracker started. Refresh the page later to see results." });
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    }
    setTrackerRunning(false);
  };

  const inputStyle = {
    padding: "8px 12px",
    borderRadius: BORDER_RADIUS.md,
    border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
    background: darkMode ? "#1c1f2b" : "#fff",
    color: darkMode ? "#e8e8e8" : COLORS.text.primary,
    fontSize: FONT_SIZES.base,
    outline: "none"
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
          onClick={runTracker}
          disabled={trackerRunning}
          style={{
            padding: "8px 16px",
            borderRadius: BORDER_RADIUS.md,
            border: "none",
            background: trackerRunning ? "#aaa" : COLORS.primary,
            color: "#fff",
            fontSize: FONT_SIZES.md,
            fontWeight: 600,
            cursor: trackerRunning ? "not-allowed" : "pointer"
          }}
        >
          {trackerRunning
            ? (language === "zh" ? "运行中..." : "Running...")
            : (language === "zh" ? "立即运行跟踪" : "Run Tracker Now")}
        </button>
      </div>

      {message && (
        <div style={{
          padding: "12px 16px",
          borderRadius: BORDER_RADIUS.md,
          background: message.type === "success" ? "#e8f5ee" : "#fff0f0",
          border: `1px solid ${message.type === "success" ? COLORS.primary : "#c00"}`,
          color: message.type === "success" ? COLORS.primary : "#c00",
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
          {language === "zh" ? "批量导入 (JSON)" : "Bulk Import (JSON)"}
        </h3>
        <form onSubmit={importBulk} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <textarea
            value={bulkJson}
            onChange={(e) => setBulkJson(e.target.value)}
            placeholder={language === "zh"
              ? '[{"name":"示例","url":"https://example.com/rss","type":"rss"}]'
              : '[{"name":"Example","url":"https://example.com/rss","type":"rss"}]'}
            rows={4}
            style={{ ...inputStyle, fontFamily: "monospace" }}
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
          }}>
            {language === "zh" ? "导入" : "Import"}
          </button>
        </form>
      </div>

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
            <option value="scrape">Scrape</option>
            <option value="api">API</option>
          </select>
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
          {sources.map(source => (
            <div key={source.id} style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              borderRadius: BORDER_RADIUS.md,
              background: darkMode ? "#1c1f2b" : "#f9f9f9",
              border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
              transition: `all ${TRANSITIONS.fast}`
            }}>
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
                </div>
                <div style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#888" : COLORS.text.light, marginTop: 2 }}>
                  {source.url} · {source.type}
                </div>
              </div>
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
          ))}
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
