import { describe, it, expect } from "vitest";
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
    expect(keys).toEqual(["competitor,policy,tech", "tech"]);
    expect(groups.get("competitor,policy,tech").items.length).toBe(1);
    expect(groups.get("tech").items.length).toBe(2);
    expect(groups.get("tech").purposes).toEqual(["tech"]);
  });

  it("purpose 为空的源归入 __none__ 组", () => {
    const groups = buildPurposeGroups([item(3, "D")], sourceById);
    expect(groups.has("__none__")).toBeTruthy();
    expect(groups.get("__none__").purposes).toEqual([]);
  });

  it("sourceId 找不到源对象时兜底为 __none__", () => {
    const groups = buildPurposeGroups([item(999, "E")], sourceById);
    expect(groups.has("__none__")).toBeTruthy();
  });
});
