import db from "../db.js";

export function loadFilterRules() {
  return db
    .prepare("SELECT * FROM filter_rules WHERE active = 1 ORDER BY priority DESC, id ASC")
    .all();
}

function getSearchText(item) {
  return `${item.title || ""} ${item.summary || ""} ${item.rawContent || ""}`.toLowerCase();
}

function parseKeywordList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) return JSON.parse(value);
  return [];
}

export function matchesExclusion(item, rule) {
  const text = getSearchText(item);
  const keywords = parseKeywordList(rule.must_exclude);
  return keywords.some(k => text.includes(k.toLowerCase()));
}

export function matchesComposite(item, rule) {
  const text = getSearchText(item);
  const include = parseKeywordList(rule.must_include);
  const exclude = parseKeywordList(rule.must_exclude);
  const includesMatch = include.every(k => text.includes(k.toLowerCase()));
  const excludesMatch = exclude.some(k => text.includes(k.toLowerCase()));
  return includesMatch && !excludesMatch;
}

export function applyKeywordFilters(items, rules) {
  const excludeRules = rules.filter(r => r.type === "exclude_keyword");
  const compositeRules = rules.filter(r => r.type === "composite");

  return items.filter(item => {
    if (excludeRules.some(rule => matchesExclusion(item, rule))) return false;
    if (compositeRules.length > 0) {
      return compositeRules.some(rule => matchesComposite(item, rule));
    }
    return true;
  });
}
