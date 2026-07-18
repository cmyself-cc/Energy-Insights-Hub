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

function addRule(bucket, rule) {
  if (rule.type === "enterprise") bucket.enterprise.push(rule.name);
  else if (rule.type === "include_keyword") bucket.include_keyword.push(rule.name);
  else if (rule.type === "exclude_keyword") bucket.exclude_keyword.push(rule.name);
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

export function matchesAnyKeyword(item, keywords) {
  if (!keywords || keywords.length === 0) return false;
  const text = `${item.title || ""} ${item.summary || ""}`.toLowerCase();
  return keywords.some(k => text.includes(String(k).toLowerCase()));
}
