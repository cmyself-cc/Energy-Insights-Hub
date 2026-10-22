import { describe, it, expect, afterEach } from "vitest";
import db, { initDb } from "../db.js";
import { deduplicateItems } from "./dedup.js";

// dedup 性能优化（2026-10-22）的行为护栏：库内历史标题的 n-gram 签名改为一次性
// 预计算缓存，而不是每条候选比较时重复构建。此处钉死优化前后行为完全一致：
// 同归一化 URL 丢、库内模糊标题丢、本批内模糊标题丢、全新条目保留。

const MARK = "__dedup-test__";

function seedInsight({ title, url = null, daysAgo = 0 }) {
  const publish = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO insights (title, url, publish_date) VALUES (?, ?, ?)`
  ).run(`${MARK}${title}`, url, publish);
  return { title: `${MARK}${title}`, url };
}

afterEach(() => {
  initDb();
  db.prepare("DELETE FROM insights WHERE title LIKE ? OR url LIKE ?").run(`${MARK}%`, `%${MARK}%`);
});

describe("deduplicateItems — 行为护栏", () => {
  it("同归一化 URL（仅 utm 不同）被库内记录挡下", () => {
    seedInsight({ title: "甲新闻", url: "https://a.com/x" });
    const out = deduplicateItems(
      [{ title: "完全不同的标题乙", url: "https://a.com/x?utm_source=rss" }],
      { threshold: 0.85, lookbackDays: 30 }
    );
    expect(out).toEqual([]);
  });

  it("与库内标题模糊相似（≥0.85）被挡下", () => {
    seedInsight({ title: "国家能源局发布新型储能发展指导意见" });
    const out = deduplicateItems(
      [{ title: `${MARK}国家能源局印发新型储能发展指导意见`, url: "https://b.com/1" }],
      { threshold: 0.85, lookbackDays: 30 }
    );
    expect(out).toEqual([]);
  });

  it("本批内两条标题互相模糊相似，后者被挡下", () => {
    const out = deduplicateItems(
      [
        { title: `${MARK} Shell 发布润滑油新品`, url: "https://c.com/1" },
        { title: `${MARK} Shell 发布润滑油新产品`, url: "https://c.com/2" }
      ],
      { threshold: 0.85, lookbackDays: 30 }
    );
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://c.com/1");
  });

  it("全新条目保留；lookback 窗口外的库内记录不参与模糊比对", () => {
    seedInsight({ title: "旧闻标题甲", daysAgo: 90 });
    const out = deduplicateItems(
      [{ title: `${MARK}旧闻标题甲的近期相似标题`, url: "https://d.com/1" }],
      { threshold: 0.85, lookbackDays: 30 }
    );
    expect(out).toHaveLength(1);
  });

  it("无 URL 候选仅靠标题去重：完全同标题被挡", () => {
    const out = deduplicateItems(
      [
        { title: `${MARK}无链接独家新闻`, url: null },
        { title: `${MARK}无链接独家新闻`, url: null }
      ],
      { threshold: 0.85, lookbackDays: 30 }
    );
    expect(out).toHaveLength(1);
  });
});
