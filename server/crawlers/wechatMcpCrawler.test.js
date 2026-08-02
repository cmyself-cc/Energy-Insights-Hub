import { describe, it } from "node:test";
import assert from "node:assert";
import { resolvePerFeedLimit } from "./wechatMcpCrawler.js";

describe("resolvePerFeedLimit", () => {
  const base = { articleLimit: 20, feedCount: 25 };

  it("优先使用 config.perFeedLimit", () => {
    assert.strictEqual(
      resolvePerFeedLimit({ ...base, configPerFeedLimit: "15" }),
      15
    );
  });

  it("config.perFeedLimit 非数字时回退到 1", () => {
    assert.strictEqual(
      resolvePerFeedLimit({ ...base, configPerFeedLimit: "abc" }),
      1
    );
  });

  it("指定 feedId 时用 articleLimit", () => {
    assert.strictEqual(
      resolvePerFeedLimit({ ...base, feedId: "MP_WXS_123" }),
      20
    );
  });

  it("未配置时使用全局 wechat_mcp_per_feed_limit 而非平均分配", () => {
    assert.strictEqual(
      resolvePerFeedLimit({ ...base, globalPerFeedLimit: 15 }),
      15
    );
  });

  it("全局设置也缺失时才按 feed 数平均分配（向上取整）", () => {
    assert.strictEqual(
      resolvePerFeedLimit({ ...base, globalPerFeedLimit: undefined }),
      1 // ceil(20/25)
    );
    assert.strictEqual(
      resolvePerFeedLimit({ articleLimit: 30, feedCount: 10, globalPerFeedLimit: undefined }),
      3 // ceil(30/10)
    );
  });

  it("每源上限 × 源数量作为总返回上限（不被 articleLimit 固定截断）", () => {
    // 15/源 × 25 源 = 375，而不是 articleLimit=20
    const perFeed = resolvePerFeedLimit({ articleLimit: 20, feedCount: 25, globalPerFeedLimit: 15 });
    assert.strictEqual(perFeed, 15);
    assert.strictEqual(perFeed * 25, 375);
  });
});
