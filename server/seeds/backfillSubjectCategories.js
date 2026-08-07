import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import db from "../db.js";
import { callLlmJson } from "../lib/llmClient.js";

// 一次性数据回填：把 insights 旧的事件分类（战略合作/收并购/项目）
// 替换为按主体性质划分的主体分类（政府/国有企业/外国公司/私营企业/研究机构）。
export const SUBJECT_CATEGORIES = ["政府", "国有企业", "外国公司", "私营企业", "研究机构"];
export const LEGACY_EVENT_CATEGORIES = ["战略合作", "收并购", "项目"];

const BATCH_SIZE = 20;

export function applySubjectCategory(categories, subject) {
  const cleaned = (Array.isArray(categories) ? categories : [])
    .filter(c => !LEGACY_EVENT_CATEGORIES.includes(c));
  if (SUBJECT_CATEGORIES.includes(subject) && !cleaned.includes(subject)) {
    cleaned.push(subject);
  }
  return cleaned;
}

export function parseClassifications(parsed, validIds) {
  const map = new Map();
  const list = Array.isArray(parsed) ? parsed : [];
  for (const entry of list) {
    const id = Number(entry?.id);
    if (!validIds.has(id)) continue;
    map.set(id, SUBJECT_CATEGORIES.includes(entry?.subject) ? entry.subject : "");
  }
  return map;
}

function buildPrompt(batch) {
  const lines = batch.map(r => `${r.id}. ${r.title} | ${(r.summary || "").slice(0, 100)}`).join("\n");
  return `请判断以下每条新闻资讯的核心事件主体属于哪种主体类型。只能从这几种中选择：政府、国有企业、外国公司、私营企业、研究机构。
判断依据：政策发布方/监管机构/政府部门→政府；央企/地方国企→国有企业；外资企业或跨国公司→外国公司；民营/私营企业→私营企业；高校/科研院所→研究机构。
如果新闻没有明确主体或无法判断主体性质，subject 返回空字符串。

新闻列表（格式：id. 标题 | 摘要）：
${lines}

返回 ONLY a valid JSON array: [{"id": number, "subject": string}]`;
}

export async function backfillSubjectCategories() {
  const rows = db.prepare("SELECT id, title, summary, categories FROM insights").all();
  let updated = 0;
  const update = db.prepare("UPDATE insights SET categories = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const validIds = new Set(batch.map(r => r.id));
    let map = new Map();
    try {
      const parsed = await callLlmJson([{ role: "user", content: buildPrompt(batch) }], { maxTokens: 4000 });
      map = parseClassifications(parsed, validIds);
    } catch (e) {
      console.error(`[backfill-subject] batch starting at ${i} LLM failed:`, e.message);
    }
    for (const row of batch) {
      let current = [];
      try { current = JSON.parse(row.categories || "[]"); } catch { /* keep empty */ }
      const next = applySubjectCategory(current, map.get(row.id) || "");
      if (JSON.stringify(next) !== JSON.stringify(current)) {
        update.run(JSON.stringify(next), row.id);
        updated += 1;
      }
    }
  }
  return { processed: rows.length, updated };
}

// Run standalone: node server/seeds/backfillSubjectCategories.js
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  backfillSubjectCategories()
    .then(stats => console.log(JSON.stringify(stats)))
    .catch(e => { console.error(e); process.exit(1); });
}
