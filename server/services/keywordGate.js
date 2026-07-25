import { matchesAnyKeyword } from "./filterRules.js";

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
      if (excludeMatch) continue;

      // All purposes require BOTH enterprise AND include_keyword (AND logic)
      if (subjectMatch && includeMatch) {
        matchedPurposes.push(purpose);
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
