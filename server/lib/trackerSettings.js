import db from "../db.js";

export const DEFAULTS = {
  lookback_hours: "24",
  max_per_source: "3",
  wechat_mcp_per_feed_limit: "10",
  include_business_domains: "",
  include_enterprise_types: "",
  include_categories: "",
  exclude_keywords: "股票,证券,股市,行情,广告,推广,赞助",
  required_industry_keywords: "",
  required_company_keywords: "",
  fuzzy_deduplication_threshold: "0.85",
  schedule_enabled: "1",
  schedule_frequency: "daily",
  schedule_time: "05:00",
  schedule_weekday: "1",
  enabled_source_types: ""
};

// 与"数据来源"页可创建的合法类型一致（server/routes/sources.js ALLOWED_TYPES 中
// 前端展示的三种）；微信合集/wechat_album、Tavily 为历史遗留类型，不在选项中。
export const SOURCE_TYPES = ["rss", "website", "wechat_mcp"];

// Build a node-cron expression from schedule settings. Falls back to the
// default daily 05:00 when the time is missing or malformed.
export function buildScheduleCron({ scheduleFrequency, scheduleTime, scheduleWeekday }) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(scheduleTime || "");
  if (!match) return "0 5 * * *";
  const [hour, minute] = [parseInt(match[1], 10), parseInt(match[2], 10)];
  if (scheduleFrequency === "weekly") {
    const dow = Number.isInteger(scheduleWeekday) && scheduleWeekday >= 0 && scheduleWeekday <= 6
      ? scheduleWeekday
      : 1;
    return `${minute} ${hour} * * ${dow}`;
  }
  return `${minute} ${hour} * * *`;
}

// 严格按列表过滤：只有勾选的信源类型才会被抓取；空列表 = 什么都不抓。
export function filterSourcesByType(sources, enabledSourceTypes) {
  const enabled = Array.isArray(enabledSourceTypes) ? enabledSourceTypes : [];
  return sources.filter(s => enabled.includes(s.type));
}

export function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return [];
  return value.split(",").map(s => s.trim()).filter(Boolean);
}

export function loadSettings() {
  const rows = db.prepare("SELECT key, value FROM tracker_settings").all();
  const map = { ...DEFAULTS };
  for (const row of rows) map[row.key] = row.value;

  // enabled_source_types：从未配置过 → 默认全部合法信源都勾选；
  // 一旦保存过（含空）→ 以保存值为准（空 = 全部不抓）。
  const sourceTypesKeySaved = rows.some(r => r.key === "enabled_source_types");
  const enabledSourceTypes = sourceTypesKeySaved
    ? toArray(map.enabled_source_types)
    : [...SOURCE_TYPES];

  return {
    lookbackHours: parseInt(map.lookback_hours, 10) || 24,
    maxPerSource: parseInt(map.max_per_source, 10) || 3,
    wechatMcpPerFeedLimit: parseInt(map.wechat_mcp_per_feed_limit, 10) || 10,
    includeBusinessDomains: toArray(map.include_business_domains),
    includeEnterpriseTypes: toArray(map.include_enterprise_types),
    includeCategories: toArray(map.include_categories),
    excludeKeywords: toArray(map.exclude_keywords),
    requiredIndustryKeywords: toArray(map.required_industry_keywords),
    requiredCompanyKeywords: toArray(map.required_company_keywords),
    fuzzyDeduplicationThreshold: parseFloat(map.fuzzy_deduplication_threshold) || 0.85,
    scheduleEnabled: map.schedule_enabled !== "0",
    scheduleFrequency: map.schedule_frequency === "weekly" ? "weekly" : "daily",
    scheduleTime: map.schedule_time,
    scheduleWeekday: parseInt(map.schedule_weekday, 10) >= 0 && parseInt(map.schedule_weekday, 10) <= 6
      ? parseInt(map.schedule_weekday, 10)
      : 1,
    enabledSourceTypes
  };
}
