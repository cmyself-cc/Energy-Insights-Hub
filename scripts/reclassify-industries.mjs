#!/usr/bin/env node
// 第二轮行业分类归一（2026-10-21，用户裁定：以「内容过滤 → 行业初筛」industry_categories
// 为最新权威口径）。幂等，dry-run 默认，--apply 写入。跑生产前先 docker cp 备份库。
//
//   1. business_categories（筛选下拉）对齐初筛清单：
//      新增 电力 / 氢能 / 新能源（描述与归类 prompt 取自初筛各自关键词，口径一致）；
//      停用 电力&氢能 / 光伏 / 项目 / 战略合作 / 收并购（初筛清单无它们；前三类是旧合一
//      标签或事件类型，不属于行业）。
//      注：油气 初筛清单同样没有，但存量 800+ 条且属核心业务，保留为活跃选项
//      （有意为之，与初筛清单的偏差仅此一项）。
//   2. insights.categories 重打标：
//      电力&氢能 → 按关键词优先级拆分 氢能＞储能＞新能源＞电力（兜底）；
//      光伏 → 新能源。
//      事件类（项目/战略合作/收并购）与主体类标签保留在数据上，仅退出筛选项。

import Database from "better-sqlite3";
import path from "node:path";
import { pathToFileURL } from "node:url";

// 拆分优先级即数组顺序：氢能最专，电力是兜底桶。
const SPLIT_RULES = [
  {
    target: "氢能",
    keywords: ["制氢", "氢燃料电池", "绿氢", "电解水", "氢储运", "加氢站", "氢内燃机", "灰氢", "蓝氢", "pem", "氢能"],
  },
  {
    target: "储能",
    keywords: ["储能", "电池", "抽水蓄能", "长时储能"],
  },
  {
    target: "新能源",
    keywords: ["光伏", "风电", "风力发电", "太阳能", "可再生能源", "清洁能源", "碳交易"],
  },
  {
    target: "电力",
    keywords: ["电力", "电网", "核电", "水电", "煤电", "电价", "电力市场", "智能电网", "虚拟电厂", "v2g", "火电", "供电", "发电"],
  },
];

const MONOLITH = "电力&氢能";
const RETIRED_OPTIONS = [MONOLITH, "光伏", "项目", "战略合作", "收并购"];

const NEW_OPTIONS = [
  {
    name: "电力",
    description: "发电（火/水/核/风）、电网建设与改造、电力市场与电价、智能电网、虚拟电厂等电力全产业链。",
    inclusion_prompt: "资讯涉及电力生产与供应、电网建设、电力市场交易与电价政策、智能电网、虚拟电厂等，可归类为电力。",
  },
  {
    name: "氢能",
    description: "制氢（绿氢/蓝氢/灰氢）、电解水制氢、氢燃料电池、氢储运、加氢站、氢内燃机等氢能全产业链。",
    inclusion_prompt: "资讯涉及制氢技术与项目、绿氢/蓝氢、氢燃料电池、氢储运、加氢站、氢能企业动态与政策等，可归类为氢能。",
  },
  {
    name: "新能源",
    description: "可再生能源与清洁能源：光伏发电、风力发电、可再生能源、清洁能源、碳交易等综合动态。",
    inclusion_prompt: "资讯涉及光伏、风电等可再生能源、清洁能源、碳交易市场等综合动态，可归类为新能源。",
  },
];

export function classifyEnergyMonolith(text) {
  const t = String(text || "").toLowerCase();
  for (const rule of SPLIT_RULES) {
    if (rule.keywords.some((k) => t.includes(k.toLowerCase()))) return rule.target;
  }
  return "电力";
}

export function mapToLatestCategories(categories, text) {
  const out = [];
  const seen = new Set();
  for (const c of categories) {
    let mapped = c;
    if (c === MONOLITH) mapped = classifyEnergyMonolith(text);
    else if (c === "光伏") mapped = "新能源";
    if (!seen.has(mapped)) {
      seen.add(mapped);
      out.push(mapped);
    }
  }
  return out;
}

function safeJson(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function ensureLatestBusinessCategories(db, { apply = false } = {}) {
  const actions = [];
  for (const opt of NEW_OPTIONS) {
    const existing = db.prepare("SELECT id, active FROM business_categories WHERE name = ?").get(opt.name);
    if (existing) {
      if (!existing.active) {
        actions.push(`${opt.name}: would reactivate (id=${existing.id})`);
        if (apply) db.prepare("UPDATE business_categories SET active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(existing.id);
      } else {
        actions.push(`${opt.name}: already active (id=${existing.id})`);
      }
    } else {
      actions.push(`${opt.name}: would insert`);
      if (apply) {
        db.prepare(
          "INSERT INTO business_categories (name, description, inclusion_prompt, active) VALUES (?, ?, ?, 1)"
        ).run(opt.name, opt.description, opt.inclusion_prompt);
      }
    }
  }
  for (const name of RETIRED_OPTIONS) {
    const existing = db.prepare("SELECT id, active FROM business_categories WHERE name = ?").get(name);
    if (existing && existing.active) {
      actions.push(`${name}: would deactivate (id=${existing.id})`);
      if (apply) db.prepare("UPDATE business_categories SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(existing.id);
    }
  }
  return actions;
}

export function reclassifyIndustries(db, { apply = false } = {}) {
  const rows = db.prepare(
    `SELECT id, title, summary, keywords, features, categories FROM insights
     WHERE categories LIKE '%"${MONOLITH}"%' OR categories LIKE '%"光伏"%'`
  ).all();
  const update = db.prepare("UPDATE insights SET categories = ? WHERE id = ?");
  const stats = { rows: 0, splitTargets: {}, 光伏并入新能源: 0, skippedJson: 0 };
  for (const row of rows) {
    const cats = safeJson(row.categories);
    if (cats.length === 0 && row.categories) {
      stats.skippedJson++;
      continue;
    }
    const text = [row.title, row.summary, ...safeJson(row.keywords), ...safeJson(row.features)].join(" ");
    const hadMonolith = cats.includes(MONOLITH);
    const hadPv = cats.includes("光伏");
    const mapped = mapToLatestCategories(cats, text);
    if (JSON.stringify(mapped) === JSON.stringify(cats)) continue;
    stats.rows++;
    if (hadMonolith) {
      const target = mapped.find((c) => ["氢能", "储能", "新能源", "电力"].includes(c) && !cats.includes(c)) || "电力";
      stats.splitTargets[target] = (stats.splitTargets[target] || 0) + 1;
    }
    if (hadPv && mapped.includes("新能源")) stats["光伏并入新能源"]++;
    if (apply) update.run(JSON.stringify(mapped), row.id);
  }
  return stats;
}

export function openDb(dataDir = process.env.DATA_DIR || "./data") {
  return new Database(path.join(dataDir, "energy_insights.db"));
}

function main() {
  const apply = process.argv.includes("--apply");
  const db = openDb();
  const actions = ensureLatestBusinessCategories(db, { apply });
  const stats = reclassifyIndustries(db, { apply });
  console.log(`mode: ${apply ? "APPLY" : "dry-run"}`);
  console.log("options:", actions.join(" | "));
  console.log(`reclassified rows: ${stats.rows}（JSON 解析跳过: ${stats.skippedJson}）`);
  console.log(`电力&氢能 拆分去向: ${JSON.stringify(stats.splitTargets)}`);
  console.log(`光伏并入新能源行数: ${stats["光伏并入新能源"]}`);
  db.close();
  if (!apply) console.log("\ndry-run 未写入。确认报告无误后加 --apply 重跑。");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
