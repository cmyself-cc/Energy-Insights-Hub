import cron from "node-cron";
import db from "../db.js";
import { fetchArticles } from "../crawlers/index.js";
import { processInsight, loadSemanticConfig } from "./llmProcessor.js";
import { loadActiveCategories, matchesEnabledCategory } from "./businessCategories.js";
import { loadFilterRules, groupRulesByPurpose } from "./filterRules.js";
import { loadSettings } from "../lib/trackerSettings.js";
import { applyPreFilter, applyPostFilter } from "./trackerRules.js";
import { applyKeywordGate, applyIndustryFilter } from "./keywordGate.js";
import { deduplicateItems } from "./dedup.js";
import { applyUserFeedbackScore, loadSemanticWeights } from "./feedbackWeights.js";

const BATCH_SIZE = 2; // 并发数，避免触发频率限制
const LANGUAGE = process.env.DEFAULT_LANGUAGE || "zh";

function setPhase(runId, phase, progress) {
  if (!runId) return;
  db.prepare("UPDATE tracker_runs SET phase = ?, phase_progress = ? WHERE id = ?")
    .run(phase, progress, runId);
}

let isTrackerRunning = false;

function hasRunningTrackerInDb() {
  // Only consider runs started within the last hour; older 'running' rows are stale
  // from previous crashes and should not block new runs.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const row = db
    .prepare("SELECT id FROM tracker_runs WHERE status = 'running' AND started_at >= ? LIMIT 1")
    .get(oneHourAgo);
  return !!row;
}

const SOURCE_TYPE_MAP = {
  rss: "新闻门户",
  website: "新闻门户",
  wechat_mcp: "微信公众号",
  wechat_album: "微信公众号"
};

const DOMAIN_KEYWORDS = {
  "电力&氢能": ["电力", "电网", "储能", "氢能", "电池", "充电", "光伏", "风电", "核电", "水电", "煤电", "电价", "电力市场", "智能电网", "虚拟电厂"],
  "化工": ["化工", "石化", "石油", "炼化", "乙烯", "聚乙烯", "聚丙烯", "乙烷裂解", "石脑油"],
  "生物燃料": ["生物燃料", "生物柴油", "SAF", "绿色甲醇", "生物乙醇", "可持续航空燃油"],
  "LNG/天然气": ["LNG", "天然气", "液化天然气", "接收站", "长协", "煤改气"],
  "CCS": ["CCS", "CCUS", "碳捕捉", "碳封存", "碳捕集", "二氧化碳"],
  "移动出行": ["充电桩", "充电站", "加油站", "便利店", "电动汽车", "新能源车", "物流", "货运"],
  "润滑油": ["润滑油", "基础油", "添加剂", "冷却液", "制动液", "齿轮油"],
  "战略合作": ["合作", "签约", "战略", "联盟", "合资", "联合"],
  "收并购": ["收购", "并购", "重组", "股权", "投资", "合资", "兼并"]
};

const ENTERPRISE_KEYWORDS = {
  "国有企业": ["中石油", "中石化", "中海油", "国家电网", "南方电网", "国家能源", "华能", "大唐", "华电", "国电投", "三峡", "中广核", "中核", "中国能建", "中国电建", "中国石油", "中国石化"],
  "民营企业": ["宁德时代", "比亚迪", "蔚来", "小鹏", "理想", "隆基", "通威", "阳光电源", "亿纬锂能", "远景", "金风科技"]
};

const BUSINESS_CATEGORIES = [
  "电力&氢能", "储能", "光伏", "油气", "CCS", "化工", "LNG/天然气", "移动出行", "润滑油", "生物燃料"
];

function deriveFields(item, source) {
  const keywords = item.keywords || [];
  const text = `${item.title || ""} ${item.summary || ""} ${keywords.join(" ")}`.toLowerCase();

  // Derive sourceType from source type
  const sourceType = SOURCE_TYPE_MAP[source?.type] || "新闻门户";

  // LLM-provided categories take precedence
  let categories = Array.isArray(item.categories) ? item.categories : [];

  // Fallback: derive categories from keywords if LLM did not return any
  if (categories.length === 0) {
    for (const [domain, domainKeywords] of Object.entries(DOMAIN_KEYWORDS)) {
      if (domainKeywords.some(k => text.includes(k.toLowerCase()))) {
        categories.push(domain);
      }
    }
  }

  // Derive businessDomain from the first business category
  let businessDomain = "能源转型";
  for (const c of categories) {
    if (BUSINESS_CATEGORIES.includes(c)) {
      businessDomain = c;
      break;
    }
  }
  if (businessDomain === "能源转型") {
    for (const [domain, domainKeywords] of Object.entries(DOMAIN_KEYWORDS)) {
      if (domainKeywords.some(k => text.includes(k.toLowerCase()))) {
        businessDomain = domain;
        break;
      }
    }
  }

  // Derive enterpriseType from keywords
  let enterpriseType = "";
  for (const [type, typeKeywords] of Object.entries(ENTERPRISE_KEYWORDS)) {
    if (typeKeywords.some(k => text.includes(k.toLowerCase()))) {
      enterpriseType = type;
      break;
    }
  }

  // Derive entities from keywords (first 2-3)
  const entities = keywords.slice(0, 3);

  // Derive features from keywords (first 1-2)
  const features = keywords.slice(0, 2);

  return {
    sourceType,
    businessDomain,
    enterpriseType,
    entities,
    features,
    categories
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchSourceItems(source) {
  return fetchArticles(source);
}

async function processBatch(items, language, filterContext = null) {
  const results = [];
  const ctx = filterContext || {
    semanticPrompt: loadSemanticConfig(),
    categories: loadActiveCategories(),
    classificationEnabled: Boolean(process.env.LLM_API_KEY)
  };
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(item => processInsight(item, language, ctx))
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
    if (i + BATCH_SIZE < items.length) await sleep(2000);
  }
  return results;
}

export async function runTracker(runId = null) {
  if (isTrackerRunning || hasRunningTrackerInDb()) {
    console.log("[tracker] Another tracker run is already in progress. Skipping.");
    if (runId) {
      db.prepare(
        `UPDATE tracker_runs SET
          status = 'completed',
          finished_at = CURRENT_TIMESTAMP,
          message = ?
         WHERE id = ?`
      ).run("Skipped: another tracker run is already in progress.", runId);
    }
    return;
  }

  isTrackerRunning = true;
  try {
    const settings = loadSettings();
    const allRules = loadFilterRules();
    const groupedRules = groupRulesByPurpose(allRules);
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

  const classificationEnabled = Boolean(process.env.LLM_API_KEY);

  let successCount = 0;
  let failedCount = 0;
  let insightsCreated = 0;
  const errors = [];

  // =====================================================================
  // Phase 1: Fetching (0-40%)
  // =====================================================================
  setPhase(runId, "fetching", 0);

  const allCollected = [];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];

    // Check stop flag before each source
    const stopReq = db.prepare("SELECT stop_requested FROM tracker_runs WHERE id = ?").get(runId);
    if (stopReq && stopReq.stop_requested) {
      console.log("[tracker] Stop requested during fetching phase");
      break;
    }

    try {
      console.log(`[tracker] Fetching source: ${source.name}`);
      const items = await fetchSourceItems(source);

      // Per-item DB dedup
      let newCount = 0;
      for (const item of items) {
        if (!item.title) continue;
        const existing = db.prepare(
          "SELECT id FROM insights WHERE url = ? OR title = ?"
        ).get(item.url || "", item.title);
        if (!existing) {
          allCollected.push({ ...item, sourceId: source.id, source });
          newCount++;
        }
      }

      console.log(`[tracker] Source ${source.name}: fetched ${items.length}, new ${newCount}`);
      successCount++;
    } catch (e) {
      failedCount++;
      errors.push(`${source.name}: ${e.message}`);
      console.error(`[tracker] Failed to fetch ${source.name}:`, e.message);
    }

    // Progress: 0% → 40% as sources complete
    const progress = Math.round(((i + 1) / sources.length) * 40);
    setPhase(runId, "fetching", progress);

    db.prepare(
      `UPDATE tracker_runs SET sources_success = ?, sources_failed = ?, insights_created = ?, message = ? WHERE id = ?`
    ).run(successCount, failedCount, insightsCreated, errors.join("; ").slice(0, 2000), runId);
  }

  console.log(`[tracker] Phase 1 complete: ${allCollected.length} items collected`);

  // Industry filter on combined pool
  let candidates = allCollected;
  const industryKeywords = settings.requiredIndustryKeywords;
  if (industryKeywords && industryKeywords.length > 0) {
    candidates = applyIndustryFilter(allCollected, industryKeywords);
    console.log(`[tracker] After industry filter: ${candidates.length} items`);
  }

  // =====================================================================
  // Phase 2: Filtering (40-60%)
  // =====================================================================
  if (candidates.length > 0) {
    // Check stop flag before filtering phase
    const stopReq = db.prepare("SELECT stop_requested FROM tracker_runs WHERE id = ?").get(runId);
    if (stopReq && stopReq.stop_requested) {
      console.log("[tracker] Stop requested before filtering phase");
      candidates = [];
    }
  }

  if (candidates.length > 0) {
    setPhase(runId, "filtering", 50);

    // Group items by source's purpose combination for per-source purpose rules
    const purposeGroups = new Map();
    for (const item of candidates) {
      const src = item.source;
      const purposes = (src.purpose || "").split(",").map(s => s.trim()).filter(Boolean);
      const key = purposes.sort().join(",") || "__none__";
      if (!purposeGroups.has(key)) {
        purposeGroups.set(key, { purposes, items: [] });
      }
      purposeGroups.get(key).items.push(item);
    }

    const gated = [];
    for (const [key, group] of purposeGroups) {
      let groupRules;
      if (group.purposes.length === 0) {
        // Untagged source: gate with ALL rules (backward compatible)
        groupRules = groupedRules;
      } else {
        groupRules = {};
        for (const p of group.purposes) {
          if (groupedRules[p]) groupRules[p] = groupedRules[p];
        }
        if (Object.keys(groupRules).length === 0) {
          console.log(`[tracker] Skipping ${group.items.length} items from purpose(s) ${group.purposes.join(", ")}: no active rules`);
          continue;
        }
      }

      const gate = applyKeywordGate(group.items, {
        excludeKeywords: settings.excludeKeywords,
        purposeRules: groupRules
      });
      console.log(`[tracker] Purpose group "${key}": ${gate.kept.length} kept, ${gate.excluded} excluded`);
      gated.push(...gate.kept);
    }

    console.log(`[tracker] After keyword gate: ${gated.length} items`);

    // Dedup across all items
    const deduped = deduplicateItems(gated, {
      threshold: settings.fuzzyDeduplicationThreshold,
      lookbackDays: Math.max(1, Math.ceil(settings.lookbackHours / 24) + 1)
    });
    console.log(`[tracker] After dedup: ${deduped.length} items`);

    // Pre-filter
    candidates = applyPreFilter(deduped, settings);
    console.log(`[tracker] After pre-filter: ${candidates.length} candidates`);

    setPhase(runId, "filtering", 60);
  }

  // =====================================================================
  // Phase 3: Processing (60-90%)
  // =====================================================================
  if (candidates.length > 0) {
    // Check stop flag before processing phase
    const stopReq = db.prepare("SELECT stop_requested FROM tracker_runs WHERE id = ?").get(runId);
    if (stopReq && stopReq.stop_requested) {
      console.log("[tracker] Stop requested before processing phase");
      candidates = [];
    }
  }

  let allProcessed = [];

  if (candidates.length > 0) {
    const filterContext = {
      semanticPrompt: loadSemanticConfig(),
      categories: loadActiveCategories(),
      classificationEnabled: Boolean(process.env.LLM_API_KEY)
    };

    setPhase(runId, "processing", 60);

    // Process in batches with per-batch stop check and progress tracking
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      // Check stop flag between LLM batches
      const stopReq = db.prepare("SELECT stop_requested FROM tracker_runs WHERE id = ?").get(runId);
      if (stopReq && stopReq.stop_requested) {
        console.log("[tracker] Stop requested during LLM processing");
        break;
      }

      const batch = candidates.slice(i, i + BATCH_SIZE);
      const settled = await Promise.allSettled(
        batch.map(item => processInsight(item, LANGUAGE, filterContext))
      );
      for (let j = 0; j < settled.length; j++) {
        const result = settled[j];
        if (result.status === "fulfilled") {
          allProcessed.push(result.value);
        } else {
          console.error(`[tracker] processInsight failed for batch item ${i + j}:`, result.reason?.message || result.reason);
        }
      }

      if (allProcessed.length === 0 && batch.length > 0 && candidates.length > 0) {
        throw new Error(`All ${batch.length} articles in first batch failed LLM processing`);
      }

      // Progress: 60 + (processed / total * 30)
      const progress = Math.min(90, 60 + Math.round((allProcessed.length / candidates.length) * 30));
      setPhase(runId, "processing", progress);

      if (i + BATCH_SIZE < candidates.length) await sleep(2000);
    }
    console.log(`[tracker] LLM processing complete: ${allProcessed.length} items processed`);
  }

  // =====================================================================
  // Phase 4: Storing (90-100%)
  // =====================================================================
  if (allProcessed.length > 0) {
    setPhase(runId, "storing", 90);

    // Derive fields for all processed items
    for (const row of allProcessed) {
      // Prefer LLM-decided purposes; fall back to keyword-gate purposes if LLM returned none
      const llmPurposes = Array.isArray(row.purposes) ? row.purposes : [];
      row.matchedPurposes = llmPurposes.length > 0 ? llmPurposes : (row.matchedPurposes || ["competitor"]);
      const derived = deriveFields(row, row.source);
      Object.assign(row, derived);
    }

    setPhase(runId, "storing", 95);

    // Post-filter
    let kept = applyPostFilter(allProcessed, settings)
      .filter(insight => insight.title && insight.title.trim() !== "")
      .filter(insight => {
        if (!classificationEnabled) return true;
        if (insight.llmFailed) return false; // Filter out LLM-failed articles
        if (!insight.matchedPurposes || insight.matchedPurposes.length === 0) return false; // LLM did not assign a purpose
        if (insight.chinaRelevance === false) return false; // Drop non-China content
        return matchesEnabledCategory(insight, activeCategories);
      });
    console.log(`[tracker] After post-filter: ${kept.length} insights`);

    // Semantic weights
    const semanticWeights = loadSemanticWeights();
    const hasWeights = semanticWeights.boost.length > 0 || semanticWeights.suppress.length > 0;
    if (hasWeights) {
      const scored = applyUserFeedbackScore(kept, { weights: semanticWeights });
      console.log(`[tracker] ${scored.dropped.length} dropped by feedback weights, ${scored.kept.length} kept`);
      kept = scored.kept;
    }

    // Insert all at once
    if (kept.length > 0) {
      const insert = db.prepare(
        `INSERT INTO insights (
          source_id, title, summary, url, publish_date, source_type, source_name,
          business_domain, enterprise_type, entities, features, raw_content, categories, purpose, keywords
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertMany = db.transaction((rows) => {
        for (const row of rows) {
          if (!row.title) continue;
          insert.run(
            row.sourceId, row.title, row.summary, row.url, row.publishDate,
            row.sourceType, row.source?.name || null,
            row.businessDomain, row.enterpriseType,
            JSON.stringify(row.entities), JSON.stringify(row.features),
            row.rawContent || row.summary || "",
            row.categories ? JSON.stringify(row.categories) : null,
            row.matchedPurposes ? JSON.stringify(row.matchedPurposes) : JSON.stringify(["competitor"]),
            JSON.stringify(row.keywords || [])
          );
        }
      });
      insertMany(kept);
      insightsCreated += kept.length;
      console.log(`[tracker] Created ${kept.length} insights`);
    }

    setPhase(runId, "storing", 100);
  }

  // Final progress update
  db.prepare(
    `UPDATE tracker_runs SET
      sources_success = ?,
      sources_failed = ?,
      insights_created = ?,
      message = ?
     WHERE id = ?`
  ).run(successCount, failedCount, insightsCreated, errors.join("; ").slice(0, 2000), runId);

  // Check if stopped
  const stopReq = db.prepare("SELECT stop_requested FROM tracker_runs WHERE id = ?").get(runId);
  const stopped = stopReq && stopReq.stop_requested;

  setPhase(runId, "", 100);

  let finalStatus;
  let finalMessage;
  if (stopped) {
    finalStatus = "completed_with_errors";
    finalMessage = "Stopped by user" + (errors.length > 0 ? "; " + errors.join("; ").slice(0, 1990) : "");
  } else {
    finalStatus = failedCount > 0 ? "completed_with_errors" : "completed";
    finalMessage = errors.join("; ").slice(0, 2000);
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
    finalStatus,
    finalMessage,
    runId
  );

  console.log(`[tracker] Run ${runId} ${stopped ? "stopped" : "completed"}. Success: ${successCount}, Failed: ${failedCount}, Insights: ${insightsCreated}`);
  } finally {
    isTrackerRunning = false;
  }
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
