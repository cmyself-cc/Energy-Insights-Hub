import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import db, { initDb } from "../db.js";
import reportRouter from "./reports.js";
import { listTemplates, seedReportTemplates } from "../services/reportTemplateService.js";
import { screenCards } from "../services/reportScreening.js";
import { createReportJob, getJob, retryJob } from "../services/reportGenerator.js";

vi.mock("../services/reportScreening.js", () => ({ screenCards: vi.fn(), clarifyCards: vi.fn() }));
vi.mock("../services/reportGenerator.js", () => ({
  createReportJob: vi.fn(), getJob: vi.fn(), listJobs: vi.fn(), retryJob: vi.fn(),
  startJobRunner: vi.fn(), processQueue: vi.fn(() => Promise.resolve())
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/reports", reportRouter);
  return app;
}
async function call(path, opts = {}) {
  const app = buildApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise(r => server.on("listening", r));
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/reports${path}`, { headers: { "Content-Type": "application/json" }, ...opts });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

describe("reports routes", () => {
  beforeEach(() => {
    initDb();
    db.prepare("DELETE FROM report_templates").run();
    db.prepare("DELETE FROM report_jobs").run();
    db.prepare("DELETE FROM reports").run();
    seedReportTemplates();
    screenCards.mockReset();
    createReportJob.mockReset();
  });

  it("lists seeded public templates", async () => {
    const { status, body } = await call("/templates");
    expect(status).toBe(200);
    expect(body.data.length).toBeGreaterThanOrEqual(3);
    expect(body.data[0].is_public).toBe(true);
  });

  it("creates a custom template", async () => {
    const { status, body } = await call("/templates", { method: "POST", body: JSON.stringify({ name: "自定义", prompt: "写报告" }) });
    expect(status).toBe(201);
    expect(body.data.name).toBe("自定义");
    expect(body.data.is_public).toBe(false);
  });

  it("rejects deleting a public template", async () => {
    const first = listTemplates()[0];
    const { status } = await call(`/templates/${first.id}`, { method: "DELETE" });
    expect(status).toBe(400);
  });

  it("runs screening and returns the plan", async () => {
    db.prepare("DELETE FROM insights WHERE id=11").run();
    db.prepare("INSERT INTO insights (id, title, summary, url, keywords) VALUES (11, 'T', 'S', 'https://a', 'k')").run();
    screenCards.mockResolvedValue({ questions: [], searchPlan: [], purpose: "日报", exceedsLimit: false });
    const { status, body } = await call("/screening", { method: "POST", body: JSON.stringify({ templateId: listTemplates()[0].id, insightIds: [11] }) });
    expect(status).toBe(200);
    expect(body.data.purpose).toBe("日报");
  });

  it("runs clarify and returns resolutions", async () => {
    db.prepare("DELETE FROM insights WHERE id=11").run();
    db.prepare("INSERT INTO insights (id, title, summary, url, keywords) VALUES (11, 'T', 'S', 'https://a', 'k')").run();
    const { clarifyCards: mockClarify } = await import("../services/reportScreening.js");
    mockClarify.mockResolvedValue({ questions: [], resolutions: [{ key: "q1", issue: "x", choice: "y", cardIds: [11] }], purpose: "日报", done: true });
    const { status, body } = await call("/clarify", { method: "POST", body: JSON.stringify({ templateId: listTemplates()[0].id, insightIds: [11], answers: [] }) });
    expect(status).toBe(200);
    expect(body.data.done).toBe(true);
    expect(body.data.resolutions).toHaveLength(1);
  });

  it("rejects screening without insightIds", async () => {
    const { status } = await call("/screening", { method: "POST", body: JSON.stringify({ templateId: 1, insightIds: [] }) });
    expect(status).toBe(400);
  });

  it("creates a generation job", async () => {
    createReportJob.mockReturnValue({ id: 99, status: "queued", report_id: 1 });
    const { status, body } = await call("/generate", { method: "POST", body: JSON.stringify({ templateId: 1, insightIds: [11], resolutions: [] }) });
    expect(status).toBe(201);
    expect(body.data.id).toBe(99);
  });

  it("returns job status and retries", async () => {
    getJob.mockReturnValue({ id: 1, status: "done" });
    retryJob.mockReturnValue({ id: 1, status: "queued" });
    expect((await call("/jobs/1")).body.data.status).toBe("done");
    expect((await call("/jobs/1/retry", { method: "POST" })).body.data.status).toBe("queued");
  });
});
