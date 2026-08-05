import path from "path";
import { fileURLToPath } from "url";
import db from "../db.js";
import { stripBoilerplate, truncateAtSentence } from "../crawlers/utils.js";

// Rows whose summary is over the 200-char contract or still contains known
// page boilerplate (share toolbars, breadcrumbs, next-chapter nav, QR promos).
const GARBAGE_PATTERNS = [
  "%分享订阅%",
  "%分享 订阅%",
  "%首页>%",
  "%当前位置：%",
  "%阅读下一章%",
  "%查看更多>%",
  "%扫码手机查看%",
  "%长按识别二维码%"
];

export function repairSummaries() {
  const conditions = ["LENGTH(summary) > 200", ...GARBAGE_PATTERNS.map(() => "summary LIKE ?")];
  const rows = db
    .prepare(`SELECT id, summary FROM insights WHERE ${conditions.join(" OR ")} ORDER BY id`)
    .all(...GARBAGE_PATTERNS);

  console.log(`Found ${rows.length} insights with over-long or boilerplate summaries.`);

  const update = db.prepare(
    "UPDATE insights SET summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  );

  let repaired = 0;
  let skipped = 0;
  for (const row of rows) {
    const cleaned = truncateAtSentence(stripBoilerplate(row.summary), 200);
    if (!cleaned || cleaned === row.summary) {
      skipped++;
      console.log(`  skip id=${row.id}: nothing usable after cleaning (len=${(row.summary || "").length})`);
      continue;
    }
    update.run(cleaned, row.id);
    repaired++;
    console.log(`  fixed id=${row.id}: ${(row.summary || "").length} -> ${cleaned.length} chars`);
  }

  console.log(`Repaired ${repaired} summaries, skipped ${skipped}.`);
  return { repaired, skipped };
}

// fileURLToPath decodes percent-encoded spaces so the guard also works when
// the project path contains spaces (string compare against argv[1] does not).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    repairSummaries();
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
