// One-off restore (2026-08-05): merge rows from the two local SQLite backups
// back into data/energy_insights.db after the test-cleanup wipe incident.
//
// Policy: INSERT-only (INSERT OR IGNORE with explicit ids). This script never
// deletes or overwrites existing rows — post-wipe rows such as source id 318
// (bjx) and filter_rule id 1268 are preserved. The only non-INSERT statement
// is the sqlite_sequence realignment required for AUTOINCREMENT consistency.
import Database from "better-sqlite3";

const TARGET = "data/energy_insights.db";
const BACKUPS = [
  { alias: "br", file: "data/energy_insights.db.before-restore-20260802-104127", label: "before-restore 08-02 10:41" },
  { alias: "t13", file: "data/energy_insights.db.bak-task13", label: "bak-task13 07-19" },
];
// Parents first so child rows never reference missing parents.
const TABLES = [
  "sources",
  "insights",
  "filter_rules",
  "business_categories",
  "industry_categories",
  "filter_config",
  "tracker_runs",
  "user_feedback",
  "feedback_semantic_weights",
  "source_imports",
  "tracker_settings",
];

const db = new Database(TARGET);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

const count = (table) => db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;

console.log("=== Before ===");
for (const t of TABLES) console.log(`  ${t}: ${count(t)}`);

for (const { alias, file, label } of BACKUPS) {
  db.exec(`ATTACH DATABASE '${file}' AS ${alias}`);
  console.log(`\n=== Merging from ${label} (${file}) ===`);
  for (const table of TABLES) {
    const exists = db
      .prepare(`SELECT 1 FROM ${alias}.sqlite_master WHERE type='table' AND name=?`)
      .get(table);
    if (!exists) {
      console.log(`  ${table}: not present in backup, skipped`);
      continue;
    }
    const targetCols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    const srcCols = new Set(db.prepare(`PRAGMA ${alias}.table_info(${table})`).all().map((c) => c.name));
    const common = targetCols.filter((c) => srcCols.has(c));
    if (common.length === 0) {
      console.log(`  ${table}: no common columns, skipped`);
      continue;
    }
    const cols = common.map((c) => `"${c}"`).join(", ");
    const result = db
      .prepare(`INSERT OR IGNORE INTO ${table} (${cols}) SELECT ${cols} FROM ${alias}.${table}`)
      .run();
    console.log(`  ${table}: +${result.changes} rows (candidate ${db.prepare(`SELECT COUNT(*) c FROM ${alias}.${table}`).get().c})`);
  }
  db.exec(`DETACH DATABASE ${alias}`);
}

// Realign AUTOINCREMENT sequences so future inserts never collide with the
// explicitly restored ids (requires touching sqlite_sequence; no user table
// is updated).
console.log("\n=== sqlite_sequence realignment ===");
const seqs = db.prepare("SELECT name, seq FROM sqlite_sequence").all();
for (const { name, seq } of seqs) {
  if (!TABLES.includes(name)) continue;
  const maxId = db.prepare(`SELECT MAX(id) AS m FROM ${name}`).get().m;
  if (maxId != null && maxId > seq) {
    db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = ?").run(maxId, name);
    console.log(`  ${name}: seq ${seq} -> ${maxId}`);
  } else {
    console.log(`  ${name}: seq ${seq} ok (max id ${maxId})`);
  }
}

console.log("\n=== After ===");
for (const t of TABLES) console.log(`  ${t}: ${count(t)}`);
db.close();
console.log("\nDone.");
