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
  const requiredIndustryKeywords = parseList(context.requiredIndustryKeywords);
  const requiredCompanyKeywords = parseList(context.requiredCompanyKeywords);
  const enterpriseKeywords = context.enterpriseKeywords || [];
  const includeKeywords = context.includeKeywords || [];
  const excludeRuleKeywords = context.excludeRuleKeywords || [];

  const hasIndustryGate = requiredIndustryKeywords.length > 0;
  const hasCompanyGate = requiredCompanyKeywords.length > 0;
  const hasEnterpriseGate = enterpriseKeywords.length > 0;
  const hasIncludeGate = includeKeywords.length > 0;
  const hasExcludeGate = excludeRuleKeywords.length > 0;

  const kept = [];
  let excluded = 0;

  for (const item of items) {
    if (!item.title) {
      excluded++;
      continue;
    }

    // 1. Global exclude keywords (tracker_settings)
    if (excludeKeywords.length && matchesAnyKeyword(item, excludeKeywords)) {
      excluded++;
      continue;
    }

    // 2. Exclude rule keywords (filter_rules.type=exclude_keyword)
    if (hasExcludeGate && matchesAnyKeyword(item, excludeRuleKeywords)) {
      excluded++;
      continue;
    }

    // 3. Three-layer progressive structure:
    //    (enterprise OR ...) AND (include OR ...) AND NOT (exclude OR ...)
    const enterpriseMatch = hasEnterpriseGate && matchesAnyKeyword(item, enterpriseKeywords);
    const includeMatch = hasIncludeGate && matchesAnyKeyword(item, includeKeywords);
    const companyMatch = hasCompanyGate && matchesAnyKeyword(item, requiredCompanyKeywords);

    // At least one of the three layers must be configured to apply the gate
    if (hasEnterpriseGate || hasIncludeGate || hasCompanyGate || hasIndustryGate) {
      const anyMatch = enterpriseMatch || includeMatch || companyMatch ||
        (hasIndustryGate && matchesAnyKeyword(item, requiredIndustryKeywords));
      if (!anyMatch) {
        excluded++;
        continue;
      }
    }

    kept.push(item);
  }

  return { kept, excluded };
}
