import { describe, it } from "node:test";
import assert from "node:assert";
import { buildPurposeGroups } from "./purposeGroups.js";

describe("buildPurposeGroups", () => {
  const sources = [
    { id: 1, purpose: "competitor,policy,tech" },
    { id: 2, purpose: "tech" },
    { id: 3, purpose: "" }
  ];
  const sourceById = new Map(sources.map(s => [s.id, s]));

  const item = (sourceId, title) => ({ sourceId, title, source: "公众号名/源名" });

  it("按源 purpose 分组（sourceId 反查），不依赖 item.source 字符串", () => {
    const groups = buildPurposeGroups(
      [item(1, "A"), item(2, "B"), item(2, "C")],
      sourceById
    );
    const keys = [...groups.keys()].sort();
    assert.deepStrictEqual(keys, ["competitor,policy,tech", "tech"]);
    assert.strictEqual(groups.get("competitor,policy,tech").items.length, 1);
    assert.strictEqual(groups.get("tech").items.length, 2);
    assert.deepStrictEqual(groups.get("tech").purposes, ["tech"]);
  });

  it("purpose 为空的源归入 __none__ 组", () => {
    const groups = buildPurposeGroups([item(3, "D")], sourceById);
    assert.ok(groups.has("__none__"));
    assert.deepStrictEqual(groups.get("__none__").purposes, []);
  });

  it("sourceId 找不到源对象时兜底为 __none__", () => {
    const groups = buildPurposeGroups([item(999, "E")], sourceById);
    assert.ok(groups.has("__none__"));
  });
});
