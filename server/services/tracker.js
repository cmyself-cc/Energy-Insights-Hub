import cron from "node-cron";
import db from "../db.js";
import { fetchRss } from "./rssFetcher.js";
import { fetchScrape } from "./scraper.js";
import { processInsight } from "./llmProcessor.js";

const BATCH_SIZE = 5; // 并发数，避免触发频率限制
const LANGUAGE = process.env.DEFAULT_LANGUAGE || "zh";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchSourceItems(source) {
  switch (source.type) {
    case "rss":
      return fetchRss(source);
    case "scrape":
      return fetchScrape(source);
    case "api":
      // 预留：API 类型可扩展
      return [];
    default:
      return fetchRss(source);
  }
}

async function processBatch(items, language) {
  const results = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(item => processInsight(item, language)));
    results.push(...batchResults);
    if (i + BATCH_SIZE < items.length) await sleep(1000);
  }
  return results;
}

export async function runTracker(runId = null) {
  const sources = db.prepare("SELECT * FROM sources WHERE active = 1").all();
  if (sources.length === 0) {
    console.log("[tracker] No active sources to track.");
    return;
  }

  if (runId) {
    db.prepare("UPDATE tracker_runs SET sources_total = ?, status = 'running' WHERE id = ?")
      .run(sources.length, runId);
  } else {
    const result = db.prepare(
      "INSERT INTO tracker_runs (sources_total, status, started_at) VALUES (?, 'running', CURRENT_TIMESTAMP)"
    ).run(sources.length);
    runId = result.lastInsertRowid;
  }

  let successCount = 0;
  let failedCount = 0;
  let insightsCreated = 0;
  const errors = [];

  for (const source of sources) {
    try {
      console.log(`[tracker] Fetching source: ${source.name}`);
      const items = await fetchSourceItems(source);
      successCount++;

      // 去重：按 url 或 title
      const newItems = [];
      for (const item of items) {
        if (!item.title) continue;
        const existing = db.prepare(
          "SELECT id FROM insights WHERE url = ? OR title = ?"
        ).get(item.url || "", item.title);
        if (!existing) newItems.push(item);
      }

      if (newItems.length === 0) continue;

      const processed = await processBatch(newItems, LANGUAGE);
      const insert = db.prepare(
        `INSERT INTO insights (
          source_id, title, summary, url, publish_date, source_type,
          business_domain, enterprise_type, entities, features, raw_content
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      const insertMany = db.transaction((rows) => {
        for (const row of rows) {
          if (!row.title) continue;
          insert.run(
            source.id,
            row.title,
            row.summary,
            row.url,
            row.publishDate,
            row.sourceType,
            row.businessDomain,
            row.enterpriseType,
            JSON.stringify(row.entities),
            JSON.stringify(row.features),
            row.rawContent || row.summary || ""
          );
        }
      });

      insertMany(processed);
      insightsCreated += processed.length;
      console.log(`[tracker] Source ${source.name}: created ${processed.length} insights`);
    } catch (e) {
      failedCount++;
      errors.push(`${source.name}: ${e.message}`);
      console.error(`[tracker] Failed to fetch ${source.name}:`, e.message);
    }
  }

  db.prepare(
    `UPDATE tracker_runs SET
      finished_at = CURRENT_TIMESTAMP,
      sources_success = ?,
      sources_failed = ?,
      insights_created = ?,
      status = ?,
      message = ?
     WHERE id = ?`
  ).run(
    successCount,
    failedCount,
    insightsCreated,
    failedCount > 0 ? "completed_with_errors" : "completed",
    errors.join("; ").slice(0, 2000),
    runId
  );

  console.log(`[tracker] Run ${runId} completed. Success: ${successCount}, Failed: ${failedCount}, Insights: ${insightsCreated}`);
}

export function startScheduler() {
  const cronExpression = process.env.TRACKER_CRON || "0 5 * * *";
  console.log(`[scheduler] Registered daily tracker at cron "${cronExpression}"`);
  cron.schedule(cronExpression, () => {
    console.log("[scheduler] Running scheduled tracker...");
    runTracker().catch(err => console.error("Scheduled tracker failed:", err));
  }, {
    timezone: process.env.TZ || "Asia/Shanghai"
  });
}
