import { describe, it, expect } from "vitest";
import { SOURCE_TYPES } from "./taxonomy";

// 后端 /api/insights 的 sourceType 筛选是 `source_type = key` 精确等值匹配，
// 而 insights.source_type 实际写入的是中文标签（server/services/tracker.js 的
// SOURCE_TYPE_MAP：rss/website → "新闻门户"，wechat_mcp/wechat_album → "微信公众号"）。
// key 上多任何修饰（如 " / English" 后缀）都会让筛选恒空 —— 2026-10-21 生产审计实锤。
describe("SOURCE_TYPES 与后端 source_type 数据契约", () => {
  it("zh/en 两个语言版本的 option key（除 all 外）精确等于库值", () => {
    for (const lang of ["zh", "en"]) {
      const keys = SOURCE_TYPES[lang].filter((o) => o.key !== "all").map((o) => o.key);
      expect(keys).toEqual(["新闻门户", "微信公众号"]);
    }
  });

  it("all 选项仍在且排第一（默认不过滤）", () => {
    for (const lang of ["zh", "en"]) {
      expect(SOURCE_TYPES[lang][0].key).toBe("all");
    }
  });
});
