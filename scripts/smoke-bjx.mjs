// Live smoke test: crawl the bjx source end-to-end and verify coverage.
// Usage: node scripts/smoke-bjx.mjs
/* global process */
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { fetchArticles } from "../server/crawlers/websiteCrawler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, "..", "data", "energy_insights.db"), { readonly: true });
const source = db.prepare("SELECT * FROM sources WHERE url = ?").get("https://energy.bjx.com.cn");
if (!source) {
  console.error("FAIL: bjx source not found in database");
  process.exit(1);
}

const t0 = Date.now();
const articles = await fetchArticles(source);
console.log(`Fetched ${articles.length} articles in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const failures = [];
if (articles.length < 5) failures.push(`expected >=5 articles, got ${articles.length}`);
for (const a of articles) {
  if ((a.rawContent || "").length < 100) failures.push(`thin content (${(a.rawContent || "").length} chars): ${a.url}`);
  const ageMs = Date.now() - new Date(a.publishDate).getTime();
  if (isNaN(ageMs) || ageMs > 8 * 86400000) failures.push(`bad publishDate ${a.publishDate}: ${a.url}`);
  console.log(`- [${(a.publishDate || "").slice(0, 10)}] ${(a.title || "").slice(0, 50)} | content:${(a.rawContent || "").length}字`);
}

if (failures.length > 0) {
  console.error("FAIL:");
  failures.forEach(f => console.error("  - " + f));
  process.exit(1);
}
console.log("PASS");
