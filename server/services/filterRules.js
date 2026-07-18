import db from "../db.js";

export function loadFilterRules(purpose = null) {
  if (purpose) {
    return db
      .prepare("SELECT * FROM filter_rules WHERE active = 1 AND (purpose = ? OR purpose = '') ORDER BY priority DESC, id ASC")
      .all(purpose);
  }
  return db
    .prepare("SELECT * FROM filter_rules WHERE active = 1 ORDER BY priority DESC, id ASC")
    .all();
}

export function groupRulesByPurpose(rules) {
  const grouped = {};
  for (const rule of rules) {
    const p = rule.purpose || "competitor";
    if (!grouped[p]) grouped[p] = { enterprise: [], include_keyword: [], exclude_keyword: [] };
    if (rule.type === "enterprise") grouped[p].enterprise.push(rule.name);
    else if (rule.type === "include_keyword") grouped[p].include_keyword.push(rule.name);
    else if (rule.type === "exclude_keyword") grouped[p].exclude_keyword.push(rule.name);
  }
  return grouped;
}

export function matchesAnyKeyword(item, keywords) {
  if (!keywords || keywords.length === 0) return false;
  const text = `${item.title || ""} ${item.summary || ""}`.toLowerCase();
  return keywords.some(k => text.includes(String(k).toLowerCase()));
}
