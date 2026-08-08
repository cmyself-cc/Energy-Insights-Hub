import path from "path";
import { fileURLToPath } from "url";
import db from "../db.js";

// 一次性导入：重建技术动态（purpose=tech）的企业/主体关键词列表。
// 删除原有 tech 主体关键词，写入下方按领域整理的新词表
//（取各领域条目及「如」后的具体技术名称；过于宽泛的组织性标签如
// "智能化/出行模式/代际分类"不作为关键词）。
export const TECH_KEYWORDS = [
  // 一、LNG/天然气
  "液化工艺", "丙烷预冷", "混合制冷剂", "氮气膨胀",
  "再气化技术", "开架式气化器", "浸没燃烧式气化器",
  "冷能利用", "冷能发电", "空气分离",
  "BOG", "BOG处理", "BOG再液化", "BOG压缩机",
  "全容罐", "薄膜罐", "FLNG", "浮式液化装置",
  "天然气掺氢", "地下储气库", "LNG调峰站",
  // 二、储能
  "电化学储能", "锂离子电池", "钠离子电池", "液流电池", "全钒", "铁铬",
  "机械储能", "抽水蓄能", "压缩空气储能", "飞轮储能",
  "电磁储能", "超级电容器", "超导磁储能",
  "储热", "熔盐储热", "相变储热",
  "构网型储能", "工商业储能", "源网荷储", "共享储能",
  // 三、化工
  "煤化工", "煤气化", "煤制烯烃", "煤制乙二醇",
  "石油化工", "催化裂化", "加氢裂化", "重整",
  "精细化工", "电子化学品", "高纯试剂",
  "工程塑料", "碳纤维", "高分子膜材料",
  "绿色化工", "微通道反应", "生物基化学品",
  "低碳技术", "电加热裂解炉", "绿氢耦合化工",
  // 四、新能源（光伏/风电/综合）
  "PERC", "TOPCon", "HJT", "异质结", "钙钛矿", "BC背接触",
  "陆上风电", "海上风电", "漂浮式风机", "大兆瓦机组",
  "光热发电", "塔式光热", "槽式光热", "菲涅尔式",
  "生物质能", "直燃发电", "气化发电",
  "多能互补", "综合能源系统", "新能源消纳",
  // 五、氢能
  "碱性电解水", "PEM电解水", "SOEC", "固体氧化物电解", "光解水",
  "灰氢", "蓝氢", "绿氢", "绿氨",
  "高压气态储氢", "液氢", "LOHC", "液态有机储氢", "固态储氢",
  "氢燃料电池", "PEMFC", "质子交换膜", "SOFC", "固体氧化物燃料电池",
  "氢化工", "氢冶金", "工业掺氢", "绿氢炼钢",
  // 六、润滑油
  "基础油", "矿物基础油", "合成油", "PAO", "酯类基础油",
  "添加剂", "抗磨剂", "抗氧化剂", "清净分散剂", "摩擦改进剂",
  "发动机油", "工业齿轮油", "液压油", "润滑脂", "金属加工液",
  "低灰分", "生物可降解", "废油再生", "加氢精制",
  // 七、生物燃料
  "生物柴油", "燃料乙醇", "纤维素乙醇", "藻类燃料",
  "可持续航空燃料", "SAF", "生物甲醇", "生物沼气",
  "酯交换", "加氢脱氧", "HDO", "气化费托合成", "费托合成", "厌氧发酵",
  "船用生物燃料", "车用乙醇汽油", "乙醇汽油",
  // 八、电力
  "特高压", "UHV", "柔性直流输电", "VSC-HVDC", "智能电网",
  "微电网", "增量配网",
  "虚拟电厂", "VPP", "电力现货市场", "需求侧响应", "调峰调频",
  "超超临界", "灵活性改造", "热电联产",
  "智慧电厂", "数字孪生", "AI巡检",
  // 九、移动出行
  "纯电动", "BEV", "插混", "PHEV", "增程", "EREV", "换电",
  "三元锂电池", "磷酸铁锂", "LFP", "固态电池", "钠电池", "CTP", "CTC",
  "快充", "超充", "V2G", "车网互动", "无线充电",
  "智能座舱", "辅助驾驶", "ADAS", "自动驾驶", "车路云一体化",
  "网约车", "共享出行", "MaaS",
  // 十、CCS/CCUS
  "CCS", "CCUS", "碳捕集", "碳捕集与封存",
  "燃烧后捕集", "燃烧前捕集", "富氧燃烧", "化学吸收法", "物理吸附法",
  "CO2管道运输", "CO₂管道运输",
  "咸水层封存", "枯竭油气藏封存",
  "CO2驱油", "CO₂驱油", "EOR", "CO2驱气", "CO₂驱气", "EGR",
  "CO2加氢制甲醇", "CO₂加氢制甲醇", "CO2制化学品", "CO₂制化学品"
];

export function importTechKeywords() {
  const del = db.prepare("DELETE FROM filter_rules WHERE type = 'enterprise' AND purpose = 'tech'");
  const ins = db.prepare(
    "INSERT INTO filter_rules (type, name, must_include, must_exclude, active, priority, purpose, aliases) VALUES ('enterprise', ?, '', '', 1, 0, 'tech', '[]')"
  );
  const deleted = del.run().changes;
  const names = [...new Set(TECH_KEYWORDS.map(k => k.trim()).filter(Boolean))];
  const apply = db.transaction(() => {
    for (const name of names) ins.run(name);
  });
  apply();
  return { deleted, inserted: names.length };
}

// Run standalone: node server/seeds/importTechKeywords.js
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const stats = importTechKeywords();
  console.log(`删除原 tech 主体关键词: ${stats.deleted} 条`);
  console.log(`写入新技术关键词: ${stats.inserted} 条`);
}
