import { describe, it, expect } from "vitest";
import { matchesExclusion, matchesComposite, applyKeywordFilters } from "./filterRules.js";

describe("filterRules", () => {
  it("matchesExclusion detects excluded keyword", () => {
    const item = { title: "总裁班开班通知", summary: "" };
    expect(matchesExclusion(item, { must_exclude: ["总裁班"] })).toBe(true);
  });

  it("matchesExclusion works with JSON string keyword lists from the database", () => {
    const item = { title: "总裁班开班通知", summary: "" };
    expect(matchesExclusion(item, { must_exclude: '["总裁班"]' })).toBe(true);
  });

  it("matchesComposite keeps items matching all includes and no excludes", () => {
    const item = { title: "中石油加油站开业", summary: "" };
    expect(
      matchesComposite(item, { must_include: ["中石油", "开业"], must_exclude: ["指数"] })
    ).toBe(true);
  });

  it("matchesComposite drops items missing an include keyword", () => {
    const item = { title: "中石油新闻", summary: "" };
    expect(
      matchesComposite(item, { must_include: ["中石油", "开业"], must_exclude: [] })
    ).toBe(false);
  });

  it("matchesComposite drops items matching an exclude keyword", () => {
    const item = { title: "中石油加油站开业指数", summary: "" };
    expect(
      matchesComposite(item, { must_include: ["中石油", "开业"], must_exclude: ["指数"] })
    ).toBe(false);
  });

  it("applyKeywordFilters drops exclusions and non-matching composites", () => {
    const items = [
      { title: "总裁班开班", summary: "" },
      { title: "中石油开业", summary: "" },
      { title: " unrelated ", summary: "" }
    ];
    const rules = [
      { type: "exclude_keyword", must_exclude: ["总裁班"] },
      { type: "composite", must_include: ["中石油"], must_exclude: [] }
    ];
    const result = applyKeywordFilters(items, rules);
    expect(result.length).toBe(1);
    expect(result[0].title).toBe("中石油开业");
  });

  it("applyKeywordFilters keeps all non-excluded items when no composite rules exist", () => {
    const items = [
      { title: "总裁班开班", summary: "" },
      { title: "中石油开业", summary: "" }
    ];
    const rules = [{ type: "exclude_keyword", must_exclude: ["总裁班"] }];
    const result = applyKeywordFilters(items, rules);
    expect(result.length).toBe(1);
    expect(result[0].title).toBe("中石油开业");
  });

  it("does not throw on malformed JSON keyword lists", () => {
    const item = { title: "中石油开业", summary: "" };
    expect(() => {
      matchesExclusion(item, { must_exclude: "not valid json" });
      matchesComposite(item, { must_include: "{bad json", must_exclude: "[}" });
      applyKeywordFilters([item], [
        { type: "exclude_keyword", must_exclude: "{broken" },
        { type: "composite", must_include: "[unclosed", must_exclude: null }
      ]);
    }).not.toThrow();
  });

  it("does not throw on non-string keywords", () => {
    const item = { title: "中石油开业", summary: "" };
    expect(() => {
      matchesExclusion(item, { must_exclude: [123, null, "中石油"] });
      matchesComposite(item, { must_include: ["中石油", true], must_exclude: ["指数", 456] });
      applyKeywordFilters([item], [
        { type: "exclude_keyword", must_exclude: [null, undefined, {}] },
        { type: "composite", must_include: ["中石油", 789], must_exclude: [] }
      ]);
    }).not.toThrow();
    expect(
      matchesComposite(item, { must_include: ["中石油"], must_exclude: ["指数", 456] })
    ).toBe(true);
  });
});

import {
  resolvePurposeFromTitle,
  resolveMatchedPurposes,
  PURPOSE_PRIORITY
} from "./filterRules.js";

describe("resolvePurposeFromTitle", () => {
  const subjects = {
    competitor: ["解放汽车", "中国重汽", "宁德时代"],
    tech: ["钠离子电池", "固态电池", "电解水制氢"],
    policy: ["工信部", "国家发改委", "上海"],
    industry: ["核电", "电池", "光伏发电"]
  };

  it("标题命中单一类别 → 返回该 purpose（industry 不参与主体词判定）", () => {
    expect(resolvePurposeFromTitle("宁德时代发布新品", subjects)).toEqual(["competitor"]);
    // industry 已不靠主体词判定（由 LLM event_kind=industry_overview 负责）
    expect(resolvePurposeFromTitle("中国核电装机全球第一", subjects)).toEqual([]);
  });

  it("标题命中多类 → 有序返回，[0] 即 竞争>技术>政策 单选", () => {
    // 宁德时代(competitor) + 钠离子电池(tech) + 电池(industry) → [0]=competitor
    const r1 = resolvePurposeFromTitle("宁德时代钠离子电池量产", subjects);
    expect(r1).toEqual(["competitor", "tech"]);
    expect(r1[0]).toBe("competitor");
    // 上海(policy) + 光伏发电(industry) → [0]=policy
    const r2 = resolvePurposeFromTitle("上海光伏发电规划发布", subjects);
    expect(r2).toEqual(["policy"]);
    expect(r2[0]).toBe("policy");
  });

  it("标题零命中 → 空数组（不生成）", () => {
    expect(resolvePurposeFromTitle("天气晴朗适合出行", subjects)).toEqual([]);
  });

  it("PURPOSE_PRIORITY 顺序固定为 竞争>技术>政策", () => {
    expect(PURPOSE_PRIORITY).toEqual(["competitor", "tech", "policy"]);
  });
});

describe("resolveMatchedPurposes", () => {
  const subjects = {
    competitor: ["解放汽车", "中国重汽", "一汽解放", "宁德时代"],
    tech: ["钠离子电池", "共享储能", "漂浮式风机"],
    policy: ["工信部", "国家能源局", "宁夏"],
    industry: ["核电", "电池", "储能", "风电"]
  };

  it("EPC招标 → policy_action → policy", () => {
    expect(
      resolveMatchedPurposes({ title: "宁夏固原1.4GWh共享储能电站EPC招标", subjectKeywordsByPurpose: subjects, eventKind: "policy_action" })
    ).toEqual(["policy"]);
  });

  it("部署整治 → policy_action → policy", () => {
    expect(
      resolveMatchedPurposes({ title: "国家能源局部署新型储能安全专项整治", subjectKeywordsByPurpose: subjects, eventKind: "policy_action" })
    ).toEqual(["policy"]);
  });

  it("首座投运 → tech_milestone → tech（标题含行业词也可高亮）", () => {
    expect(
      resolveMatchedPurposes({ title: "全球首座16兆瓦张力腿浮式风电平台投运", subjectKeywordsByPurpose: subjects, eventKind: "tech_milestone" })
    ).toEqual(["tech"]);
  });

  it("企业推新车 → company_action → competitor", () => {
    expect(
      resolveMatchedPurposes({ title: "一汽解放推出钠离子电池换电牵引车", subjectKeywordsByPurpose: subjects, eventKind: "company_action" })
    ).toEqual(["competitor"]);
  });

  it("行业统计 → industry_overview → industry（标题须含行业词）", () => {
    expect(
      resolveMatchedPurposes({ title: "中国核电在建规模连续19年全球第一", subjectKeywordsByPurpose: subjects, eventKind: "industry_overview" })
    ).toEqual(["industry"]);
  });

  it("industry_overview 但标题无行业词 → 淘汰（无法高亮/筛选）", () => {
    expect(
      resolveMatchedPurposes({ title: "某企业发布最新数据", subjectKeywordsByPurpose: subjects, eventKind: "industry_overview" })
    ).toEqual([]);
  });

  it("LLM 未判出 eventKind → 回退主体词判定（确定性兜底）", () => {
    expect(
      resolveMatchedPurposes({ title: "宁德时代发布新品", subjectKeywordsByPurpose: subjects, eventKind: "" })
    ).toEqual(["competitor"]);
  });

  it("标题无任何主体关键词 → 空数组（淘汰）", () => {
    expect(
      resolveMatchedPurposes({ title: "天气晴朗适合出行", subjectKeywordsByPurpose: subjects, eventKind: "tech_milestone" })
    ).toEqual([]);
  });
});

import { findMatchedKeyword, findMatchedExcludingKeyword } from "./filterRules.js";

// 匹配文本缓存（2026-10-22 性能优化）的正确性护栏：item 被复用匹配多次
// （行业预筛→关键词门多 purpose 桶）时缓存生效；但 item 文本若被改写，
// 后续匹配必须读到新文本——流水线 Phase 3 会覆写 title/summary，缓存绝不允许
// 返回陈旧文本。
describe("匹配文本缓存 — 变更可见性", () => {
  it("findMatchedKeyword：item.title 改写后再次匹配反映新文本", () => {
    const item = { title: "原标题", summary: "" };
    expect(findMatchedKeyword(item, ["原标题"])).toBe("原标题");
    item.title = "改写后的标题";
    expect(findMatchedKeyword(item, ["原标题"])).toBeNull();
    expect(findMatchedKeyword(item, ["改写"])).toBe("改写");
  });

  it("findMatchedExcludingKeyword：正文与标题改写后再次匹配反映新文本", () => {
    const item = { title: "标题", summary: "", rawContent: "正文含旧词" };
    expect(findMatchedExcludingKeyword(item, ["旧词"])).toBe("旧词");
    item.rawContent = "正文已清洗";
    expect(findMatchedExcludingKeyword(item, ["旧词"])).toBeNull();
    item.title = "招聘：标题含新词";
    expect(findMatchedExcludingKeyword(item, ["招聘"])).toBe("招聘");
  });
});
