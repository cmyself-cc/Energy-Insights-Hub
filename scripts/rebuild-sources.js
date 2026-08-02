// One-off script: rebuild sources = 8/1 backup (6 core) + today's 20 added sources.
import Database from "better-sqlite3";

const cur = new Database("data/energy_insights.db");
const { readFileSync } = await import("fs");
const data = JSON.parse(readFileSync("/Users/cmyself/Desktop/config-2026-08-01.json", "utf-8"));

cur.pragma("foreign_keys = OFF");

console.log("sources before:", cur.prepare("SELECT COUNT(*) c FROM sources").get().c);
cur.prepare("DELETE FROM sources").run();

// --- Part 1: 8/1 backup sources (6 core) ---
const insSrc = cur.prepare(
  "INSERT INTO sources (id,name,url,type,active,config,created_at,updated_at,purpose) VALUES (?,?,?,?,?,?,?,?,?)"
);
for (const s of data.sources) {
  insSrc.run(s.id, s.name, s.url, s.type, s.active ?? 1, s.config || null, s.created_at, s.updated_at, s.purpose || "");
}
console.log("  restored", data.sources.length, "backup sources");

// --- Part 2: today's 20 added sources (user list, minus 嘉实多 which user deleted) ---
const today = "2026-08-02 00:00:00";
const newSources = [
  ["能源网", "https://www.china5e.com/", "website", "competitor,policy,tech"],
  ["中国能源网", "https://www.cnenergynews.cn/", "website", "competitor,policy,tech"],
  ["国际能源网", "https://www.in-en.com/", "website", "competitor,policy,tech"],
  ["中国电力网", "http://www.chinapower.com.cn/", "website", "competitor,policy,tech"],
  ["能源界", "https://www.nengyuanjie.net/", "website", "competitor,policy,tech"],
  ["环球能源网", "https://shcymc.com/", "website", "competitor,policy,tech"],
  ["中国石油官网", "https://www.cnpc.com.cn/", "website", "competitor,policy"],
  ["中国石化官网", "http://www.sinopecgroup.com/group/", "website", "competitor,policy"],
  ["福斯润滑油官网", "https://www.fuchs.com/cn/zh/", "website", "competitor"],
  ["道达尔润滑油官网", "https://lubricants.totalenergies.cn/", "website", "competitor"],
  ["北极星电力网-风力发电板块", "https://fd.bjx.com.cn/", "website", "competitor,tech"],
  ["北极星电力网-光伏板块", "https://guangfu.bjx.com.cn/", "website", "competitor,tech"],
  ["北极星电力网-储能板块", "https://chuneng.bjx.com.cn/", "website", "competitor,tech"],
  ["北极星电力网-氢能板块", "https://qn.bjx.com.cn/", "website", "competitor,tech"],
  ["第一商用车", "https://www.cvworld.cn/news/sycnews/", "website", "competitor"],
  ["远景科技集团", "https://www.envisioncn.com/#/news", "website", "competitor,tech"],
  ["宁德时代新闻板块", "https://www.catl.com/news/", "website", "competitor,tech"],
  ["巴斯夫中国新闻板块", "https://www.basf.com/cn/zh/media/news-releases", "website", "competitor"],
  ["特来电新闻板块", "https://www.teld.cn/www/dynamicNew", "website", "competitor,tech"],
  ["中石油新闻板块", "http://xxgk.cnpc.com.cn/xxgk/gsdt/common_list.shtml", "website", "competitor,policy"],
];
for (const [name, url, type, purpose] of newSources) {
  insSrc.run(null, name, url, type, 1, null, today, today, purpose);
}
console.log("  added", newSources.length, "today sources");

cur.prepare("UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM sources) WHERE name = 'sources'").run();
cur.pragma("foreign_keys = ON");

console.log("sources after:", cur.prepare("SELECT COUNT(*) c FROM sources").get().c);
for (const s of cur.prepare("SELECT id, name, url, purpose FROM sources ORDER BY id").all()) {
  console.log("  [" + s.id + "] " + s.name + " | " + s.purpose);
}
cur.close();
console.log("Done.");
