// One-off import script: restore user config from Desktop/config-2026-08-01.json
// into the current database, following the latest schema.
import Database from "better-sqlite3";

const cur = new Database("data/energy_insights.db");
const backupPath = "/Users/cmyself/Desktop/config-2026-08-01.json";
const { readFileSync } = await import("fs");
const data = JSON.parse(readFileSync(backupPath, "utf-8"));

cur.pragma("foreign_keys = OFF");

// ---------- 1. filter_rules (438) ----------
console.log("filter_rules:", cur.prepare("SELECT COUNT(*) c FROM filter_rules").get().c, "→", data.filterRules.length);
cur.prepare("DELETE FROM filter_rules").run();
const insR = cur.prepare(
  "INSERT INTO filter_rules (id,type,name,must_include,must_exclude,active,priority,created_at,updated_at,purpose,aliases) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
);
for (const r of data.filterRules) {
  insR.run(r.id, r.type, r.name, r.must_include || "[]", r.must_exclude || "[]", r.active ?? 1, r.priority || 0, r.created_at, r.updated_at, r.purpose || "", "[]");
}
cur.prepare("UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM filter_rules) WHERE name = 'filter_rules'").run();

// ---------- 2. filter_config (4: 3 semantic prompts + ai_presets) ----------
console.log("filter_config:", cur.prepare("SELECT COUNT(*) c FROM filter_config").get().c, "→", data.filterConfig.length);
cur.prepare("DELETE FROM filter_config").run();
const insC = cur.prepare(
  "INSERT INTO filter_config (type,content,active,updated_at,purpose) VALUES (?,?,?,CURRENT_TIMESTAMP,?)"
);
for (const c of data.filterConfig) {
  insC.run(c.type, c.content || "", c.active ?? 1, c.purpose || "");
}
cur.prepare("UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM filter_config) WHERE name = 'filter_config'").run();

// ---------- 3. business_categories (12) ----------
console.log("business_categories:", cur.prepare("SELECT COUNT(*) c FROM business_categories").get().c, "→", data.businessCategories.length);
cur.prepare("DELETE FROM business_categories").run();
const insB = cur.prepare(
  "INSERT INTO business_categories (id,name,description,inclusion_prompt,active) VALUES (?,?,?,?,?)"
);
for (const b of data.businessCategories) {
  insB.run(b.id, b.name, b.description || "", b.inclusion_prompt || "", b.active ?? 1);
}
cur.prepare("UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM business_categories) WHERE name = 'business_categories'").run();

// ---------- 4. industry_categories: replace first 10 with backup full versions,
//             keep current 新能源/氢能 (ids 11,12) ----------
console.log("industry_categories: replace ids 1-10 with backup, keep 11/12");
cur.prepare("DELETE FROM industry_categories WHERE id <= 10").run();
const insI = cur.prepare(
  "INSERT INTO industry_categories (id,name,keywords,active,aliases) VALUES (?,?,?,?,?)"
);
for (const c of data.industryCategories) {
  insI.run(c.id, c.name, JSON.stringify(c.keywords || []), c.active ?? 1, "[]");
}
cur.prepare("UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM industry_categories) WHERE name = 'industry_categories'").run();

cur.pragma("foreign_keys = ON");

// ---------- Summary ----------
console.log("\n=== After import ===");
for (const t of ["sources", "filter_rules", "filter_config", "business_categories", "industry_categories", "insights", "tracker_settings"]) {
  console.log("  " + t + ":", cur.prepare("SELECT COUNT(*) c FROM " + t).get().c);
}
cur.close();
console.log("Done.");
