export function isWithinLookback(item, hours) {
  if (!Number.isFinite(hours) || hours <= 0) return true;
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

  const groups = new Map();
  for (const item of items) {
    const key = item.sourceId || item.source || "_default";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const result = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => {
      const dateA = new Date(a.publishDate || a.publish_date || 0).getTime();
      const dateB = new Date(b.publishDate || b.publish_date || 0).getTime();
      return dateB - dateA;
    });
    result.push(...sorted.slice(0, max));
  }

  return result;
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

  const seen = new Set();
  candidates = candidates.filter(item => {
    const keys = [];
    if (item.url) keys.push(`url:${item.url}`);

    const normalizedTitle = typeof item.title === "string" ? item.title.trim().toLowerCase() : "";
    if (normalizedTitle) keys.push(`title:${normalizedTitle}`);

    if (keys.length === 0) return true;
    if (keys.some(k => seen.has(k))) return false;

    for (const key of keys) seen.add(key);
    return true;
  });

  candidates = limitPerSource(candidates, settings.maxPerSource);
  return candidates;
}

export function applyPostFilter(insights, settings) {
  return insights
    .filter(insight => matchesInclusions(insight, settings))
    .filter(insight => !matchesExclusions(insight, settings.excludeKeywords))
    .filter(insight => insight.title && insight.title.trim() !== "");
}
