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
});
