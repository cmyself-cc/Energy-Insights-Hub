import { execFileSync } from "child_process";
import pathLib from "path";
import osLib from "os";
import fsLib from "fs";
import db from "../db.js";
import { seedPurposePrompts } from "./seedPurposePrompts.js";

const DEFAULT_AI_PRESETS = [
  "请从竞争格局角度深入分析这篇文章。重点关注：涉及哪些企业、各自的战略意图是什么、对市场格局可能产生什么影响。\n\n回答格式：\n### 涉及主体\n- 企业A：角色/动作\n- 企业B：角色/动作\n\n### 战略意图分析\n- 短期目标\n- 长期布局\n\n### 市场影响评估\n- 直接影响\n- 传导效应\n- 风险提示",
  "请从政策与合规角度解读这篇文章。重点关注：涉及哪些政策文件或监管机构、政策背景与目的、对行业的具体影响和执行时间线。\n\n回答格式：\n### 政策要点\n- 发文机构\n- 核心条款\n- 生效时间\n\n### 背景与意图\n\n### 行业影响\n- 利好方向\n- 约束方向\n- 合规建议",
  "请从技术路线与产业趋势角度评估这篇文章。重点关注：涉及什么技术或工艺、当前成熟度如何、对产业链上下游可能产生什么影响。\n\n回答格式：\n### 技术/趋势概述\n- 技术名称/路线\n- 当前阶段（实验室/中试/示范/量产）\n\n### 产业链影响\n- 上游：原料/设备端影响\n- 中游：制造/集成端影响\n- 下游：应用/市场端影响\n\n### 前景判断\n- 短期（1-2年）\n- 中期（3-5年）\n- 需要关注的关键变量"
];

function trySeedFromXlsx() {
  try {
    const script = `
import pandas as pd
import json

xl = pd.ExcelFile('Key Config.xlsx')
comp = pd.read_excel(xl, sheet_name='底层过滤关键词', header=None).iloc[1:]
competitor = {'enterprise': set(), 'include': set(), 'exclude': set()}
for _, row in comp.iterrows():
    base = str(row.iloc[0]).strip() if pd.notna(row.iloc[0]) else ''
    inc = str(row.iloc[4]).strip() if len(row) > 4 and pd.notna(row.iloc[4]) else ''
    exc = str(row.iloc[5]).strip() if len(row) > 5 and pd.notna(row.iloc[5]) else ''
    if base: competitor['enterprise'].add(base)
    if inc: competitor['include'].add(inc)
    if exc: competitor['exclude'].add(exc)

policy = {'enterprise': set(), 'include': set(), 'exclude': set()}
for name in ['国家能源局','国家发改委','交通部','生态环境部','工信部','财政部','商务部','能源局']:
    policy['enterprise'].add(name)
for kw in ['政策','规划','通知','批复','标准','方案','意见','办法','条例','规定','指导','部署']:
    policy['include'].add(kw)
for kw in ['培训','会议','学术','获奖','颁奖','庆典','活动','论坛','展会','广告']:
    policy['exclude'].add(kw)

tech = {'enterprise': set(), 'include': set(), 'exclude': set()}
for kw in ['新能源','储能','光伏','油气','CCUS','氢能','锂电池','燃料电池','风电','核电','太阳能','智能电网','充电','换电','电池回收','碳捕捉','碳封存']:
    tech['enterprise'].add(kw)
for kw in ['突破','创新','研发','专利','首次','发布','量产','试制','试验','验证','示范','应用','落地']:
    tech['include'].add(kw)
for kw in ['获奖','任命','推广','广告','赞助','招聘','培训','会议']:
    tech['exclude'].add(kw)

result = {k: {kk: sorted(vv) for kk, vv in v.items()} for k, v in {'competitor': competitor, 'policy': policy, 'tech': tech}.items()}
print(json.dumps(result, ensure_ascii=False))
`;
    const tmpDir = osLib.tmpdir();
    const scriptPath = pathLib.join(tmpDir, `seed-${Date.now()}.py`);
    fsLib.writeFileSync(scriptPath, script);
    const out = execFileSync("python3", [scriptPath], { encoding: "utf-8", timeout: 30000 });
    fsLib.unlinkSync(scriptPath);
    return JSON.parse(out);
  } catch (e) {
    console.warn("[seed] XLSX seed failed:", e.message);
    return null;
  }
}

export function seedDefaults() {
  // AI presets
  const aiPresets = db.prepare("SELECT id FROM filter_config WHERE type = 'ai_presets' LIMIT 1").get();
  if (!aiPresets) {
    db.prepare("INSERT INTO filter_config (type, content, active) VALUES ('ai_presets', ?, 1)")
      .run(JSON.stringify(DEFAULT_AI_PRESETS));
    console.log("[seed] AI presets seeded");
  }

  // Semantic prompts for each purpose
  seedPurposePrompts();

  // Filter rules - idempotent
  const ruleCount = db.prepare("SELECT COUNT(*) as cnt FROM filter_rules").get();
  if (ruleCount.cnt === 0) {
    const data = trySeedFromXlsx();
    if (data) {
      const insert = db.prepare("INSERT INTO filter_rules (type, name, must_include, must_exclude, active, priority, purpose) VALUES (?, ?, '[]', '[]', 1, 0, ?)");
      const tx = db.transaction(() => {
        for (const [purpose, rules] of Object.entries(data)) {
          for (const kw of rules.enterprise) insert.run("enterprise", kw, purpose);
          for (const kw of rules.include) insert.run("include_keyword", kw, purpose);
          for (const kw of rules.exclude) insert.run("exclude_keyword", kw, purpose);
        }
      });
      tx();
      console.log("[seed] Filter rules seeded from Key Config.xlsx");
    } else {
      // Fallback minimal defaults
      const insert = db.prepare("INSERT INTO filter_rules (type, name, must_include, must_exclude, active, priority, purpose) VALUES (?, ?, '[]', '[]', 1, 0, ?)");
      const defaults = [
        ["enterprise", "中石油", "competitor"], ["enterprise", "中石化", "competitor"], ["enterprise", "中海油", "competitor"],
        ["enterprise", "国家电网", "competitor"], ["enterprise", "宁德时代", "competitor"], ["enterprise", "比亚迪", "competitor"],
        ["include_keyword", "合作", "competitor"], ["include_keyword", "投资", "competitor"], ["include_keyword", "收购", "competitor"],
        ["exclude_keyword", "股价", ""], ["exclude_keyword", "涨停", ""],
      ];
      for (const [type, name, purpose] of defaults) insert.run(type, name, purpose);
      console.log("[seed] Minimal filter rules seeded (Key Config.xlsx not available)");
    }
  }

  console.log("[seed] Defaults seeding complete");
}
