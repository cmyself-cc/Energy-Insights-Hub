import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../lib/llmClient.js", () => ({ callLlmJson: vi.fn() }));

import db, { initDb } from "../db.js";
import { callLlmJson } from "../lib/llmClient.js";
import {
  SUBJECT_CATEGORIES, LEGACY_EVENT_CATEGORIES,
  applySubjectCategory, parseClassifications, backfillSubjectCategories
} from "./backfillSubjectCategories.js";

function insertInsight(title, summary, categories) {
  const info = db.prepare("INSERT INTO insights (title, summary, categories) VALUES (?, ?, ?)")
    .run(title, summary, JSON.stringify(categories));
  return info.lastInsertRowid;
}

describe("backfillSubjectCategories", () => {
  beforeEach(() => {
    initDb();
    db.prepare("DELETE FROM insights").run();
    callLlmJson.mockReset();
  });

  it("applySubjectCategory removes legacy event categories and appends a valid subject", () => {
    expect(applySubjectCategory(["储能", "战略合作", "项目"], "国有企业"))
      .toEqual(["储能", "国有企业"]);
  });

  it("applySubjectCategory keeps categories untouched when subject is empty or invalid", () => {
    expect(applySubjectCategory(["光伏", "收并购"], "")).toEqual(["光伏"]);
    // 只清除旧事件分类；其他未知分类原样保留
    expect(applySubjectCategory(["光伏", "中介"], "不存在的类型")).toEqual(["光伏", "中介"]);
  });

  it("applySubjectCategory does not duplicate an existing subject category", () => {
    expect(applySubjectCategory(["油气", "政府"], "政府")).toEqual(["油气", "政府"]);
  });

  it("parseClassifications accepts an array of {id, subject} and ignores invalid ids/subjects", () => {
    const map = parseClassifications(
      [{ id: 1, subject: "政府" }, { id: 2, subject: "随便写的" }, { id: 999, subject: "私营企业" }],
      new Set([1, 2])
    );
    expect(map.get(1)).toBe("政府");
    expect(map.get(2)).toBe("");
    expect(map.has(999)).toBe(false);
  });

  it("backfill updates stored categories: legacy events removed, subject added", async () => {
    const id1 = insertInsight("国资委发布央企重组方案", "多家央企整合", ["电力&氢能", "战略合作"]);
    const id2 = insertInsight("壳牌在华扩建润滑油基地", "外资扩产", ["润滑油"]);
    callLlmJson.mockResolvedValue([
      { id: id1, subject: "政府" },
      { id: id2, subject: "外国公司" }
    ]);

    const stats = await backfillSubjectCategories();

    expect(stats).toEqual({ processed: 2, updated: 2 });
    expect(JSON.parse(db.prepare("SELECT categories FROM insights WHERE id = ?").get(id1).categories))
      .toEqual(["电力&氢能", "政府"]);
    expect(JSON.parse(db.prepare("SELECT categories FROM insights WHERE id = ?").get(id2).categories))
      .toEqual(["润滑油", "外国公司"]);
  });

  it("backfill is idempotent and keeps rows whose subject cannot be determined", async () => {
    const id1 = insertInsight("行业整体增速放缓", "无明显主体", ["储能", "项目"]);
    callLlmJson.mockResolvedValue([{ id: id1, subject: "" }]);

    await backfillSubjectCategories();
    expect(JSON.parse(db.prepare("SELECT categories FROM insights WHERE id = ?").get(id1).categories))
      .toEqual(["储能"]);

    // second run: no legacy categories left, nothing to change
    callLlmJson.mockResolvedValue([{ id: id1, subject: "" }]);
    const stats = await backfillSubjectCategories();
    expect(stats.updated).toBe(0);
  });

  it("exposes the documented taxonomy constants", () => {
    expect(SUBJECT_CATEGORIES).toEqual(["政府", "国有企业", "外国公司", "私营企业", "研究机构"]);
    expect(LEGACY_EVENT_CATEGORIES).toEqual(["战略合作", "收并购", "项目"]);
  });
});
