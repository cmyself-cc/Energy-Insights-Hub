import db from "../db.js";
import { loadSourcesFromMd } from "../lib/sourcesMdLoader.js";

export function seedSources() {
  const existing = db.prepare("SELECT COUNT(*) as count FROM sources").get();
  if (existing.count > 0) return;

  const drafts = loadSourcesFromMd();
  if (drafts.length === 0) {
    console.log("[seed] No sources found in sources.md");
    return;
  }

  const insert = db.prepare(
    "INSERT INTO sources (name, url, type, active, config) VALUES (?, ?, ?, ?, ?)"
  );
  const insertMany = db.transaction((sources) => {
    for (const s of sources) insert.run(s.name, s.url, s.type, s.active, s.config);
  });
  insertMany(drafts);
  console.log(`[seed] Inserted ${drafts.length} sources from sources.md`);
}

export default seedSources;
