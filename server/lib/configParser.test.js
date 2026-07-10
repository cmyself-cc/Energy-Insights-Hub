import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseJsonConfig, parseConfigFile } from "./configParser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, "fixtures/test-config.xlsx");

describe("configParser", () => {
  it("parses JSON config", () => {
    const payload = {
      excludeKeywords: ["培训班"],
      compositeRules: [{ mustInclude: ["中石油", "开业"], mustNotInclude: ["指数"] }],
      semanticPrompt: "排除会议资讯",
      categories: [{ name: "移动出行", description: "desc", inclusionPrompt: "prompt" }],
      sources: [{ name: "嘉实多", type: "wechat", identifier: "castrolchina" }]
    };
    const result = parseJsonConfig(payload);
    assert.strictEqual(result.excludeKeywords.length, 1);
    assert.strictEqual(result.compositeRules[0].must_include, JSON.stringify(["中石油", "开业"]));
    assert.strictEqual(result.compositeRules[0].must_exclude, JSON.stringify(["指数"]));
    assert.strictEqual(result.semanticPrompt, "排除会议资讯");
    assert.strictEqual(result.categories[0].name, "移动出行");
    assert.strictEqual(result.categories[0].inclusion_prompt, "prompt");
    assert.strictEqual(result.sources[0].type, "wechat");
    assert.strictEqual(result.sources[0].identifier, "castrolchina");
  });

  it("parses a JSON config file", () => {
    const payload = JSON.stringify({
      excludeKeywords: "培训班, 总裁班",
      compositeRules: [{ must_include: ["中石化"], must_exclude: ["售楼"] }]
    });
    const result = parseConfigFile(Buffer.from(payload), "config.json");
    assert.deepStrictEqual(result.excludeKeywords, ["培训班", "总裁班"]);
    assert.strictEqual(result.compositeRules[0].must_include, JSON.stringify(["中石化"]));
  });

  it("parses the fixture Excel file", () => {
    const buffer = fs.readFileSync(fixturePath);
    const result = parseConfigFile(buffer, "test-config.xlsx");

    assert.ok(result.excludeKeywords.includes("培训班"));
    assert.ok(!result.excludeKeywords.includes("不包含"));

    const composite = result.compositeRules.find(r =>
      JSON.parse(r.must_include).includes("中石油")
    );
    assert.ok(composite);
    assert.ok(JSON.parse(composite.must_include).includes("开业"));
    assert.ok(JSON.parse(composite.must_exclude).includes("指数"));

    assert.ok(result.semanticPrompt.length > 0);
    assert.ok(result.categories.some(c => c.name === "移动出行"));
    assert.ok(
      result.sources.some(
        s => s.name === "嘉实多" && s.type === "wechat" && s.identifier === "castrolchina"
      )
    );
  });
});
