import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseJsonConfig, parseConfigFile } from "./configParser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, "fixtures/test-config.xlsx");

describe("configParser", () => {
  it("parses JSON config into the three-layer keyword structure", () => {
    const payload = {
      excludeKeywords: ["培训班"],
      enterpriseKeywords: ["中石油"],
      includeKeywords: ["开业"],
      semanticPrompt: "排除会议资讯",
      categories: [{ name: "移动出行", description: "desc", inclusionPrompt: "prompt" }],
      sources: [{ name: "嘉实多", type: "wechat", identifier: "castrolchina" }]
    };
    const result = parseJsonConfig(payload);
    expect(result.excludeKeywords).toEqual(["培训班"]);
    expect(result.enterpriseKeywords).toEqual(["中石油"]);
    expect(result.includeKeywords).toEqual(["开业"]);
    expect(result.semanticPrompt).toBe("排除会议资讯");
    expect(result.categories[0].name).toBe("移动出行");
    expect(result.categories[0].inclusion_prompt).toBe("prompt");
    expect(result.sources[0].type).toBe("wechat_mcp");
    expect(result.sources[0].identifier).toBe("castrolchina");
  });

  it("parses a JSON config file, splitting comma-separated keyword strings", () => {
    const payload = JSON.stringify({
      excludeKeywords: "培训班, 总裁班",
      enterpriseKeywords: ["中石化"],
      includeKeywords: ["合作"]
    });
    const result = parseConfigFile(Buffer.from(payload), "config.json");
    expect(result.excludeKeywords).toEqual(["培训班", "总裁班"]);
    expect(result.enterpriseKeywords).toEqual(["中石化"]);
    expect(result.includeKeywords).toEqual(["合作"]);
  });

  it("merges exclude keywords from both the 关键词过滤 and 底层过滤关键词 sheets", () => {
    const buffer = fs.readFileSync(fixturePath);
    const result = parseConfigFile(buffer, "test-config.xlsx");

    // 关键词过滤 sheet contributes 培训班 / 总裁班 / 公开课
    expect(result.excludeKeywords).toContain("培训班");
    // 底层过滤关键词 sheet's 排除词 column contributes 指数 / 售楼
    expect(result.excludeKeywords).toContain("指数");
    expect(result.excludeKeywords).toContain("售楼");
    // header row must be skipped, not treated as a keyword
    expect(result.excludeKeywords).not.toContain("关键词");
    expect(result.excludeKeywords).not.toContain("不包含");
  });

  it("parses the remaining sheets of the fixture Excel file", () => {
    const buffer = fs.readFileSync(fixturePath);
    const result = parseConfigFile(buffer, "test-config.xlsx");

    expect(result.enterpriseKeywords).toEqual(expect.arrayContaining(["中石油", "中石化"]));
    expect(result.includeKeywords).toContain("开业");
    expect(result.semanticPrompt.length).toBeGreaterThan(0);
    expect(result.categories.some(c => c.name === "移动出行")).toBe(true);
    expect(
      result.sources.some(
        s => s.name === "嘉实多" && s.type === "wechat_mcp" && s.identifier === "castrolchina"
      )
    ).toBe(true);
  });
});
