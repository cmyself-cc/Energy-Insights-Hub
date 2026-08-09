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

  it("标题命中单一类别 → 返回该 purpose", () => {
    assert.deepStrictEqual(resolvePurposeFromTitle("宁德时代发布新品", subjects), ["competitor"]);
    assert.deepStrictEqual(resolvePurposeFromTitle("中国核电装机全球第一", subjects), ["industry"]);
  });

  it("标题命中多类 → 有序返回，[0] 即 竞争>技术>政策>行业 单选", () => {
    // 宁德时代(competitor) + 钠离子电池(tech) + 电池(industry) → [0]=competitor
    const r1 = resolvePurposeFromTitle("宁德时代钠离子电池量产", subjects);
    assert.deepStrictEqual(r1, ["competitor", "tech", "industry"]);
    assert.strictEqual(r1[0], "competitor");
    // 上海(policy) + 光伏发电(industry) → [0]=policy
    const r2 = resolvePurposeFromTitle("上海光伏发电规划发布", subjects);
    assert.deepStrictEqual(r2, ["policy", "industry"]);
    assert.strictEqual(r2[0], "policy");
  });

  it("标题零命中 → 空数组（不生成）", () => {
    assert.deepStrictEqual(resolvePurposeFromTitle("天气晴朗适合出行", subjects), []);
  });

  it("PURPOSE_PRIORITY 顺序固定为 竞争>技术>政策>行业", () => {
    assert.deepStrictEqual(PURPOSE_PRIORITY, ["competitor", "tech", "policy", "industry"]);
  });
});

describe("resolveMatchedPurposes", () => {
  const subjects = {
    competitor: ["解放汽车", "中国重汽"],
    tech: ["钠离子电池"],
    policy: ["工信部"],
    industry: ["核电", "电池"]
  };

  it("LLM 确认行业整体动态且标题含行业主体词 → 调整为 industry（所有初判生效）", () => {
    // competitor 初判（解放汽车），标题含行业词"核电"，LLM 确认行业整体 → industry
    assert.deepStrictEqual(
      resolveMatchedPurposes({ title: "解放汽车领衔核电装机创新高", subjectKeywordsByPurpose: subjects, isIndustryOverview: true }),
      ["industry"]
    );
    // tech 初判（钠离子电池），标题含行业词"电池"，LLM 确认行业整体 → industry
    assert.deepStrictEqual(
      resolveMatchedPurposes({ title: "钠离子电池行业出货量创新高", subjectKeywordsByPurpose: subjects, isIndustryOverview: true }),
      ["industry"]
    );
    // policy 初判（工信部），标题含行业词"电池"，LLM 确认行业整体 → industry
    assert.deepStrictEqual(
      resolveMatchedPurposes({ title: "工信部公布电池行业统计数据", subjectKeywordsByPurpose: subjects, isIndustryOverview: true }),
      ["industry"]
    );
  });

  it("LLM 确认行业整体但标题不含行业主体词 → 保持初判（避免无法高亮行业关键词）", () => {
    // 标题只有"解放汽车"（competitor 词），无行业词 → 即使 LLM 说行业整体也保持 competitor
    assert.deepStrictEqual(
      resolveMatchedPurposes({ title: "解放汽车销量创纪录", subjectKeywordsByPurpose: subjects, isIndustryOverview: true }),
      ["competitor"]
    );
  });

  it("LLM 确认针对企业动作 → 保持初判", () => {
    assert.deepStrictEqual(
      resolveMatchedPurposes({ title: "解放汽车发布新重卡", subjectKeywordsByPurpose: subjects, isIndustryOverview: false }),
      ["competitor"]
    );
  });

  it("标题无主体关键词 → 空数组（淘汰）", () => {
    assert.deepStrictEqual(
      resolveMatchedPurposes({ title: "无关内容", subjectKeywordsByPurpose: subjects, isIndustryOverview: false }),
      []
    );
  });
});
