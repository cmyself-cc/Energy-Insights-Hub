import { describe, it, expect } from "vitest";
import { stripBoilerplate, truncateAtSentence } from "./utils.js";

describe("stripBoilerplate", () => {
  it("returns empty string for empty input", () => {
    expect(stripBoilerplate("")).toBe("");
    expect(stripBoilerplate(null)).toBe("");
  });

  it("passes clean text through unchanged", () => {
    const text = "国家电网宣布启动新型电力系统示范区建设，覆盖多个省份。";
    expect(stripBoilerplate(text)).toBe(text);
  });

  it("removes leading share/subscribe toolbar tokens", () => {
    const out = stripBoilerplate("分享 订阅 投稿 我要投稿 某能源集团宣布重大投资计划，涉及多个项目。");
    expect(out).toBe("某能源集团宣布重大投资计划，涉及多个项目。");
  });

  it("removes leading breadcrumb navigation starting with 首页", () => {
    const out = stripBoilerplate("首页 > 新闻中心 > 储能要闻 > 正文内容从这里开始，介绍项目进展。");
    expect(out).toBe("正文内容从这里开始，介绍项目进展。");
  });

  it("removes leading 当前位置 breadcrumb", () => {
    const out = stripBoilerplate("当前位置：首页 > 资讯 > 项目正式开工，总投资超过百亿元。");
    expect(out).toBe("项目正式开工，总投资超过百亿元。");
  });

  it("cuts trailing next-chapter and view-more navigation", () => {
    const out = stripBoilerplate("项目顺利并网发电。 阅读下一章… 查看更多>");
    expect(out).toBe("项目顺利并网发电。");
  });

  it("cuts trailing QR-code prompts", () => {
    const out = stripBoilerplate("项目顺利并网发电。 扫码手机查看 或长按识别二维码关注微信号");
    expect(out).toBe("项目顺利并网发电。");
  });

  it("cuts trailing related-reading sections", () => {
    const out = stripBoilerplate("项目顺利并网发电。 相关阅读：另一篇文章标题");
    expect(out).toBe("项目顺利并网发电。");
  });

  it("removes source/author/editor bylines", () => {
    const out = stripBoilerplate("项目顺利并网发电。 来源：北极星电力网 作者：张三 责任编辑：李四");
    expect(out).toBe("项目顺利并网发电。");
  });
});

describe("truncateAtSentence", () => {
  it("returns short text unchanged", () => {
    expect(truncateAtSentence("短文本。", 200)).toBe("短文本。");
  });

  it("cuts at the last sentence punctuation within the limit", () => {
    const text = "第一句话内容。" + "填充内容。".repeat(50);
    const out = truncateAtSentence(text, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith("。")).toBe(true);
    expect(out.startsWith("第一句话内容。")).toBe(true);
  });

  it("hard-cuts at the limit when no sentence punctuation exists", () => {
    const text = "无标点内容".repeat(100);
    const out = truncateAtSentence(text, 100);
    expect(out.length).toBe(100);
  });

  it("defaults to a 200-character cap", () => {
    const text = "第二句话。" + "填充内容。".repeat(80);
    const out = truncateAtSentence(text);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith("。")).toBe(true);
  });
});
