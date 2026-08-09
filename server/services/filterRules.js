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

export const PURPOSES = ["competitor", "policy", "tech", "industry"];

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

/**
 * Pure-ASCII aliases of ≤2 chars (e.g. "GW") collide with units/abbreviations
 * in titles and must never be used as subject keywords. Names are exempt —
 * they are explicit configuration.
 */
export function isRiskyShortAlias(term) {
  return /^[A-Za-z]{1,2}$/.test(String(term || "").trim());
}

/**
 * Collect active subject keywords grouped by monitoring purpose:
 * - competitor / policy / tech: enterprise-type filter rules (per-purpose;
 *   global rules with empty purpose count for all three). Include keywords are
 *   action verbs (发布/合作/...), not subjects, so they are excluded.
 * - industry: no dedicated config — defaults to all industry pre-filter
 *   keywords (industry_categories, active only).
 * Longer keywords first so highlighting/matching prefers the longest match.
 */
export function collectSubjectKeywordsByPurpose() {
  const byPurpose = {
    competitor: new Set(),
    policy: new Set(),
    tech: new Set(),
    industry: new Set()
  };
  for (const r of loadFilterRules()) {
    if (r.type !== "enterprise") continue;
    const base = String(r.name || "").trim();
    const terms = [
      ...(base ? [base] : []),
      ...parseAliases(r.aliases).filter(a => !isRiskyShortAlias(a))
    ];
    const targets = r.purpose && byPurpose[r.purpose] ? [r.purpose] : ["competitor", "policy", "tech"];
    for (const t of targets) {
      for (const term of terms) {
        const v = String(term).trim();
        if (v) byPurpose[t].add(v);
      }
    }
  }
  const cats = db.prepare("SELECT keywords, aliases FROM industry_categories WHERE active = 1").all();
  for (const cat of cats) {
    let keywords = [];
    try { keywords = JSON.parse(cat.keywords || "[]"); } catch {}
    let aliases = [];
    try { aliases = JSON.parse(cat.aliases || "[]"); } catch {}
    for (const kw of [...keywords, ...aliases]) {
      const v = String(kw || "").trim();
      if (v) byPurpose.industry.add(v);
    }
  }
  const out = {};
  for (const [p, set] of Object.entries(byPurpose)) {
    out[p] = [...set].sort((a, b) => b.length - a.length);
  }
  return out;
}

/** Flat, de-duplicated union of all purpose subject keywords (longest first). */
export function allSubjectKeywords(byPurpose) {
  return [...new Set(Object.values(byPurpose || {}).flat())].sort((a, b) => b.length - a.length);
}

/**
 * Whether the title contains at least one subject keyword (case-insensitive).
 * An empty keyword list means no rules configured — pass through without blocking.
 */
export function titleContainsSubjectKeyword(title, keywords) {
  if (!keywords || keywords.length === 0) return true;
  const text = String(title || "").toLowerCase();
  return keywords.some(k => text.includes(String(k).toLowerCase()));
}

/**
 * 监控类型单选优先级：竞争 > 技术 > 政策 > 行业。
 * 当标题同时命中多类主体关键词时，按此顺序取第一个。
 */
export const PURPOSE_PRIORITY = ["competitor", "tech", "policy", "industry"];

/**
 * 根据标题命中的主体关键词类别判定监控类型（确定性规则，不依赖 LLM）。
 * 返回按 PURPOSE_PRIORITY 排序的命中列表（通常只取 [0] 单选）。
 * 标题未命中任何类别的关键词 → 空数组（调用方据此淘汰该文）。
 */
export function resolvePurposeFromTitle(title, subjectKeywordsByPurpose) {
  if (!subjectKeywordsByPurpose) return [];
  return PURPOSE_PRIORITY.filter(p =>
    titleContainsSubjectKeyword(title, subjectKeywordsByPurpose[p] || [])
  );
}

/**
 * 最终监控类型（单选）：
 * 1. 主体关键词判定（确定性）：标题命中哪类主体词 → 该类别（竞争>技术>政策>行业）；
 * 2. LLM 筛查（对所有初判生效）：若 LLM 确认该文是"行业整体的通用动态"
 *    （isIndustryOverview=true，如"中国核电装机""LNG销量"这类不以某家企业为主体的
 *    行业/宏观情况），且标题含行业主体关键词（保证卡片可高亮行业词），则调整为 industry；
 * 3. 标题零命中 → 空数组（post-filter 据此淘汰）。
 */
export function resolveMatchedPurposes({ title, subjectKeywordsByPurpose, isIndustryOverview = false }) {
  const base = resolvePurposeFromTitle(title, subjectKeywordsByPurpose)[0];
  if (!base) return [];
  if (isIndustryOverview === true && titleContainsSubjectKeyword(title, subjectKeywordsByPurpose?.industry || [])) {
    return ["industry"];
  }
  return [base];
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
