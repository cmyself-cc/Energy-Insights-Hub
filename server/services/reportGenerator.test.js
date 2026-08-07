import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/llmClient.js", () => ({ callLlm: vi.fn(), callLlmJson: vi.fn() }));
vi.mock("../lib/websearch.js", () => ({ webSearch: vi.fn() }));

import db, { initDb } from "../db.js";
import { createReportJob, getJob, retryJob, runJob, processQueue } from "./reportGenerator.js";
import { callLlm, callLlmJson } from "../lib/llmClient.js";
import { webSearch } from "../lib/websearch.js";

function seedTemplateAndInsight() {
  db.prepare("INSERT INTO report_templates (id, name, prompt, max_cards, is_public, language) VALUES (1, 'T', '用卡片写报告 {{insights}} {{search_results}} {{resolutions}} {{purpose}} {{audience}} {{theme}}', 5, 1, 'zh')").run();
  db.prepare("INSERT INTO insights (id, title, summary, url, keywords) VALUES (11, '光伏装机创新高', '50GW', 'https://a', '光伏')").run();
}

describe("reportGenerator", () => {
  beforeEach(() => {
    initDb();
    db.prepare("DELETE FROM report_templates").run();
    db.prepare("DELETE FROM report_jobs").run();
    db.prepare("DELETE FROM reports").run();
    db.prepare("DELETE FROM insights WHERE id=11").run();
    callLlm.mockReset(); callLlmJson.mockReset(); webSearch.mockReset();
    seedTemplateAndInsight();
  });

  it("creates a generating report draft and a queued job", () => {
    const job = createReportJob({ templateId: 1, insightIds: [11], resolutions: [] });
    expect(job.status).toBe("queued");
    const report = db.prepare("SELECT * FROM reports WHERE id = ?").get(job.report_id);
    expect(report.status).toBe("generating");
  });

  it("injects purpose, audience and theme into the prompt", async () => {
    webSearch.mockResolvedValue(null);
    callLlm.mockResolvedValue("# 报告");
    const job = createReportJob({ templateId: 1, insightIds: [11], resolutions: [], purpose: "内部学习", audience: "管理层", theme: "光伏消纳压力" });
    await runJob(job);
    expect(getJob(job.id).status).toBe("done");
    expect(callLlm.mock.calls[0][0][0].content).toContain("内部学习");
    expect(callLlm.mock.calls[0][0][0].content).toContain("管理层");
    expect(callLlm.mock.calls[0][0][0].content).toContain("光伏消纳压力");
  });

  it("still reads legacy array-form screening (backward compatible)", async () => {
    db.prepare("UPDATE report_jobs SET screening = ? WHERE id = ?").run(JSON.stringify([{ issue: "x", choice: "y", cardIds: [11] }]), createReportJob({ templateId: 1, insightIds: [11], resolutions: [] }).id);
    webSearch.mockResolvedValue(null);
    callLlm.mockResolvedValue("# 报告");
    await processQueue();
    expect(callLlm.mock.calls[0][0][0].content).toContain("y");
  });

  it("runs a job to completion and saves the report", async () => {
    webSearch.mockResolvedValue([{ title: "S1", url: "https://s1", content: "补充" }]);
    callLlm.mockResolvedValue("# 光伏要闻\n\n## 概况\n正文内容");
    const job = createReportJob({ templateId: 1, insightIds: [11], resolutions: [] });
    await runJob(job);
    const done = getJob(job.id);
    expect(done.status).toBe("done");
    expect(done.phase).toBe("done");
    expect(done.progress).toBe(100);
    const report = db.prepare("SELECT * FROM reports WHERE id = ?").get(job.report_id);
    expect(report.status).toBe("done");
    expect(report.content).toContain("光伏要闻");
    expect(report.template_id).toBe(1);
    expect(callLlm.mock.calls[0][0][0].content).toContain("光伏装机创新高");
  });

  it("degrades gracefully when search is unavailable", async () => {
    webSearch.mockResolvedValue(null);
    callLlm.mockResolvedValue("# 报告");
    const job = createReportJob({ templateId: 1, insightIds: [11], resolutions: [] });
    await runJob(job);
    expect(getJob(job.id).status).toBe("done");
    expect(getJob(job.id).notes).toContain("降级");
  });

  it("marks failed jobs with error and supports retry", async () => {
    callLlm.mockRejectedValue(new Error("boom"));
    const job = createReportJob({ templateId: 1, insightIds: [11], resolutions: [] });
    await runJob(job);
    const failed = getJob(job.id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("boom");
    callLlm.mockResolvedValue("# ok");
    retryJob(job.id);
    const queued = getJob(job.id);
    expect(queued.status).toBe("queued");
    expect(queued.error).toBeNull();
    await processQueue();
    expect(getJob(job.id).status).toBe("done");
  });

  it("processQueue drains queued jobs serially in order", async () => {
    callLlm.mockResolvedValue("# r");
    createReportJob({ templateId: 1, insightIds: [11], resolutions: [] });
    createReportJob({ templateId: 1, insightIds: [11], resolutions: [] });
    await processQueue();
    const jobs = db.prepare("SELECT status FROM report_jobs ORDER BY id").all();
    expect(jobs[0].status).toBe("done");
    expect(jobs[1].status).toBe("done");
  });
});
