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

export const PURPOSES = ["competitor", "policy", "tech"];

function emptyBucket() {
  return { enterprise: [], include_keyword: [], exclude_keyword: [] };
}

function parseAliases(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function addRule(bucket, rule) {
  const entry = { name: rule.name, aliases: parseAliases(rule.aliases) };
  if (rule.type === "enterprise") bucket.enterprise.push(entry);
  else if (rule.type === "include_keyword") bucket.include_keyword.push(entry);
  else if (rule.type === "exclude_keyword") bucket.exclude_keyword.push(entry);
}

export function groupRulesByPurpose(rules) {
  const grouped = {};
  const global = emptyBucket(); // rules with purpose = '' apply to every purpose
  for (const rule of rules) {
    if (rule.purpose) {
      if (!grouped[rule.purpose]) grouped[rule.purpose] = emptyBucket();
      addRule(grouped[rule.purpose], rule);
    } else {
      addRule(global, rule);
    }
  }
  const hasGlobal = global.enterprise.length || global.include_keyword.length || global.exclude_keyword.length;
  if (hasGlobal) {
    // Global rules merge into every existing purpose bucket; if no purpose-specific
    // rules exist at all, they stand alone under each known purpose.
    if (Object.keys(grouped).length === 0) {
      for (const p of PURPOSES) grouped[p] = emptyBucket();
    }
    for (const bucket of Object.values(grouped)) {
      bucket.enterprise.push(...global.enterprise);
      bucket.include_keyword.push(...global.include_keyword);
      bucket.exclude_keyword.push(...global.exclude_keyword);
    }
  }
  return grouped;
}

/**
 * Expand a keyword entry into the list of search terms (base + aliases).
 * Accepts either a plain string or an object {name, aliases}.
 */
function keywordTerms(k) {
  if (typeof k === "string") return [k];
  if (k && typeof k === "object") {
    const base = String(k.name || "").trim();
    const aliases = Array.isArray(k.aliases) ? k.aliases.map(String) : [];
    return base ? [base, ...aliases] : aliases;
  }
  return [];
}

/**
 * Return the first keyword term that matches the item text (case-insensitive substring).
 * Returns null when nothing matches. Useful for trace logging.
 */
export function findMatchedKeyword(item, keywords) {
  if (!keywords || keywords.length === 0) return null;
  const text = `${item.title || ""} ${item.summary || ""}`.toLowerCase();
  for (const k of keywords) {
    for (const term of keywordTerms(k)) {
      if (text.includes(String(term).toLowerCase())) return term;
    }
  }
  return null;
}

export function matchesAnyKeyword(item, keywords) {
  return findMatchedKeyword(item, keywords) !== null;
}

// ============================================================================
// Legacy composite-filter helpers (kept for backward compatibility with tests
// and older callers). These operate on rule objects with must_include /
// must_exclude keyword lists (string arrays, CSV strings, or JSON strings).
// ============================================================================

function parseKeywordList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    // Try JSON first (e.g. '["中石油"]'), then CSV
    const trimmed = value.trim();
    if (trimmed.startsWith("[")) {
      try {
        const arr = JSON.parse(trimmed);
        if (Array.isArray(arr)) return arr.map(String).filter(Boolean);
      } catch {}
    }
    return trimmed.split(",").map(s => s.trim()).filter(Boolean);
  }
  return [];
}

export function matchesExclusion(item, rule) {
  const excludes = parseKeywordList(rule?.must_exclude);
  if (excludes.length === 0) return false;
  const text = `${item.title || ""} ${item.summary || ""}`.toLowerCase();
  return excludes.some(k => text.includes(String(k).toLowerCase()));
}

export function matchesComposite(item, rule) {
  const includes = parseKeywordList(rule?.must_include);
  const excludes = parseKeywordList(rule?.must_exclude);
  const text = `${item.title || ""} ${item.summary || ""}`.toLowerCase();
  // ALL include keywords must be present
  const allIncludes = includes.every(k => text.includes(String(k).toLowerCase()));
  if (!allIncludes) return false;
  // NO exclude keyword may be present
  const anyExclude = excludes.some(k => text.includes(String(k).toLowerCase()));
  return !anyExclude;
}

export function applyKeywordFilters(items, rules) {
  if (!items || items.length === 0) return [];
  const ruleList = Array.isArray(rules) ? rules : [];
  const compositeRules = ruleList.filter(r => r.type === "composite");
  const excludeRules = ruleList.filter(r => r.type === "exclude_keyword");

  return items.filter(item => {
    // Drop anything hit by an exclude rule
    if (excludeRules.some(r => matchesExclusion(item, r))) return false;
    // If no composite rules exist, keep the item
    if (compositeRules.length === 0) return true;
    // Otherwise require at least one composite rule to fully match
    return compositeRules.some(r => matchesComposite(item, r));
  });
}
