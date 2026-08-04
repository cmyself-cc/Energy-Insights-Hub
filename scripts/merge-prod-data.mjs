// One-off merge (2026-08-05): fold the production snapshot
// (data/prod-snapshot-20260805.db, taken via VACUUM INTO from the running
// container) into data/energy_insights.db.
//
// Semantics, decided after a row-level diff of the two databases:
//   - INSERT OR IGNORE with explicit ids (same lineage: equal id = equal row)
//     for sources, filter_rules, business_categories, industry_categories,
//     model_configs, source_imports, feedback_semantic_weights.
//   - Re-key on id conflict (insert without id) where both sides grew rows
//     independently after 08-02: insights (local 228+ from a fresh bjx
//     crawl), tracker_runs, user_feedback.
//   - UPDATE (disclosed exceptions to INSERT-only, prod is strictly newer):
//     filter_rules ids 931/968/993/994/998/1253 (edited in prod 08-02),
//     filter_config local id 5 <- prod 9 and local 8 <- prod 12.
//   - tracker_settings: untouched (no prod-only keys; local values are the
//     user's working copy).
import Database from "better-sqlite3";

const TARGET = "data/energy_insights.db";
const PROD = "data/prod-snapshot-20260805.db";

const ID_MERGE_TABLES = [
  "sources",
  "filter_rules",
  "business_categories",
  "industry_categories",
  "model_configs",
  "source_imports",
  "feedback_semantic_weights",
];
const REKEY_TABLES = ["insights", "tracker_runs", "user_feedback"];
const RULE_UPDATE_IDS = [931, 968, 993, 994, 998, 1253];
const CONFIG_UPDATES = [
  { localId: 5, prodId: 9 },
  { localId: 8, prodId: 12 },
];

const db = new Database(TARGET);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.exec(`ATTACH DATABASE '${PROD}' AS prod`);

const count = (table) => db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
const allTables = [...ID_MERGE_TABLES, ...REKEY_TABLES, "filter_config", "tracker_settings"];

console.log("=== Before ===");
for (const t of allTables) console.log(`  ${t}: ${count(t)}`);

function commonColumns(table) {
  const targetCols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  const prodCols = new Set(db.prepare("PRAGMA prod.table_info(" + table + ")").all().map((c) => c.name));
  return targetCols.filter((c) => prodCols.has(c));
}

function quoted(cols) {
  return cols.map((c) => `"${c}"`).join(", ");
}

// 1. Straight id merges.
for (const table of ID_MERGE_TABLES) {
  const cols = commonColumns(table);
  const res = db
    .prepare(`INSERT OR IGNORE INTO ${table} (${quoted(cols)}) SELECT ${quoted(cols)} FROM prod.${table}`)
    .run();
  console.log(`merge ${table}: +${res.changes} rows`);
}

// 2. Re-key on conflict.
for (const table of REKEY_TABLES) {
  const cols = commonColumns(table);
  const conflicts = db
    .prepare(`SELECT p.id FROM prod.${table} p JOIN main.${table} l ON p.id = l.id`)
    .all()
    .map((r) => r.id);
  const safeCols = cols.filter((c) => c !== "id");
  let added = 0;
  let rekeyed = 0;
  if (conflicts.length > 0) {
    const marks = conflicts.map(() => "?").join(", ");
    const res = db
      .prepare(`INSERT INTO ${table} (${quoted(safeCols)}) SELECT ${quoted(safeCols)} FROM prod.${table} WHERE id IN (${marks})`)
      .run(...conflicts);
    rekeyed = res.changes;
    added += res.changes;
  }
  const res2 = db
    .prepare(`INSERT OR IGNORE INTO ${table} (${quoted(cols)}) SELECT ${quoted(cols)} FROM prod.${table}`)
    .run();
  added += res2.changes;
  console.log(`merge ${table}: +${added} rows (${rekeyed} re-keyed over conflicting ids ${conflicts.join(",") || "-"})`);
}

// 3. Disclosed updates: rules edited in prod after the local lineage forked.
for (const id of RULE_UPDATE_IDS) {
  const cols = commonColumns("filter_rules");
  const sets = cols.filter((c) => c !== "id").map((c) => `"${c}" = p."${c}"`).join(", ");
  db.prepare(`UPDATE main.filter_rules SET ${sets} FROM prod.filter_rules p WHERE p.id = ? AND main.filter_rules.id = ?`).run(id, id);
  console.log(`update filter_rules id ${id} <- prod version`);
}
for (const { localId, prodId } of CONFIG_UPDATES) {
  const cols = commonColumns("filter_config").filter((c) => c !== "id");
  const sets = cols.map((c) => `"${c}" = p."${c}"`).join(", ");
  db.prepare(`UPDATE main.filter_config SET ${sets} FROM prod.filter_config p WHERE p.id = ? AND main.filter_config.id = ?`).run(prodId, localId);
  console.log(`update filter_config local id ${localId} <- prod id ${prodId}`);
}

// 4. Realign AUTOINCREMENT sequences.
console.log("=== sqlite_sequence realignment ===");
for (const { name, seq } of db.prepare("SELECT name, seq FROM sqlite_sequence").all()) {
  if (!allTables.includes(name)) continue;
  const maxId = db.prepare(`SELECT MAX(id) AS m FROM ${name}`).get().m;
  if (maxId != null && maxId > seq) {
    db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = ?").run(maxId, name);
    console.log(`  ${name}: seq ${seq} -> ${maxId}`);
  }
}

console.log("\n=== After ===");
for (const t of allTables) console.log(`  ${t}: ${count(t)}`);
db.exec("DETACH DATABASE prod");
db.close();
console.log("\nDone.");
