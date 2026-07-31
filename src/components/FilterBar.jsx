import { useState, useEffect } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { i18n } from "../constants/i18n";
import { DATE_RANGES, PURPOSE_OPTIONS, EVENT_CATEGORIES, SOURCE_TYPES } from "../constants/taxonomy";
import { backendApi } from "../utils/backendApi";

const PURPOSE_DOTS = {
  competitor: "#e74c3c",
  policy: "#3498db",
  tech: "#27ae60"
};

export default function FilterBar({
  darkMode,
  language,
  filters,
  onChange,
  onSearch,
  loading
}) {
  const t = i18n[language];
  const [businessCategories, setBusinessCategories] = useState([]);

  useEffect(() => {
    backendApi.getIndustryCategories().then(res => {
      setBusinessCategories(res.data || []);
    }).catch(() => {});
  }, []);

  const selectStyle = {
    padding: "7px 28px 7px 12px",
    borderRadius: BORDER_RADIUS.md,
    border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
    background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
    color: darkMode ? "#e8e8e8" : COLORS.text.primary,
    fontSize: FONT_SIZES.md,
    cursor: "pointer",
    outline: "none",
    appearance: "none",
    WebkitAppearance: "none",
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='${encodeURIComponent(darkMode ? "#aaa" : "#888")}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 10px center",
    transition: `all ${TRANSITIONS.fast}`
  };

  const labelStyle = {
    fontSize: FONT_SIZES.sm,
    color: darkMode ? "#aaa" : COLORS.text.secondary,
    whiteSpace: "nowrap"
  };

  const purposeBtnStyle = (active, dotColor) => ({
    padding: "6px 14px 6px 10px",
    borderRadius: BORDER_RADIUS.md,
    border: `1.5px solid ${active ? dotColor : darkMode ? COLORS.border.dark : COLORS.border.light}`,
    background: active ? dotColor : "transparent",
    color: active ? "#fff" : darkMode ? "#aaa" : COLORS.text.secondary,
    fontSize: FONT_SIZES.sm,
    fontWeight: active ? 700 : 500,
    cursor: "pointer",
    transition: `all ${TRANSITIONS.fast}`,
    display: "flex",
    alignItems: "center",
    gap: 6
  });

  const purposeDotStyle = (color) => ({
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: color,
    display: "inline-block",
    flexShrink: 0
  });

  const renderOptions = (options) => options.map(o => (
    <option key={o.key} value={o.key}>{o.label}</option>
  ));

  const togglePurpose = (purpose) => {
    const current = filters.purposes || [];
    const next = current.includes(purpose)
      ? current.filter(p => p !== purpose)
      : [...current, purpose];
    onChange({ ...filters, purposes: next });
  };

  const isPurposeActive = (purpose) => (filters.purposes || []).includes(purpose);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 12,
      padding: "16px 20px",
      background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
      borderRadius: BORDER_RADIUS.lg,
      border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
      marginBottom: 20
    }}>
      {/* 监控类型 - 可复选按钮 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={labelStyle}>{language === "zh" ? "监控类型" : "Monitor Type"}</span>
        {PURPOSE_OPTIONS[language].map(p => (
          <button
            key={p.key}
            onClick={() => togglePurpose(p.key)}
            style={purposeBtnStyle(isPurposeActive(p.key), PURPOSE_DOTS[p.key])}
          >
            <span style={purposeDotStyle(isPurposeActive(p.key) ? "#fff" : PURPOSE_DOTS[p.key])} />
            {p.label}
          </button>
        ))}
      </div>

      {/* 筛选下拉 + 搜索 */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={labelStyle}>{language === "zh" ? "日期" : "Date"}</span>
          <select
            value={filters.dateRange}
            onChange={(e) => onChange({ ...filters, dateRange: e.target.value })}
            style={selectStyle}
          >
            {renderOptions(DATE_RANGES[language])}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={labelStyle}>{language === "zh" ? "业务" : "Business"}</span>
          <select
            value={filters.businessCategory}
            onChange={(e) => onChange({ ...filters, businessCategory: e.target.value })}
            style={{ ...selectStyle, minWidth: 140 }}
          >
            <option key="all" value="all">{language === "zh" ? "全部" : "All"}</option>
            {businessCategories.filter(c => c.active).map(c => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={labelStyle}>{language === "zh" ? "事件" : "Event"}</span>
          <select
            value={filters.eventCategory}
            onChange={(e) => onChange({ ...filters, eventCategory: e.target.value })}
            style={{ ...selectStyle, minWidth: 140 }}
          >
            {renderOptions(EVENT_CATEGORIES[language])}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={labelStyle}>{language === "zh" ? "来源" : "Source"}</span>
          <select
            value={filters.sourceType}
            onChange={(e) => onChange({ ...filters, sourceType: e.target.value })}
            style={selectStyle}
          >
            {renderOptions(SOURCE_TYPES[language])}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 220 }}>
          <input
            type="text"
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && onSearch()}
            placeholder={t.competitiveIntelligence.keywordSearch}
            style={{
              flex: 1,
              padding: "7px 12px",
              borderRadius: BORDER_RADIUS.md,
              border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
              background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
              color: darkMode ? "#e8e8e8" : COLORS.text.primary,
              fontSize: FONT_SIZES.md,
              outline: "none"
            }}
          />
          <button
            onClick={onSearch}
            disabled={loading}
            style={{
              padding: "7px 16px",
              borderRadius: BORDER_RADIUS.md,
              border: "none",
              background: loading ? "#aaa" : COLORS.primary,
              color: "#fff",
              fontSize: FONT_SIZES.md,
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              transition: `all ${TRANSITIONS.fast}`
            }}
          >
            {loading ? t.buttons.fetching : t.competitiveIntelligence.searchButton}
          </button>
        </div>
      </div>
    </div>
  );
}
