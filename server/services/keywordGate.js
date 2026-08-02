import { matchesAnyKeyword, findMatchedKeyword } from "./filterRules.js";
import db from "../db.js";

const DEFAULT_INDUSTRY_KEYWORDS = [
  "电力", "氢能", "储能", "光伏", "油气", "CCS", "LNG", "天然气",
  "风电", "核电", "电池", "充电", "碳中和", "碳捕集",
  "生物燃料", "润滑油", "化工", "炼化"
];

const TRACE_KEYWORD_GATE = process.env.TRACE_KEYWORD_GATE === "1";

/**
 * Load active industry keywords WITH their aliases from industry_categories.
 * Only includes categories that are referenced by required_industry_keywords
 * in tracker_settings (or all active categories if that setting is empty).
 * Returns [{name, aliases}] so the industry filter can expand synonyms.
 */
export function loadIndustryKeywordsWithAliases() {
  const cats = db.prepare("SELECT name, keywords, aliases FROM industry_categories").all();
  const result = [];
  for (const cat of cats) {
    let keywords = [];
    try { keywords = JSON.parse(cat.keywords || "[]"); } catch {}
    let aliases = [];
    try { aliases = JSON.parse(cat.aliases || "[]"); } catch {}
    for (const kw of keywords.filter(k => k && String(k).trim())) {
      result.push({ name: String(kw).trim(), aliases });
    }
  }
  return result;
}

export function applyIndustryFilter(items, industryKeywords) {
  const keywords = industryKeywords && industryKeywords.length > 0 ? industryKeywords : DEFAULT_INDUSTRY_KEYWORDS;
  if (!keywords || keywords.length === 0) return items;
  return items.filter(item => {
    const ok = findMatchedKeyword(item, keywords) !== null;
    if (TRACE_KEYWORD_GATE && !ok) {
      console.log(`[industry-filter] EXCLUDED: "${(item.title||'').slice(0,50)}" — no industry keyword in: ${(item.title||'').slice(0,40)} ${(item.summary||'').slice(0,60)}`);
    }
    return ok;
  });
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map(s => s.trim()).filter(Boolean);
  }
  return [];
}

export function applyKeywordGate(items, context) {
  const excludeKeywords = parseList(context.excludeKeywords);
  const purposeRules = context.purposeRules || {};

  const kept = [];
  let excluded = 0;

  for (const item of items) {
    if (!item.title) { excluded++; continue; }

    // Global exclude keywords (tracker_settings)
    if (excludeKeywords.length && matchesAnyKeyword(item, excludeKeywords)) {
      excluded++;
      continue;
    }

    // If no purpose rules configured, pass through
    const hasPurposeRules = Object.keys(purposeRules).length > 0;
    if (!hasPurposeRules) {
      kept.push(item);
      continue;
    }

    // Check which purposes this item matches (collect ALL, not just first)
    const matchedPurposes = [];
    for (const [purpose, rules] of Object.entries(purposeRules)) {
      const subjectMatch = rules.enterprise?.length > 0 && matchesAnyKeyword(item, rules.enterprise);
      const includeMatch = rules.include_keyword?.length > 0 && matchesAnyKeyword(item, rules.include_keyword);
      const excludeMatch = rules.exclude_keyword?.length > 0 && matchesAnyKeyword(item, rules.exclude_keyword);

      // Exclude keyword blocks the match for this purpose
      if (excludeMatch) {
        if (TRACE_KEYWORD_GATE) {
          const exKw = findMatchedKeyword(item, rules.exclude_keyword);
          console.log(`[keyword-gate] ${purpose}: EXCLUDED by "${exKw}" — "${(item.title||'').slice(0,50)}"`);
        }
        continue;
      }

      // All purposes require BOTH enterprise AND include_keyword (AND logic)
      if (subjectMatch && includeMatch) {
        matchedPurposes.push(purpose);
        if (TRACE_KEYWORD_GATE) {
          const entKw = findMatchedKeyword(item, rules.enterprise);
          const incKw = findMatchedKeyword(item, rules.include_keyword);
          console.log(`[keyword-gate] ${purpose}: MATCHED ent="${entKw}" + inc="${incKw}" — "${(item.title||'').slice(0,50)}"`);
        }
      } else if (TRACE_KEYWORD_GATE) {
        const entKw = findMatchedKeyword(item, rules.enterprise);
        const incKw = findMatchedKeyword(item, rules.include_keyword);
        console.log(`[keyword-gate] ${purpose}: FAIL ent=${entKw||"none"} inc=${incKw||"none"} — "${(item.title||'').slice(0,50)}"`);
      }
    }

    if (matchedPurposes.length === 0) {
      excluded++;
      continue;
    }

    item.matchedPurposes = matchedPurposes;

    kept.push(item);
  }

  return { kept, excluded };
}
