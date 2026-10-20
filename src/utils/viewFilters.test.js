import { describe, it, expect } from "vitest";
import { filtersToView, viewToFilters, isDrift } from "./viewFilters";

const FULL = {
  purposes: ["competitor", "policy"],
  businessCategory: "电力",
  subjectCategory: "all",
  enterpriseType: "all",
  sourceType: "rss",
  query: "储能",
  dateRange: "last7"
};

describe("filtersToView — App filters → 视角存储对象", () => {
  it("带上所有非默认维度，purposes 拼成逗号串", () => {
    expect(filtersToView(FULL)).toEqual({
      purposes: "competitor,policy",
      businessCategory: "电力",
      subjectCategory: undefined,
      enterpriseType: undefined,
      sourceType: "rss",
      search: "储能",
      dateRange: "last7"
    });
  });

  it("全默认维度 → 全 undefined（JSON 化后视角就是一个空对象）", () => {
    const v = filtersToView({
      purposes: [], businessCategory: "all", subjectCategory: "all",
      enterpriseType: "all", sourceType: "all", query: "", dateRange: "noLimit"
    });
    expect(JSON.parse(JSON.stringify(v))).toEqual({});
  });

  it("undefined/缺键输入不抛（稀疏 filters 对象）", () => {
    expect(() => filtersToView({})).not.toThrow();
    expect(filtersToView({})).toEqual({
      purposes: undefined, businessCategory: undefined, subjectCategory: undefined,
      enterpriseType: undefined, sourceType: undefined, search: undefined, dateRange: undefined
    });
  });
});

describe("viewToFilters — 视角存储对象 → App filters", () => {
  it("缺键一律落到「不筛选」语义", () => {
    expect(viewToFilters({})).toEqual({
      purposes: [], businessCategory: "all", subjectCategory: "all",
      enterpriseType: "all", sourceType: "all", query: "", dateRange: "noLimit"
    });
  });

  it("purposes 是逗号串时拆数组（含空段过滤）", () => {
    expect(viewToFilters({ purposes: "a,,b," }).purposes).toEqual(["a", "b"]);
  });

  it("JSON 往返后稳定：viewToFilters(filtersToView(x)) 再 filtersToView 不变", () => {
    const stored = JSON.parse(JSON.stringify(filtersToView(FULL)));
    const restored = filtersToView(viewToFilters(stored));
    expect(JSON.parse(JSON.stringify(restored))).toEqual(stored);
  });
});

describe("isDrift — 当前筛选是否偏离激活视角", () => {
  const VIEW = { purposes: "competitor", search: "储能", dateRange: "last7" };

  it("完全一致 → false（键顺序不同也算一致）", () => {
    expect(isDrift(VIEW, {
      purposes: ["competitor"], businessCategory: "all", subjectCategory: "all",
      enterpriseType: "all", sourceType: "all", query: "储能", dateRange: "last7"
    })).toBe(false);
    // 视角对象的键顺序不该影响判定
    expect(isDrift({ dateRange: "last7", search: "储能", purposes: "competitor" }, {
      purposes: ["competitor"], businessCategory: "all", subjectCategory: "all",
      enterpriseType: "all", sourceType: "all", query: "储能", dateRange: "last7"
    })).toBe(false);
  });

  it("改任一维度 → true", () => {
    const base = viewToFilters(VIEW);
    expect(isDrift(VIEW, { ...base, query: "氢能" })).toBe(true);
    expect(isDrift(VIEW, { ...base, purposes: ["policy"] })).toBe(true);
    expect(isDrift(VIEW, { ...base, dateRange: "last30" })).toBe(true);
    expect(isDrift(VIEW, { ...base, sourceType: "website" })).toBe(true);
  });

  it("空视角 vs 默认筛选 → true（视角=无筛选，默认筛选有 competitor/last30）", () => {
    expect(isDrift({}, {
      purposes: ["competitor"], businessCategory: "all", subjectCategory: "all",
      enterpriseType: "all", sourceType: "all", query: "", dateRange: "last30"
    })).toBe(true);
  });

  it("nil 视角安全（未激活视角时不该被调用，但防御 nil）", () => {
    expect(() => isDrift(null, FULL)).not.toThrow();
    expect(isDrift(null, FULL)).toBe(true);
  });
});
