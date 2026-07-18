import "dotenv/config";
import db from "../db.js";
import { execFileSync } from "child_process";
import path from "path";
import os from "os";
import fs from "fs";
import { seedPurposePrompts } from "./seedPurposePrompts.js";

function runPython(script) {
  const tmpDir = os.tmpdir();
  const scriptPath = path.join(tmpDir, `seed-${Date.now()}.py`);
  fs.writeFileSync(scriptPath, script);
  const out = execFileSync("python3", [scriptPath], { encoding: "utf-8" });
  fs.unlinkSync(scriptPath);
  return JSON.parse(out);
}

const script = `
import pandas as pd
import json

xl = pd.ExcelFile('Key Config.xlsx')

# Competitor rules
comp = pd.read_excel(xl, sheet_name='底层过滤关键词', header=None).iloc[1:]
competitor = {'enterprise': set(), 'include': set(), 'exclude': set()}
for _, row in comp.iterrows():
    base = str(row.iloc[0]).strip() if pd.notna(row.iloc[0]) else ''
    inc = str(row.iloc[4]).strip() if len(row) > 4 and pd.notna(row.iloc[4]) else ''
    exc = str(row.iloc[5]).strip() if len(row) > 5 and pd.notna(row.iloc[5]) else ''
    if base: competitor['enterprise'].add(base)
    if inc: competitor['include'].add(inc)
    if exc: competitor['exclude'].add(exc)

# Policy rules
policy = {'enterprise': set(), 'include': set(), 'exclude': set()}
for name in ['国家能源局', '国家发改委', '交通部', '生态环境部', '工信部', '财政部', '商务部', '能源局']:
    policy['enterprise'].add(name)
for kw in ['政策', '规划', '通知', '批复', '标准', '方案', '意见', '办法', '条例', '规定', '指导', '部署']:
    policy['include'].add(kw)
for kw in ['培训', '会议', '学术', '获奖', '颁奖', '庆典', '活动', '论坛', '展会', '广告']:
    policy['exclude'].add(kw)

# Tech rules
tech = {'enterprise': set(), 'include': set(), 'exclude': set()}
for kw in ['新能源', '储能', '光伏', '油气', 'CCUS', '氢能', '锂电池', '燃料电池', '风电', '核电', '太阳能', '智能电网', '充电', '换电', '电池回收', '碳捕捉', '碳封存']:
    tech['enterprise'].add(kw)
for kw in ['突破', '创新', '研发', '专利', '首次', '发布', '量产', '试制', '试验', '验证', '示范', '应用', '落地']:
    tech['include'].add(kw)
for kw in ['获奖', '任命', '推广', '广告', '赞助', '招聘', '培训', '会议']:
    tech['exclude'].add(kw)

result = {
    'competitor': {k: sorted(v) for k, v in competitor.items()},
    'policy': {k: sorted(v) for k, v in policy.items()},
    'tech': {k: sorted(v) for k, v in tech.items()}
}
print(json.dumps(result, ensure_ascii=False))
`;

const data = runPython(script);

db.prepare("DELETE FROM filter_rules").run();

const insert = db.prepare(
  "INSERT INTO filter_rules (type, name, must_include, must_exclude, active, priority, purpose) VALUES (?, ?, '[]', '[]', 1, 0, ?)"
);

const tx = db.transaction(() => {
  for (const [purpose, rules] of Object.entries(data)) {
    for (const kw of rules.enterprise) insert.run("enterprise", kw, purpose);
    for (const kw of rules.include) insert.run("include_keyword", kw, purpose);
    for (const kw of rules.exclude) insert.run("exclude_keyword", kw, purpose);
  }
});
tx();

const counts = db.prepare("SELECT purpose, type, COUNT(*) as cnt FROM filter_rules GROUP BY purpose, type").all();
console.log(JSON.stringify(counts, null, 2));

seedPurposePrompts();
console.log(JSON.stringify(db.prepare("SELECT id, purpose, active FROM filter_config WHERE type = 'semantic'").all(), null, 2));
