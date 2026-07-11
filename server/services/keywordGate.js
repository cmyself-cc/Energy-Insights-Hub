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

    if (requiredIndustryKeywords.length && !containsAny(text, requiredIndustryKeywords)) {
      excluded++;
      continue;
    }

    if (requiredCompanyKeywords.length && !containsAny(text, requiredCompanyKeywords)) {
      excluded++;
      continue;
    }

    if (compositeRules.length && !compositeRules.some(rule => matchesComposite(item, rule))) {
      excluded++;
      continue;
    }

    kept.push(item);
  }

  return { kept, excluded };
}
