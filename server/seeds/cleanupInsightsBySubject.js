import path from "path";
import { fileURLToPath } from "url";
import db from "../db.js";
import {
  collectSubjectKeywordsByPurpose,
  titleContainsSubjectKeyword,
  PURPOSES
} from "../services/filterRules.js";

// 一次性存量清理：按主体关键词新标准清理 insights。
// 规则与 tracker 新管线一致：
// 1) 标题不含任何一类主体关键词（公司/政策/技术/行业）→ 删除；
// 2) purposes 仅保留标题命中对应类别主体词的类型；交集为空但标题命中
//    某些类别时，按标题命中的类别重建（与「对应关系」规则一致）。
export function evaluateInsight(title, purposes, byPurpose) {
  const titleCategories = PURPOSES.filter(p => titleContainsSubjectKeyword(title, byPurpose[p]));
  if (titleCategories.length === 0) return { action: "drop" };
  const assigned = (Array.isArray(purposes) ? purposes : []).filter(p => PURPOSES.includes(p));
  // 存量卡片的既有 purpose 多出自旧规则（不可信），直接按标题命中的主体词
  // 类别重建，优先级 competitor > policy > tech > industry（PURPOSES 顺序）：
  // 标题含公司主体→竞争动态；含政策发布主体→政策事件；其余类推。
  const newPurposes = [titleCategories[0]];
  const changed = JSON.stringify(newPurposes) !== JSON.stringify(assigned);
  return { action: "keep", purposes: newPurposes, changed };
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

export function runCleanup({ dryRun = false } = {}) {
  const byPurpose = collectSubjectKeywordsByPurpose();
  const keywordStats = Object.fromEntries(Object.entries(byPurpose).map(([k, v]) => [k, v.length]));
  const rows = db.prepare("SELECT id, title, purpose FROM insights").all();

  const dropIds = [];
  const updates = []; // { id, purposes }
  const droppedSamples = [];

  for (const row of rows) {
    const result = evaluateInsight(row.title, safeJson(row.purpose), byPurpose);
    if (result.action === "drop") {
      dropIds.push(row.id);
      if (droppedSamples.length < 10) droppedSamples.push(row.title);
    } else if (result.changed) {
      updates.push({ id: row.id, purposes: result.purposes });
    }
  }

  if (!dryRun) {
    const del = db.prepare("DELETE FROM insights WHERE id = ?");
    const upd = db.prepare("UPDATE insights SET purpose = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
    const apply = db.transaction(() => {
      for (const id of dropIds) del.run(id);
      for (const u of updates) upd.run(JSON.stringify(u.purposes), u.id);
    });
    apply();
  }

  return {
    dryRun,
    keywordStats,
    total: rows.length,
    dropped: dropIds.length,
    purposesUpdated: updates.length,
    unchanged: rows.length - dropIds.length - updates.length,
    droppedSamples
  };
}

// Run standalone: node server/seeds/cleanupInsightsBySubject.js [--dry-run]
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dryRun = process.argv.includes("--dry-run");
  const report = runCleanup({ dryRun });
  console.log(`模式: ${dryRun ? "dry-run（不写库）" : "实际执行"}`);
  console.log("主体词库:", report.keywordStats);
  console.log(`存量卡片: ${report.total}`);
  console.log(`删除（标题无任何主体关键词）: ${report.dropped}`);
  console.log(`purposes 调整: ${report.purposesUpdated}`);
  console.log(`保持不变: ${report.unchanged}`);
  if (report.droppedSamples.length > 0) {
    console.log("删除示例:");
    for (const t of report.droppedSamples) console.log("  -", t);
  }
}
