import db from "../db.js";
import { fuzzyTitleSimilarityFromSignatures, titleSignature, normalizeUrl } from "../crawlers/utils.js";

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
  // 库内标题签名只构建一次；候选标题签名每条构建一次（原为每条候选 × 每条库内
  // 标题都重建两侧 n-gram，2026-10-22 收敛为 O(N+M) 次构建 + O(N×M) 次集合交集）。
  const recentSigs = recent
    .map(r => titleSignature(r.title))
    .filter(s => s.norm);

  const result = [];
  const seenUrls = new Set();
  const seenRawUrls = new Set();
  const seenTitles = new Set();
  const batchSigs = [];

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

      const sig = titleSignature(item.title);
      const dbDuplicate = recentSigs.some(
        s => fuzzyTitleSimilarityFromSignatures(sig, s) >= threshold
      );
      if (dbDuplicate) continue;

      const batchDuplicate = batchSigs.some(
        s => fuzzyTitleSimilarityFromSignatures(sig, s) >= threshold
      );
      if (batchDuplicate) continue;
      batchSigs.push(sig);
    }

    if (urlKey) seenUrls.add(urlKey);
    if (rawUrlKey) seenRawUrls.add(rawUrlKey);
    if (normTitle) seenTitles.add(normTitle);
    result.push(item);
  }

  return result;
}
