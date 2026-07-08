import db from "../db.js";

const defaultSources = [
  { name: "Reuters Energy", url: "https://www.reuters.com/business/energy/rss.xml", type: "rss" },
  { name: "Bloomberg Energy", url: "https://feeds.bloomberg.com/news/energy", type: "rss" },
  { name: "IEA News", url: "https://www.iea.org/news/rss", type: "rss" },
  { name: "S&P Global Commodity Insights", url: "https://www.spglobal.com/commodityinsights/rss", type: "rss" },
  { name: "Energy Central", url: "https://energycentral.com/rss", type: "rss" }
];

export function seedSources() {
  const existing = db.prepare("SELECT COUNT(*) as count FROM sources").get();
  if (existing.count > 0) return;

  const insert = db.prepare("INSERT INTO sources (name, url, type) VALUES (?, ?, ?)");
  const insertMany = db.transaction((sources) => {
    for (const s of sources) insert.run(s.name, s.url, s.type);
  });
  insertMany(defaultSources);
  console.log(`[seed] Inserted ${defaultSources.length} default sources.`);
}

export default seedSources;
