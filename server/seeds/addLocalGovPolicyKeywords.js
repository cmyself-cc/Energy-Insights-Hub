import path from "path";
import { fileURLToPath } from "url";
import db from "../db.js";

// 一次性导入：把 31 个省级行政区加入政策主体词库（purpose=policy）。
// 子串匹配天然覆盖「广东省/上海市」等带后缀写法，故只收裸名。幂等可重跑。
export const LOCAL_GOV_KEYWORDS = [
  "北京", "上海", "天津", "重庆",
  "河北", "山西", "辽宁", "吉林", "黑龙江",
  "江苏", "浙江", "安徽", "福建", "江西", "山东",
  "河南", "湖北", "湖南", "广东", "海南",
  "四川", "贵州", "云南", "陕西", "甘肃", "青海",
  "内蒙古", "广西", "西藏", "宁夏", "新疆"
];

export function addLocalGovKeywords() {
  const exists = db.prepare(
    "SELECT 1 FROM filter_rules WHERE type = 'enterprise' AND purpose = 'policy' AND name = ?"
  );
  const ins = db.prepare(
    "INSERT INTO filter_rules (type, name, must_include, must_exclude, active, priority, purpose, aliases) VALUES ('enterprise', ?, '', '', 1, 0, 'policy', '[]')"
  );
  let inserted = 0;
  let skipped = 0;
  const apply = db.transaction(() => {
    for (const name of LOCAL_GOV_KEYWORDS) {
      if (exists.get(name)) { skipped += 1; continue; }
      ins.run(name);
      inserted += 1;
    }
  });
  apply();
  return { inserted, skipped };
}

// Run standalone: node server/seeds/addLocalGovPolicyKeywords.js
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const stats = addLocalGovKeywords();
  console.log(`新增地方政府主体词: ${stats.inserted} 条，已存在跳过: ${stats.skipped} 条`);
}
