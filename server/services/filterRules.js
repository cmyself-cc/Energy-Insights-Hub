import db from "../db.js";

export function loadFilterRules() {
  return db
    .prepare("SELECT * FROM filter_rules WHERE active = 1 ORDER BY priority DESC, id ASC")
    .all();
}

function getSearchText(item) {
  return `${item.title || ""} ${item.summary || ""}`.toLowerCase();
}

function parseKeywordList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // malformed JSON: fall through to empty list
    }
  }
  return [];
}

function normalizeKeyword(keyword) {
  return typeof keyword === "string" ? keyword.toLowerCase() : String(keyword).toLowerCase();
}

export function matchesExclusion(item, rule) {
  const text = getSearchText(item);
  const keywords = parseKeywordList(rule.must_exclude);
  return keywords.some(k => text.includes(normalizeKeyword(k)));
}

export function matchesComposite(item, rule) {
  const text = getSearchText(item);
  const include = parseKeywordList(rule.must_include);
  const exclude = parseKeywordList(rule.must_exclude);
  const includesMatch = include.every(k => text.includes(normalizeKeyword(k)));
  const excludesMatch = exclude.some(k => text.includes(normalizeKeyword(k)));
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
