import "dotenv/config";
import db from "../db.js";
import { processInsight, loadSemanticConfig } from "../services/llmProcessor.js";
import { loadActiveCategories } from "../services/businessCategories.js";

const BATCH_SIZE = 2;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processBatch(items, language) {
  const results = [];
  const categories = loadActiveCategories();
  const filterContext = {
    semanticPrompt: loadSemanticConfig(),
    categories,
    classificationEnabled: Boolean(process.env.LLM_API_KEY)
  };

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(item => processInsight(item, language, filterContext))
    );
    for (let j = 0; j < settled.length; j++) {
      const result = settled[j];
      if (result.status === "fulfilled") {
        result.value.id = items[i + j].id; // preserve id for update
        results.push(result.value);
      } else {
        console.error(`LLM failed for item ${i + j}:`, result.reason?.message || result.reason);
      }
    }
    if (i + BATCH_SIZE < items.length) await sleep(2000);
  }
  return results;
}

export async function reprocessAllInsights() {
  const rows = db.prepare("SELECT id, title, summary, url, publish_date FROM insights WHERE keywords = '[]' OR keywords IS NULL ORDER BY id DESC").all();
  console.log(`Reprocessing ${rows.length} insights...`);

  const items = rows.map(r => ({
    id: r.id,
    title: r.title,
    summary: (r.summary || "").slice(0, 800),
    url: r.url || "",
    publishDate: r.publish_date || new Date().toISOString()
  }));

  const processed = await processBatch(items, "zh");

  const update = db.prepare(
    `UPDATE insights SET title = ?, summary = ?, keywords = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  );

  let updated = 0;
  for (const item of processed) {
    if (!item.title || !item.id) continue;
    const keywords = item.keywords && item.keywords.length > 0 ? JSON.stringify(item.keywords) : "[]";
    update.run(item.title, item.summary || "", keywords, item.id);
    updated++;
  }

  console.log(`Updated ${updated} insights with LLM-generated content.`);
  return updated;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  reprocessAllInsights().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
