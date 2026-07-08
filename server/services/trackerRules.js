export function isWithinLookback(item, hours) {
  const date = item.publishDate || item.publish_date;
  if (!date) return true;
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return new Date(date).getTime() >= cutoff;
}

export function matchesExclusions(item, excludeKeywords) {
  if (!excludeKeywords || excludeKeywords.length === 0) return false;
  const text = `${item.title || ""} ${item.summary || ""} ${item.rawContent || ""}`.toLowerCase();
  return excludeKeywords.some(k => text.includes(k.toLowerCase()));
}

export function limitPerSource(items, max) {
  if (!max || max <= 0) return items;
  return [...items]
    .sort((a, b) => new Date(b.publishDate || b.publish_date || 0) - new Date(a.publishDate || a.publish_date || 0))
    .slice(0, max);
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) return value.split(",").map(s => s.trim()).filter(Boolean);
  return [];
}

function intersects(a, b) {
  const lowerB = b.map(x => x.toLowerCase());
  return a.some(x => lowerB.includes(x.toLowerCase()));
}

export function matchesInclusions(insight, settings) {
  const domains = normalizeArray(settings.includeBusinessDomains);
  const enterprises = normalizeArray(settings.includeEnterpriseTypes);
  const categories = normalizeArray(settings.includeCategories);

  if (domains.length === 0 && enterprises.length === 0 && categories.length === 0) return true;

  const domainMatch = domains.length === 0 || domains.some(d =>
    (insight.businessDomain || "").toLowerCase().includes(d.toLowerCase())
  );
  const enterpriseMatch = enterprises.length === 0 || enterprises.some(e =>
    (insight.enterpriseType || "").toLowerCase().includes(e.toLowerCase())
  );
  const categoryMatch = categories.length === 0 || intersects(insight.features || [], categories);

  return domainMatch && enterpriseMatch && categoryMatch;
}

export function applyPreFilter(items, settings) {
  let candidates = items.filter(item => isWithinLookback(item, settings.lookbackHours));
  candidates = candidates.filter(item => !matchesExclusions(item, settings.excludeKeywords));
  candidates = limitPerSource(candidates, settings.maxPerSource);
  return candidates;
}

export function applyPostFilter(insights, settings) {
  return insights
    .filter(insight => matchesInclusions(insight, settings))
    .filter(insight => !matchesExclusions(insight, settings.excludeKeywords))
    .filter(insight => insight.title && insight.title.trim() !== "");
}
