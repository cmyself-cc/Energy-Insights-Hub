import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "../constants/theme";
import { i18n } from "../constants/i18n";
import { DATE_RANGES, BUSINESS_DOMAINS, ENTERPRISE_TYPES, SOURCE_TYPES } from "../constants/taxonomy";

export default function FilterBar({
  darkMode,
  language,
  filters,
  onChange,
  onSearch,
  loading
}) {
  const t = i18n[language];

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

  const renderOptions = (options) => options.map(o => (
    <option key={o.key} value={o.key}>{o.label}</option>
  ));

  return (
    <div style={{
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      gap: "12px 16px",
      padding: "16px 20px",
      background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
      borderRadius: BORDER_RADIUS.lg,
      border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
      marginBottom: 20
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={labelStyle}>{t.competitiveIntelligence.dateFilter}</span>
        <select
          value={filters.dateRange}
          onChange={(e) => onChange({ ...filters, dateRange: e.target.value })}
          style={selectStyle}
        >
          {renderOptions(DATE_RANGES[language])}
        </select>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={labelStyle}>{t.competitiveIntelligence.businessDomain}</span>
        <select
          value={filters.businessDomain}
          onChange={(e) => onChange({ ...filters, businessDomain: e.target.value })}
          style={{ ...selectStyle, minWidth: 140 }}
        >
          {renderOptions(BUSINESS_DOMAINS[language])}
        </select>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={labelStyle}>{t.competitiveIntelligence.enterpriseType}</span>
        <select
          value={filters.enterpriseType}
          onChange={(e) => onChange({ ...filters, enterpriseType: e.target.value })}
          style={{ ...selectStyle, minWidth: 140 }}
        >
          {renderOptions(ENTERPRISE_TYPES[language])}
        </select>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={labelStyle}>{t.competitiveIntelligence.sourceType}</span>
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
  );
}
