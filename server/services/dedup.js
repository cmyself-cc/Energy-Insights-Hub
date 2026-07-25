import db from "../db.js";
import { fuzzyTitleSimilarity, normalizeUrl } from "../crawlers/utils.js";

function normalizeTitle(title) {
  return String(title || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function loadRecentInsights(lookbackDays) {
  if (!db) return [];
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  return db
    .prepare("SELECT title, url FROM insights WHERE publish_date >= ? OR created_at >= ?")
    .all(since, since);
}

export function deduplicateItems(items, options = {}) {
  const threshold = options.threshold ?? 0.85;
  const lookbackDays = options.lookbackDays ?? 30;

  const recent = loadRecentInsights(lookbackDays);
  const recentUrlSet = new Set(
    recent.map(r => normalizeUrl(r.url || "")).filter(Boolean)
  );
  const recentRawUrlSet = new Set(
    recent.map(r => (r.url || "").toLowerCase().trim()).filter(Boolean)
  );
  const recentTitles = recent.map(r => r.title).filter(Boolean);

  const result = [];
  const seenUrls = new Set();
  const seenRawUrls = new Set();
  const seenTitles = new Set();

  for (const item of items) {
    const urlKey = item.url ? normalizeUrl(item.url) : null;
    const rawUrlKey = item.url ? item.url.toLowerCase().trim() : null;

    // Strong URL dedup: normalized and raw lowercased URL
    if (urlKey && (seenUrls.has(urlKey) || recentUrlSet.has(urlKey))) {
      continue;
    }
    if (rawUrlKey && (seenRawUrls.has(rawUrlKey) || recentRawUrlSet.has(rawUrlKey))) {
      continue;
    }

    const normTitle = normalizeTitle(item.title);
    if (normTitle) {
      if (seenTitles.has(normTitle)) continue;

      const dbDuplicate = recentTitles.some(
        t => fuzzyTitleSimilarity(normTitle, t) >= threshold
      );
      if (dbDuplicate) continue;

      const batchDuplicate = result.some(
        r => fuzzyTitleSimilarity(item.title, r.title) >= threshold
      );
      if (batchDuplicate) continue;
    }

    if (urlKey) seenUrls.add(urlKey);
    if (rawUrlKey) seenRawUrls.add(rawUrlKey);
    if (normTitle) seenTitles.add(normTitle);
    result.push(item);
  }

  return result;
}
