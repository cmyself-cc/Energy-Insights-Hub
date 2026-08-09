import { describe, it } from "node:test";
import assert from "node:assert";
import { matchesExclusion, matchesComposite, applyKeywordFilters } from "./filterRules.js";

describe("filterRules", () => {
  it("matchesExclusion detects excluded keyword", () => {
    const item = { title: "总裁班开班通知", summary: "" };
    assert.strictEqual(matchesExclusion(item, { must_exclude: ["总裁班"] }), true);
  });

  it("matchesExclusion works with JSON string keyword lists from the database", () => {
    const item = { title: "总裁班开班通知", summary: "" };
    assert.strictEqual(matchesExclusion(item, { must_exclude: '["总裁班"]' }), true);
  });

  it("matchesComposite keeps items matching all includes and no excludes", () => {
    const item = { title: "中石油加油站开业", summary: "" };
    assert.strictEqual(
      matchesComposite(item, { must_include: ["中石油", "开业"], must_exclude: ["指数"] }),
      true
    );
  });

  it("matchesComposite drops items missing an include keyword", () => {
    const item = { title: "中石油新闻", summary: "" };
    assert.strictEqual(
      matchesComposite(item, { must_include: ["中石油", "开业"], must_exclude: [] }),
      false
    );
  });

  it("matchesComposite drops items matching an exclude keyword", () => {
    const item = { title: "中石油加油站开业指数", summary: "" };
    assert.strictEqual(
      matchesComposite(item, { must_include: ["中石油", "开业"], must_exclude: ["指数"] }),
      false
    );
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
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].title, "中石油开业");
  });

  it("applyKeywordFilters keeps all non-excluded items when no composite rules exist", () => {
    const items = [
      { title: "总裁班开班", summary: "" },
      { title: "中石油开业", summary: "" }
    ];
    const rules = [{ type: "exclude_keyword", must_exclude: ["总裁班"] }];
    const result = applyKeywordFilters(items, rules);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].title, "中石油开业");
  });

  it("does not throw on malformed JSON keyword lists", () => {
    const item = { title: "中石油开业", summary: "" };
    assert.doesNotThrow(() => {
      matchesExclusion(item, { must_exclude: "not valid json" });
      matchesComposite(item, { must_include: "{bad json", must_exclude: "[}" });
      applyKeywordFilters([item], [
        { type: "exclude_keyword", must_exclude: "{broken" },
        { type: "composite", must_include: "[unclosed", must_exclude: null }
      ]);
    });
  });

  it("does not throw on non-string keywords", () => {
    const item = { title: "中石油开业", summary: "" };
    assert.doesNotThrow(() => {
      matchesExclusion(item, { must_exclude: [123, null, "中石油"] });
      matchesComposite(item, { must_include: ["中石油", true], must_exclude: ["指数", 456] });
      applyKeywordFilters([item], [
        { type: "exclude_keyword", must_exclude: [null, undefined, {}] },
        { type: "composite", must_include: ["中石油", 789], must_exclude: [] }
      ]);
    });
    assert.strictEqual(
      matchesComposite(item, { must_include: ["中石油"], must_exclude: ["指数", 456] }),
      true
    );
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
    assert.deepStrictEqual(resolvePurposeFromTitle("宁德时代发布新品", subjects), ["competitor"]);
    // industry 已不靠主体词判定（由 LLM event_kind=industry_overview 负责）
    assert.deepStrictEqual(resolvePurposeFromTitle("中国核电装机全球第一", subjects), []);
  });

  it("标题命中多类 → 有序返回，[0] 即 竞争>技术>政策 单选", () => {
    // 宁德时代(competitor) + 钠离子电池(tech) + 电池(industry) → [0]=competitor
    const r1 = resolvePurposeFromTitle("宁德时代钠离子电池量产", subjects);
    assert.deepStrictEqual(r1, ["competitor", "tech"]);
    assert.strictEqual(r1[0], "competitor");
    // 上海(policy) + 光伏发电(industry) → [0]=policy
    const r2 = resolvePurposeFromTitle("上海光伏发电规划发布", subjects);
    assert.deepStrictEqual(r2, ["policy"]);
    assert.strictEqual(r2[0], "policy");
  });

  it("标题零命中 → 空数组（不生成）", () => {
    assert.deepStrictEqual(resolvePurposeFromTitle("天气晴朗适合出行", subjects), []);
  });

  it("PURPOSE_PRIORITY 顺序固定为 竞争>技术>政策", () => {
    assert.deepStrictEqual(PURPOSE_PRIORITY, ["competitor", "tech", "policy"]);
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
    assert.deepStrictEqual(
      resolveMatchedPurposes({ title: "宁夏固原1.4GWh共享储能电站EPC招标", subjectKeywordsByPurpose: subjects, eventKind: "policy_action" }),
      ["policy"]
    );
  });

  it("部署整治 → policy_action → policy", () => {
    assert.deepStrictEqual(
      resolveMatchedPurposes({ title: "国家能源局部署新型储能安全专项整治", subjectKeywordsByPurpose: subjects, eventKind: "policy_action" }),
      ["policy"]
    );
  });

  it("首座投运 → tech_milestone → tech（标题含行业词也可高亮）", () => {
    assert.deepStrictEqual(
      resolveMatchedPurposes({ title: "全球首座16兆瓦张力腿浮式风电平台投运", subjectKeywordsByPurpose: subjects, eventKind: "tech_milestone" }),
      ["tech"]
    );
  });

  it("企业推新车 → company_action → competitor", () => {
    assert.deepStrictEqual(
      resolveMatchedPurposes({ title: "一汽解放推出钠离子电池换电牵引车", subjectKeywordsByPurpose: subjects, eventKind: "company_action" }),
      ["competitor"]
    );
  });

  it("行业统计 → industry_overview → industry（标题须含行业词）", () => {
    assert.deepStrictEqual(
      resolveMatchedPurposes({ title: "中国核电在建规模连续19年全球第一", subjectKeywordsByPurpose: subjects, eventKind: "industry_overview" }),
      ["industry"]
    );
  });

  it("industry_overview 但标题无行业词 → 淘汰（无法高亮/筛选）", () => {
    assert.deepStrictEqual(
      resolveMatchedPurposes({ title: "某企业发布最新数据", subjectKeywordsByPurpose: subjects, eventKind: "industry_overview" }),
      []
    );
  });

  it("LLM 未判出 eventKind → 回退主体词判定（确定性兜底）", () => {
    assert.deepStrictEqual(
      resolveMatchedPurposes({ title: "宁德时代发布新品", subjectKeywordsByPurpose: subjects, eventKind: "" }),
      ["competitor"]
    );
  });

  it("标题无任何主体关键词 → 空数组（淘汰）", () => {
    assert.deepStrictEqual(
      resolveMatchedPurposes({ title: "天气晴朗适合出行", subjectKeywordsByPurpose: subjects, eventKind: "tech_milestone" }),
      []
    );
  });
});
