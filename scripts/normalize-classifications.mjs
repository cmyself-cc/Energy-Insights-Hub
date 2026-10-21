#!/usr/bin/env node
// 一次性分类归一脚本（2026-10-21 生产审计的修复落地）。幂等，可重复跑。
//
// 修复内容：
//   1. insights.categories 孤儿值归并 —— 同义/子域写法并入既有业务选项：
//      氢能/风电/风力发电 → 电力&氢能（tracker DOMAIN_KEYWORDS 本就如此归类），
//      CCUS → CCS，充电站 → 移动出行。化工保留（下方补录进 business_categories），
//      其他保留（无合适目标）。
//   2. insights.source_type 历史值「网站」→「新闻门户」（旧版 tracker 写入，现版
//      rss/website 均写新闻门户；前端筛选项 key 已对齐这两个值）。
//   3. business_categories 补录「化工」—— 它本就在 industry_categories 预筛层存在，
//      只是分类选项层缺失，导致 795 条化工洞察业务筛不出来。
//   4. 补刷 source_name 为空的行（能从 sources 表 join 到时）。
//
// 用法：
//   node scripts/normalize-classifications.mjs            # dry-run，只打印报告
//   node scripts/normalize-classifications.mjs --apply    # 真正写入
// 数据库位置由 DATA_DIR 环境变量决定（与 server/db.js 同口径），默认 ./data。
// 跑生产前先 docker cp 备份库文件。

import Database from "better-sqlite3";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CATEGORY_MERGE_MAP = {
  氢能: "电力&氢能",
  CCUS: "CCS",
  风电: "电力&氢能",
  风力发电: "电力&氢能",
  充电站: "移动出行",
};

export function mapCategories(categories) {
  const out = [];
  const seen = new Set();
  for (const c of categories) {
    const mapped = CATEGORY_MERGE_MAP[c] || c;
    if (!seen.has(mapped)) {
      seen.add(mapped);
      out.push(mapped);
    }
  }
  return out;
}

export const SOURCE_TYPE_RENAME = { 网站: "新闻门户" };

export function mapSourceType(sourceType) {
  return SOURCE_TYPE_RENAME[sourceType] || sourceType;
}

const CHEMICAL = {
  name: "化工",
  description:
    "石油化工、炼化一体化、基础化工原料、精细化工、化工新材料、乙烯/聚乙烯/聚丙烯等产业链动态。",
  inclusion_prompt:
    "资讯涉及石油化工、炼化项目、化工产品市场与价格、化工企业动态、化工新材料等，可归类为化工。",
};

function safeJson(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function ensureChemicalCategory(db, { apply = false } = {}) {
  const existing = db.prepare("SELECT id FROM business_categories WHERE name = ?").get(CHEMICAL.name);
  if (existing) return { inserted: false, id: existing.id };
  if (!apply) return { inserted: false, id: null, wouldInsert: true };
  const r = db
    .prepare(
      "INSERT INTO business_categories (name, description, inclusion_prompt, active) VALUES (?, ?, ?, 1)"
    )
    .run(CHEMICAL.name, CHEMICAL.description, CHEMICAL.inclusion_prompt);
  return { inserted: true, id: r.lastInsertRowid };
}

export function normalizeInsights(db, { apply = false } = {}) {
  const affected = Object.keys(CATEGORY_MERGE_MAP)
    .map((k) => `categories LIKE '%"${k}"%'`)
    .join(" OR ");
  const rows = db
    .prepare(`SELECT id, categories, source_type FROM insights WHERE (${affected}) OR source_type = '网站'`)
    .all();
  const stats = { categoryRows: 0, sourceTypeRows: 0, skippedJson: 0 };
  const updateCategory = db.prepare("UPDATE insights SET categories = ? WHERE id = ?");
  const updateSourceType = db.prepare("UPDATE insights SET source_type = ? WHERE id = ?");
  const run = apply ? (stmt, ...args) => stmt.run(...args) : () => {};
  for (const row of rows) {
    const cats = safeJson(row.categories);
    if (cats.length === 0 && row.categories) stats.skippedJson++;
    const mappedCats = mapCategories(cats);
    if (JSON.stringify(mappedCats) !== JSON.stringify(cats)) {
      stats.categoryRows++;
      run(updateCategory, JSON.stringify(mappedCats), row.id);
    }
    const mappedType = mapSourceType(row.source_type);
    if (mappedType !== row.source_type) {
      stats.sourceTypeRows++;
      run(updateSourceType, mappedType, row.id);
    }
  }
  return stats;
}

export function backfillSourceNames(db, { apply = false } = {}) {
  const missing = db
    .prepare(
      `SELECT COUNT(*) AS c FROM insights i
       WHERE (i.source_name IS NULL OR i.source_name = '')
         AND i.source_id IN (SELECT id FROM sources)`
    )
    .get().c;
  if (apply && missing > 0) {
    db.prepare(
      `UPDATE insights SET source_name = (SELECT name FROM sources WHERE sources.id = insights.source_id)
       WHERE (source_name IS NULL OR source_name = '')
         AND source_id IN (SELECT id FROM sources)`
    ).run();
  }
  return { backfilled: missing };
}

export function openDb(dataDir = process.env.DATA_DIR || "./data") {
  return new Database(path.join(dataDir, "energy_insights.db"));
}

function main() {
  const apply = process.argv.includes("--apply");
  const db = openDb();
  const chem = ensureChemicalCategory(db, { apply });
  const stats = normalizeInsights(db, { apply });
  const names = backfillSourceNames(db, { apply });
  console.log(`mode: ${apply ? "APPLY" : "dry-run"}`);
  console.log(`化工 category: ${chem.inserted ? "inserted" : chem.wouldInsert ? "would insert (dry-run)" : "already exists"} (id=${chem.id})`);
  console.log(`categories 归并行数: ${stats.categoryRows}（无法解析 JSON 跳过: ${stats.skippedJson}）`);
  console.log(`source_type 归并行数: ${stats.sourceTypeRows}（网站→新闻门户）`);
  console.log(`source_name 可回填行数: ${names.backfilled}`);
  db.close();
  if (!apply) console.log("\ndry-run 未写入。确认报告无误后加 --apply 重跑。");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
