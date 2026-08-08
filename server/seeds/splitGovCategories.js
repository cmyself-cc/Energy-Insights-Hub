import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import db from "../db.js";
import { callLlmJson } from "../lib/llmClient.js";

// 一次性回填：主体分类拆分，把旧的「政府」用 LLM 细分为
// 「中央部委」或「地方政府」。仅处理 categories 仍含「政府」的卡片，幂等。
export const GOV_SUB_CATEGORIES = ["中央部委", "地方政府"];

const BATCH_SIZE = 20;

export function applyGovSplit(categories, sub) {
  const list = Array.isArray(categories) ? categories : [];
  if (!list.includes("政府")) return list;
  if (!GOV_SUB_CATEGORIES.includes(sub)) return list; // 无法判断则保留原样
  return list.map(c => (c === "政府" ? sub : c));
}

function buildPrompt(batch) {
  const lines = batch.map(r => `${r.id}. ${r.title} | ${(r.summary || "").slice(0, 100)}`).join("\n");
  return `请判断以下每条新闻的核心事件主体属于哪一级政府。只能从这两种中选择：中央部委、地方政府。
判断依据：国务院及其组成部门/直属机构/国家局（如国家发改委、国家能源局、财政部、生态环境部、工信部等）→中央部委；省/市/县级政府及其部门（如某省政府、某市发改委、上海市政府等）→地方政府。
若新闻主体不是政府或无法判断级别，subject 返回空字符串。

新闻列表（格式：id. 标题 | 摘要）：
${lines}

返回 ONLY a valid JSON array: [{"id": number, "subject": string}]`;
}

export async function splitGovCategories() {
  // 精确匹配旧标签元素 "政府"（避免误匹配 中央部委/地方政府 中的子串）
  const rows = db.prepare(`SELECT id, title, summary, categories FROM insights WHERE categories LIKE '%"政府"%'`).all();
  let updated = 0;
  let unresolved = 0;
  const update = db.prepare("UPDATE insights SET categories = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const validIds = new Set(batch.map(r => r.id));
    const map = new Map();
    try {
      const parsed = await callLlmJson([{ role: "user", content: buildPrompt(batch) }], { maxTokens: 4000 });
      for (const entry of Array.isArray(parsed) ? parsed : []) {
        const id = Number(entry?.id);
        if (validIds.has(id) && GOV_SUB_CATEGORIES.includes(entry?.subject)) {
          map.set(id, entry.subject);
        }
      }
    } catch (e) {
      console.error(`[split-gov] batch starting at ${i} LLM failed:`, e.message);
    }
    for (const row of batch) {
      let current = [];
      try { current = JSON.parse(row.categories || "[]"); } catch { /* keep as-is */ }
      const sub = map.get(row.id);
      if (!sub) { unresolved += 1; continue; }
      const next = applyGovSplit(current, sub);
      if (JSON.stringify(next) !== JSON.stringify(current)) {
        update.run(JSON.stringify(next), row.id);
        updated += 1;
      }
    }
  }
  return { processed: rows.length, updated, unresolved };
}

// Run standalone: node server/seeds/splitGovCategories.js
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  splitGovCategories()
    .then(stats => console.log(JSON.stringify(stats)))
    .catch(e => { console.error(e); process.exit(1); });
}
