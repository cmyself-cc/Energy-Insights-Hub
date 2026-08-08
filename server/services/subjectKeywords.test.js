import { describe, it, expect, beforeEach } from "vitest";
import db, { initDb } from "../db.js";
import { collectSubjectKeywordsByPurpose, allSubjectKeywords, titleContainsSubjectKeyword, PURPOSES } from "./filterRules.js";

describe("subject keyword helpers", () => {
  beforeEach(() => {
    initDb();
    db.exec("CREATE TABLE IF NOT EXISTS filter_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, name TEXT NOT NULL, must_include TEXT, must_exclude TEXT, active INTEGER DEFAULT 1, priority INTEGER DEFAULT 0, purpose TEXT DEFAULT '', aliases TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    db.exec("CREATE TABLE IF NOT EXISTS industry_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, keywords TEXT NOT NULL DEFAULT '[]', aliases TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    db.prepare("DELETE FROM filter_rules").run();
    db.prepare("DELETE FROM industry_categories").run();
  });

  const insertRule = (type, name, { active = 1, purpose = "", aliases = null } = {}) =>
    db.prepare("INSERT INTO filter_rules (type, name, active, priority, purpose, aliases) VALUES (?, ?, ?, 0, ?, ?)")
      .run(type, name, active, purpose, aliases);

  const insertIndustry = (name, keywords, { active = 1 } = {}) =>
    db.prepare("INSERT INTO industry_categories (name, keywords, active) VALUES (?, ?, ?)")
      .run(name, JSON.stringify(keywords), active);

  it("PURPOSES includes the new industry purpose", () => {
    expect(PURPOSES).toEqual(["competitor", "policy", "tech", "industry"]);
  });

  it("groups enterprise keywords by purpose; global rules apply to competitor/policy/tech", () => {
    insertRule("enterprise", "中国重汽", { purpose: "competitor" });
    insertRule("enterprise", "国家能源局", { purpose: "policy" });
    insertRule("enterprise", "钠离子电池", { purpose: "tech", aliases: JSON.stringify(["钠电"]) });
    insertRule("enterprise", "中石化", { purpose: "" }); // 全局 → 三类通用
    insertRule("include_keyword", "发布", { purpose: "competitor" }); // 动作词，排除
    insertRule("enterprise", "某停用公司", { purpose: "competitor", active: 0 }); // 停用，排除
    insertIndustry("核电", ["核电装机", "核电"]);
    insertIndustry("停用行业", ["不该出现"], { active: 0 });

    const byPurpose = collectSubjectKeywordsByPurpose();
    expect(byPurpose.competitor).toEqual(["中国重汽", "中石化"]);
    expect(byPurpose.policy).toEqual(["国家能源局", "中石化"]);
    expect(byPurpose.tech).toEqual(["钠离子电池", "中石化", "钠电"]);
    expect(byPurpose.industry).toEqual(["核电装机", "核电"]);
  });

  it("allSubjectKeywords returns de-duplicated union, longest first", () => {
    insertRule("enterprise", "中国重汽", { purpose: "competitor" });
    insertIndustry("核电", ["核电装机", "核电"]);

    const flat = allSubjectKeywords(collectSubjectKeywordsByPurpose());
    // 同长度按插入序；核心断言：去重 + 长度降序
    expect(flat).toHaveLength(3);
    expect(flat).toContain("核电装机");
    expect(flat.indexOf("核电")).toBe(flat.length - 1);
  });

  it("collectSubjectKeywordsByPurpose returns empty groups when nothing configured", () => {
    const byPurpose = collectSubjectKeywordsByPurpose();
    expect(Object.values(byPurpose).every(list => list.length === 0)).toBe(true);
  });

  it("titleContainsSubjectKeyword passes through when list is empty", () => {
    expect(titleContainsSubjectKeyword("任意标题", [])).toBe(true);
    expect(titleContainsSubjectKeyword("", [])).toBe(true);
  });

  it("titleContainsSubjectKeyword matches case-insensitively", () => {
    const kws = ["宁德时代", "CATL"];
    expect(titleContainsSubjectKeyword("宁德时代发布新一代电池", kws)).toBe(true);
    expect(titleContainsSubjectKeyword("catl announces new battery", kws)).toBe(true);
    expect(titleContainsSubjectKeyword("某行业产量创新高", kws)).toBe(false);
  });
});
