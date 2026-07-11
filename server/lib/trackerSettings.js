import db from "../db.js";

export const DEFAULTS = {
  lookback_hours: "24",
  max_per_source: "3",
  include_business_domains: "",
  include_enterprise_types: "",
  include_categories: "",
  exclude_keywords: "股票,证券,股市,行情,广告,推广,赞助",
  required_industry_keywords: "",
  required_company_keywords: "",
  fuzzy_deduplication_threshold: "0.85"
};

export function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return [];
  return value.split(",").map(s => s.trim()).filter(Boolean);
}

export function loadSettings() {
  const rows = db.prepare("SELECT key, value FROM tracker_settings").all();
  const map = { ...DEFAULTS };
  for (const row of rows) map[row.key] = row.value;

  return {
    lookbackHours: parseInt(map.lookback_hours, 10) || 24,
    maxPerSource: parseInt(map.max_per_source, 10) || 3,
    includeBusinessDomains: toArray(map.include_business_domains),
    includeEnterpriseTypes: toArray(map.include_enterprise_types),
    includeCategories: toArray(map.include_categories),
    excludeKeywords: toArray(map.exclude_keywords),
    requiredIndustryKeywords: toArray(map.required_industry_keywords),
    requiredCompanyKeywords: toArray(map.required_company_keywords),
    fuzzyDeduplicationThreshold: parseFloat(map.fuzzy_deduplication_threshold) || 0.85
  };
}
