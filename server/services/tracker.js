import cron from "node-cron";
import db from "../db.js";
import { fetchArticles } from "../crawlers/index.js";
import { processInsight, loadSemanticConfig } from "./llmProcessor.js";
import { loadActiveCategories, matchesEnabledCategory } from "./businessCategories.js";
import { loadFilterRules, applyKeywordFilters } from "./filterRules.js";
import { loadSettings } from "../lib/trackerSettings.js";
import { applyPreFilter, applyPostFilter } from "./trackerRules.js";

const BATCH_SIZE = 5; // 并发数，避免触发频率限制
const LANGUAGE = process.env.DEFAULT_LANGUAGE || "zh";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchSourceItems(source) {
  return fetchArticles(source);
}

async function processBatch(items, language) {
  const results = [];
  const filterContext = {
    semanticPrompt: loadSemanticConfig(),
    categories: loadActiveCategories()
  };
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(item => processInsight(item, language, filterContext))
    );
    for (let j = 0; j < settled.length; j++) {
      const result = settled[j];
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        console.error(`[tracker] processInsight failed for batch item ${i + j}:`, result.reason?.message || result.reason);
      }
    }
    if (results.length === 0 && batch.length > 0) {
      throw new Error(`All ${batch.length} articles in batch failed LLM processing`);
    }
    if (i + BATCH_SIZE < items.length) await sleep(1000);
  }
  return results;
}

export async function runTracker(runId = null) {
  const settings = loadSettings();
  const filterRules = loadFilterRules();
  const activeCategories = loadActiveCategories();

  const sources = db.prepare("SELECT * FROM sources WHERE active = 1").all();
  if (sources.length === 0) {
    console.log("[tracker] No active sources to track.");
    if (runId) {
      db.prepare(
        `UPDATE tracker_runs SET
          status = 'completed',
          finished_at = CURRENT_TIMESTAMP,
          message = ?
         WHERE id = ?`
      ).run("No active sources to track.", runId);
    }
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

      // 去重：按 url 或 title
      const newItems = [];
      for (const item of items) {
        if (!item.title) continue;
        const existing = db.prepare(
          "SELECT id FROM insights WHERE url = ? OR title = ?"
        ).get(item.url || "", item.title);
        if (!existing) newItems.push(item);
      }

      if (newItems.length > 0) {
        const keywordFiltered = applyKeywordFilters(newItems, filterRules);
        if (keywordFiltered.length === 0) {
          console.log(`[tracker] Source ${source.name}: no items after keyword filters`);
          successCount++;
          db.prepare(
            `UPDATE tracker_runs SET
              sources_success = ?,
              sources_failed = ?,
              insights_created = ?,
              message = ?
             WHERE id = ?`
          ).run(successCount, failedCount, insightsCreated, errors.join("; ").slice(0, 2000), runId);
          continue;
        }
        const taggedItems = keywordFiltered.map(item => ({ ...item, sourceId: source.id }));
        const candidates = applyPreFilter(taggedItems, settings);
        if (candidates.length > 0) {
          const processed = await processBatch(candidates, LANGUAGE);
          const kept = applyPostFilter(processed, settings)
            .filter(insight => insight.title && insight.title.trim() !== "")
            .filter(insight => matchesEnabledCategory(insight, activeCategories));
          if (kept.length > 0) {
            const insert = db.prepare(
              `INSERT INTO insights (
                source_id, title, summary, url, publish_date, source_type,
                business_domain, enterprise_type, entities, features, raw_content, categories
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
                  row.rawContent || row.summary || "",
                  JSON.stringify(row.categories)
                );
              }
            });

            insertMany(kept);
            insightsCreated += kept.length;
            console.log(`[tracker] Source ${source.name}: created ${kept.length} insights`);
          } else {
            console.log(`[tracker] Source ${source.name}: no insights after post-filter`);
          }
        } else {
          console.log(`[tracker] Source ${source.name}: no candidates after pre-filter`);
        }
      }

      successCount++;

      // 每处理完一个来源就更新一次进度
      db.prepare(
        `UPDATE tracker_runs SET
          sources_success = ?,
          sources_failed = ?,
          insights_created = ?,
          message = ?
         WHERE id = ?`
      ).run(successCount, failedCount, insightsCreated, errors.join("; ").slice(0, 2000), runId);
    } catch (e) {
      failedCount++;
      errors.push(`${source.name}: ${e.message}`);
      console.error(`[tracker] Failed to fetch ${source.name}:`, e.message);

      // 失败的来源也立即更新进度
      db.prepare(
        `UPDATE tracker_runs SET
          sources_success = ?,
          sources_failed = ?,
          insights_created = ?,
          message = ?
         WHERE id = ?`
      ).run(successCount, failedCount, insightsCreated, errors.join("; ").slice(0, 2000), runId);
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
