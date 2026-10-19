import { describe, it, expect } from "vitest";
import { resolvePerFeedLimit, resolveLookbackHours } from "./wechatMcpCrawler.js";

describe("resolvePerFeedLimit", () => {
  const base = { articleLimit: 20, feedCount: 25 };

  it("优先使用 config.perFeedLimit", () => {
    expect(
      resolvePerFeedLimit({ ...base, configPerFeedLimit: "15" })
    ).toBe(15);
  });

  it("config.perFeedLimit 非数字时回退到 1", () => {
    expect(
      resolvePerFeedLimit({ ...base, configPerFeedLimit: "abc" })
    ).toBe(1);
  });

  it("指定 feedId 时用 articleLimit", () => {
    expect(
      resolvePerFeedLimit({ ...base, feedId: "MP_WXS_123" })
    ).toBe(20);
  });

  it("未配置时使用全局 wechat_mcp_per_feed_limit 而非平均分配", () => {
    expect(
      resolvePerFeedLimit({ ...base, globalPerFeedLimit: 15 })
    ).toBe(15);
  });

  it("全局设置也缺失时才按 feed 数平均分配（向上取整）", () => {
    expect(
      resolvePerFeedLimit({ ...base, globalPerFeedLimit: undefined })
    ).toBe(1); // ceil(20/25)
    expect(
      resolvePerFeedLimit({ articleLimit: 30, feedCount: 10, globalPerFeedLimit: undefined })
    ).toBe(3); // ceil(30/10)
  });

  it("每源上限 × 源数量作为总返回上限（不被 articleLimit 固定截断）", () => {
    // 15/源 × 25 源 = 375，而不是 articleLimit=20
    const perFeed = resolvePerFeedLimit({ articleLimit: 20, feedCount: 25, globalPerFeedLimit: 15 });
    expect(perFeed).toBe(15);
    expect(perFeed * 25).toBe(375);
  });
});

describe("resolveLookbackHours", () => {
  it("与跟踪设置的时间窗口保持一致", () => {
    expect(resolveLookbackHours(24)).toBe(24);
    expect(resolveLookbackHours(168)).toBe(168);
  });

  it("设置缺失或非法时回退到默认值", () => {
    expect(resolveLookbackHours(undefined)).toBe(720);
    expect(resolveLookbackHours(0)).toBe(720);
    expect(resolveLookbackHours(NaN)).toBe(720);
  });
});
