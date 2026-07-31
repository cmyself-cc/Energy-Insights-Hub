import db from "../db.js";

const CATEGORIES = [
  {
    name: "电力&氢能",
    keywords: ["电力", "电网", "氢能", "风电", "核电", "水电", "煤电", "电价", "电力市场", "智能电网", "虚拟电厂"]
  },
  {
    name: "储能",
    keywords: ["储能", "电池", "充电"]
  },
  {
    name: "光伏",
    keywords: ["光伏", "太阳能"]
  },
  {
    name: "油气",
    keywords: ["油气", "石油", "LNG", "天然气"]
  },
  {
    name: "CCS",
    keywords: ["CCS", "CCUS", "碳捕捉", "碳封存", "碳捕集", "碳中和"]
  },
  {
    name: "化工",
    keywords: ["化工", "石化", "炼化", "乙烯", "聚乙烯", "聚丙烯"]
  },
  {
    name: "LNG/天然气",
    keywords: ["LNG", "天然气", "液化天然气", "接收站", "长协", "煤改气"]
  },
  {
    name: "移动出行",
    keywords: ["充电桩", "充电站", "电动汽车", "新能源车", "物流", "货运"]
  },
  {
    name: "润滑油",
    keywords: ["润滑油", "基础油", "添加剂", "冷却液", "制动液", "齿轮油"]
  },
  {
    name: "生物燃料",
    keywords: ["生物燃料", "生物柴油", "SAF", "绿色甲醇", "生物乙醇", "可持续航空燃油"]
  }
];

export function seedIndustryCategories() {
  const existing = db.prepare("SELECT COUNT(*) as count FROM industry_categories").get();
  if (existing.count > 0) {
    console.log("[seed] Industry categories already seeded, skipping.");
    return;
  }

  const insert = db.prepare(
    "INSERT INTO industry_categories (name, keywords, active) VALUES (?, ?, 1)"
  );
  const insertMany = db.transaction((categories) => {
    for (const c of categories) {
      insert.run(c.name, JSON.stringify(c.keywords));
    }
  });
  insertMany(CATEGORIES);
  console.log(`[seed] Inserted ${CATEGORIES.length} industry categories.`);
}

// Allow running directly: node server/seeds/seedIndustryCategories.js
if (process.argv[1] && process.argv[1].endsWith("seedIndustryCategories.js")) {
  seedIndustryCategories();
  console.log("[seed] Done.");
  process.exit(0);
}
