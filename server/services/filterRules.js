import db from "../db.js";

export function loadFilterRules() {
  return db
    .prepare("SELECT * FROM filter_rules WHERE active = 1 ORDER BY priority DESC, id ASC")
    .all();
}

function getSearchText(item) {
  return `${item.title || ""} ${item.summary || ""}`.toLowerCase();
}

function normalizeKeyword(keyword) {
  return typeof keyword === "string" ? keyword.toLowerCase() : String(keyword).toLowerCase();
}

export function matchesKeyword(item, keyword) {
  if (!keyword) return false;
  const text = getSearchText(item);
  return text.includes(normalizeKeyword(keyword));
}

export function matchesAnyKeyword(item, keywords) {
  if (!keywords || keywords.length === 0) return false;
  const text = getSearchText(item);
  return keywords.some(k => text.includes(normalizeKeyword(k)));
}
