import { describe, it, expect } from "vitest";
import { classifyEnergyMonolith, mapToLatestCategories } from "./reclassify-industries.mjs";

// 2026-10-21 第二轮：用户裁定行业分类以「内容过滤 → 行业初筛」（industry_categories）
// 为最新权威口径。电力&氢能这个旧合一标签要拆进初筛的新分类：
//   氢能（制氢/绿氢/氢燃料电池/加氢站…）＞ 储能（储能/电池/抽水蓄能…）＞
//   新能源（光伏/风电/可再生能源/清洁能源…）＞ 电力（兜底：电力/电网/电价…）
// 光伏并入新能源（初筛清单无光伏，新能源关键词含光伏发电）。其余标签不动。

describe("classifyEnergyMonolith", () => {
  it("氢能关键词命中 → 氢能", () => {
    expect(classifyEnergyMonolith("某集团绿氢项目开工，电解水制氢产能 2 万吨")).toBe("氢能");
    expect(classifyEnergyMonolith("加氢站网络扩建计划发布")).toBe("氢能");
  });

  it("储能关键词命中 → 储能", () => {
    expect(classifyEnergyMonolith("独立储能电站并网投运")).toBe("储能");
    expect(classifyEnergyMonolith("动力电池长时储能方案")).toBe("储能");
  });

  it("光伏/风电/可再生能源 → 新能源", () => {
    expect(classifyEnergyMonolith("光伏发电项目集中并网")).toBe("新能源");
    expect(classifyEnergyMonolith("风电装机容量创新高")).toBe("新能源");
    expect(classifyEnergyMonolith("可再生能源消纳政策出台")).toBe("新能源");
  });

  it("电力关键词 → 电力", () => {
    expect(classifyEnergyMonolith("电力现货市场基本规则征求意见")).toBe("电力");
    expect(classifyEnergyMonolith("智能电网改造提速")).toBe("电力");
  });

  it("无命中走兜底 → 电力", () => {
    expect(classifyEnergyMonolith("某公司发布年度报告")).toBe("电力");
  });

  it("优先级：氢能 > 储能 > 新能源 > 电力", () => {
    expect(classifyEnergyMonolith("绿氢制备与储能电站协同项目")).toBe("氢能");
    expect(classifyEnergyMonolith("储能电池配套光伏发电")).toBe("储能");
  });
});

describe("mapToLatestCategories", () => {
  it("电力&氢能 元素替换为拆分结果，其余保留", () => {
    expect(mapToLatestCategories(["电力&氢能", "油气"], "加氢站投运")).toEqual(["氢能", "油气"]);
    expect(mapToLatestCategories(["化工", "电力&氢能"], "电力市场新规")).toEqual(["化工", "电力"]);
  });

  it("光伏 并入 新能源", () => {
    expect(mapToLatestCategories(["光伏"], "光伏组件价格走势")).toEqual(["新能源"]);
    expect(mapToLatestCategories(["储能", "光伏"], "任何文本")).toEqual(["储能", "新能源"]);
  });

  it("合并后去重", () => {
    expect(mapToLatestCategories(["电力&氢能", "电力"], "无关文本")).toEqual(["电力"]);
    expect(mapToLatestCategories(["光伏", "新能源"], "任何文本")).toEqual(["新能源"]);
  });

  it("无关标签原样保留（含事件类与主体类）", () => {
    expect(mapToLatestCategories(["化工", "战略合作", "国有企业"], "任何文本"))
      .toEqual(["化工", "战略合作", "国有企业"]);
  });

  it("空数组原样返回", () => {
    expect(mapToLatestCategories([], "任何文本")).toEqual([]);
  });
});
