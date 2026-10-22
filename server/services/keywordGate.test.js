import { describe, it, expect } from "vitest";
import { applyKeywordGate } from "./keywordGate.js";

// Task: 排除关键词扩展到正文匹配。
// 背景（生产实证 2026-10）：排除词「招聘」自 2026-07-26 起 active，但 8/10 月仍漏入
// 3 张标题含「招聘」的卡片（北极星储能网×2、天然气咨询×1）。排查链：
//   规则在库且 active → 排除匹配逻辑正确 → 用真实数据复现**今天**会被排除
//   → 卡片的 matchedPurposes=["competitor"] 证明它过了 gate
//   → 结论：gate 时刻的 title+summary 不含「招聘」，而正文/rawContent 含。
// 原因类：抓取阶段的列表页标题与正文可能缺关键词（LLM 标题是 Phase 3 才生成的），
// 而排除检查只看 title+summary。修复：exclude 检查同时匹配正文，include/enterprise 不动。

const RULES = {
  competitor: {
    enterprise: [{ name: "海博思创", aliases: [] }],
    include_keyword: [{ name: "启动", aliases: [] }],
    exclude_keyword: [{ name: "招聘", aliases: [] }]
  }
};

describe("applyKeywordGate — exclude 匹配扩展到正文", () => {
  it("正文含排除词、标题/摘要不含 → 排除（本 bug 的复现场景）", () => {
    const item = {
      title: "海博思创启动储能名企计划",           // 抓错的标题（列表页标题不含「招聘」）
      summary: "海博思创（688411）发布岗位信息。",
      rawContent: "海博思创发布储能名企招聘信息，岗位含绩效奖金、带薪年假、六险一金……"
    };
    const gate = applyKeywordGate([item], { excludeKeywords: [], purposeRules: RULES });
    expect(gate.excluded).toBe(1);
    expect(gate.kept).toHaveLength(0);
  });

  it("标题含排除词 → 照旧排除（旧行为不回归）", () => {
    const item = { title: "海博思创启动储能名企招聘", summary: "正文随便" };
    const gate = applyKeywordGate([item], { excludeKeywords: [], purposeRules: RULES });
    expect(gate.excluded).toBe(1);
  });

  it("正文也不含排除词 → 正常按 enterprise+include 判定（不误杀）", () => {
    const item = {
      title: "海博思创启动储能系统量产",
      summary: "产线投产。",
      rawContent: "海博思创储能系统产线正式投产，年产能 5GWh。"
    };
    const gate = applyKeywordGate([item], { excludeKeywords: [], purposeRules: RULES });
    expect(gate.kept).toHaveLength(1);
    expect(gate.kept[0].matchedPurposes).toEqual(["competitor"]);
  });

  it("全局 excludeKeywords（tracker_settings）同样扩展到正文", () => {
    const item = {
      title: "某企业发布新规划",
      summary: "规划内容。",
      rawContent: "该公司同时发布了招聘公告。"
    };
    const gate = applyKeywordGate([item], { excludeKeywords: ["招聘"], purposeRules: {} });
    expect(gate.excluded).toBe(1);
  });

  it("include/enterprise 判定仍只看标题+摘要（召回语义不变）", () => {
    // 正文含 enterprise 词、标题不含 → 不应因此被算作 subjectMatch
    const rulesNoExclude = {
      competitor: {
        enterprise: [{ name: "海博思创", aliases: [] }],
        include_keyword: [{ name: "启动", aliases: [] }],
        exclude_keyword: []
      }
    };
    const item = {
      title: "某企业发布新规划",
      summary: "规划内容。",
      rawContent: "海博思创启动了储能系统量产。"
    };
    const gate = applyKeywordGate([item], { excludeKeywords: [], purposeRules: rulesNoExclude });
    // enterprise/include 不匹配 → 排除（matchedPurposes 为空）
    expect(gate.excluded).toBe(1);
  });

  it("无正文字段的旧调用方（rss/微信摘要流）不受影响", () => {
    const item = { title: "海博思创启动储能名企招聘" }; // 无 summary/rawContent
    const gate = applyKeywordGate([item], { excludeKeywords: [], purposeRules: RULES });
    expect(gate.excluded).toBe(1);
  });
});

import { applyIndustryFilter } from "./keywordGate.js";

// 2026-10-22：删除 DEFAULT_INDUSTRY_KEYWORDS 旧口径兜底表（taxonomy 对齐后的
// 漂移隐患）。applyIndustryFilter 收到空/未定义关键词表时必须原样放行——
// 旧实现会退回默认表把不含行业词的条目滤掉，该行为就此钉死废除。
describe("applyIndustryFilter — 空关键词表原样放行（无默认兜底表）", () => {
  const items = [{ title: "一篇没有任何行业关键词的杂文", summary: "全文无关" }];

  it("空数组 → 原样返回", () => {
    expect(applyIndustryFilter(items, [])).toEqual(items);
  });

  it("undefined → 原样返回", () => {
    expect(applyIndustryFilter(items, undefined)).toEqual(items);
  });

  it("显式关键词表仍正常过滤", () => {
    const out = applyIndustryFilter(
      [
        { title: "储能电站投运", summary: "" },
        { title: "无关杂文", summary: "" }
      ],
      [{ name: "储能", aliases: ["电池"] }]
    );
    expect(out.map((i) => i.title)).toEqual(["储能电站投运"]);
  });
});
