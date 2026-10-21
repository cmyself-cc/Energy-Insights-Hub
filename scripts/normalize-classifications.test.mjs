import { describe, it, expect } from "vitest";
import { mapCategories, mapSourceType } from "./normalize-classifications.mjs";

// 2026-10-21 生产审计：categories JSON 里的孤儿值（业务筛选项表 business_categories 没有），
// 以及 source_type 里的历史值「网站」。映射口径：
//   · 氢能/CCUS/风电/风力发电/充电站 —— 同义或子域归并到既有选项（DOMAIN_KEYWORDS 里
//     「电力&氢能」本就覆盖风电，「移动出行」本就覆盖充电站）
//   · 化工/其他 —— 保留：化工由本脚本补进 business_categories 成为正式选项，其他无合适目标
//   · 网站 —— 旧版 tracker 写入值，现版 rss/website 均写「新闻门户」，归并之
describe("mapCategories", () => {
  it("孤立氢能并入电力&氢能", () => {
    expect(mapCategories(["氢能"])).toEqual(["电力&氢能"]);
  });

  it("合并后去重（氢能 + 电力&氢能 只留一个）", () => {
    expect(mapCategories(["氢能", "电力&氢能"])).toEqual(["电力&氢能"]);
  });

  it("CCUS 并入 CCS", () => {
    expect(mapCategories(["CCUS", "油气"])).toEqual(["CCS", "油气"]);
  });

  it("风电/风力发电并入电力&氢能，充电站并入移动出行", () => {
    expect(mapCategories(["风电"])).toEqual(["电力&氢能"]);
    expect(mapCategories(["风力发电"])).toEqual(["电力&氢能"]);
    expect(mapCategories(["充电站"])).toEqual(["移动出行"]);
  });

  it("化工与其他保留不动（化工由选项补录兜底，其他无目标）", () => {
    expect(mapCategories(["化工"])).toEqual(["化工"]);
    expect(mapCategories(["其他"])).toEqual(["其他"]);
  });

  it("未知名称原样保留且顺序稳定", () => {
    expect(mapCategories(["储能", "未来分类", "油气"])).toEqual(["储能", "未来分类", "油气"]);
  });
});

describe("mapSourceType", () => {
  it("历史值 网站 归并到 新闻门户", () => {
    expect(mapSourceType("网站")).toBe("新闻门户");
  });

  it("现值原样通过", () => {
    expect(mapSourceType("新闻门户")).toBe("新闻门户");
    expect(mapSourceType("微信公众号")).toBe("微信公众号");
  });
});
