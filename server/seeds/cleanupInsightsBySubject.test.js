import { describe, it, expect } from "vitest";
import { evaluateInsight } from "./cleanupInsightsBySubject.js";

const byPurpose = {
  competitor: ["中国重汽", "宁德时代"],
  policy: ["国家能源局"],
  tech: ["钠离子电池"],
  industry: ["核电装机", "光伏"]
};

describe("evaluateInsight", () => {
  it("drops cards whose title contains no subject keyword", () => {
    expect(evaluateInsight("某公司发布重大消息", ["competitor"], byPurpose)).toEqual({ action: "drop" });
  });

  it("keeps purposes that match title keywords", () => {
    const r = evaluateInsight("中国重汽发布新款重卡", ["competitor", "tech"], byPurpose);
    expect(r.action).toBe("keep");
    expect(r.purposes).toEqual(["competitor"]);
    expect(r.changed).toBe(true);
  });

  it("rebuilds purposes from title categories when intersection is empty", () => {
    const r = evaluateInsight("国家能源局印发新版管理办法", ["competitor"], byPurpose);
    expect(r.action).toBe("keep");
    expect(r.purposes).toEqual(["policy"]);
    expect(r.changed).toBe(true);
  });

  it("keeps unchanged when purposes already align", () => {
    const r = evaluateInsight("全国核电装机创新高", ["industry"], byPurpose);
    expect(r.action).toBe("keep");
    expect(r.purposes).toEqual(["industry"]);
    expect(r.changed).toBe(false);
  });

  it("keeps exactly one purpose even when several align", () => {
    const r = evaluateInsight("宁德时代钠离子电池量产", ["competitor", "tech"], byPurpose);
    expect(r.purposes).toEqual(["competitor"]); // 取对齐后的第一个
    expect(r.changed).toBe(true);
  });

  it("rebuilds to the first title category when nothing aligns", () => {
    const r = evaluateInsight("宁德时代钠离子电池量产", ["industry"], byPurpose);
    expect(r.purposes).toEqual(["competitor"]); // PURPOSES 顺序中第一个命中的类别
    expect(r.changed).toBe(true);
  });

  it("prefers policy over industry when a policy issuer appears in the title", () => {
    const r = evaluateInsight("浙江发布分布式光伏管理细则", ["industry"], {
      ...byPurpose,
      policy: ["浙江"]
    });
    expect(r.purposes).toEqual(["policy"]);
    expect(r.changed).toBe(true);
  });
});
