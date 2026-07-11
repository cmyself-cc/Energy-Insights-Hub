import { matchesExclusion, matchesComposite } from "./filterRules.js";

function getSearchText(item) {
  return `${item.title || ""} ${item.summary || ""}`.toLowerCase();
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map(s => s.trim()).filter(Boolean);
  }
  return [];
}

function containsAny(text, keywords) {
  return parseList(keywords).some(k => text.includes(k.toLowerCase()));
}

export function applyKeywordGate(items, context) {
  const excludeKeywords = parseList(context.excludeKeywords);
  const requiredIndustryKeywords = parseList(context.requiredIndustryKeywords);
  const requiredCompanyKeywords = parseList(context.requiredCompanyKeywords);
  const compositeRules = context.compositeRules || [];

  const hasIndustryGate = requiredIndustryKeywords.length > 0;
  const hasCompanyGate = requiredCompanyKeywords.length > 0 || compositeRules.length > 0;

  const kept = [];
  let excluded = 0;

  for (const item of items) {
    if (!item.title) {
      excluded++;
      continue;
    }

    const text = getSearchText(item);

    if (excludeKeywords.length && containsAny(text, excludeKeywords)) {
      excluded++;
      continue;
    }

    if (compositeRules.some(rule => matchesExclusion(item, rule))) {
      excluded++;
      continue;
    }

    if (hasIndustryGate || hasCompanyGate) {
      const industryMatch = hasIndustryGate && containsAny(text, requiredIndustryKeywords);
      const companyMatch =
        (requiredCompanyKeywords.length && containsAny(text, requiredCompanyKeywords)) ||
        (compositeRules.length && compositeRules.some(rule => matchesComposite(item, rule)));

      if (!industryMatch && !companyMatch) {
        excluded++;
        continue;
      }
    }

    kept.push(item);
  }

  return { kept, excluded };
}
