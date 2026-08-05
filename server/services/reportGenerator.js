import db from "../db.js";
import { callLlm } from "../lib/llmClient.js";
import { webSearch } from "../lib/websearch.js";

let queueRunning = false;

function setJob(id, patch) {
  const cols = Object.entries(patch).map(([k]) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE report_jobs SET ${cols}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(...Object.values(patch), id);
}

export function createReportJob({ templateId, insightIds, resolutions = [] }) {
  const template = db.prepare("SELECT * FROM report_templates WHERE id = ?").get(templateId);
  if (!template) throw new Error("Template not found");
  const ids = (insightIds || []).map(Number).filter(Boolean);
  if (ids.length === 0) throw new Error("insightIds are required");
  const reportResult = db.prepare(
    "INSERT INTO reports (title, content, items, language, template_id, status) VALUES (?, ?, ?, ?, ?, 'generating')"
  ).run("报告生成中…", "", JSON.stringify(ids), template.language || "zh", templateId);
  const jobResult = db.prepare(
    "INSERT INTO report_jobs (report_id, template_id, status, phase, progress, insight_ids, screening) VALUES (?, ?, 'queued', 'queued', 0, ?, ?)"
  ).run(reportResult.lastInsertRowid, templateId, JSON.stringify(ids), JSON.stringify(resolutions || []));
  const job = db.prepare("SELECT * FROM report_jobs WHERE id = ?").get(jobResult.lastInsertRowid);
  return job;
}

export function getJob(id) {
  return db.prepare("SELECT * FROM report_jobs WHERE id = ?").get(id);
}

export function listJobs() {
  return db.prepare("SELECT * FROM report_jobs ORDER BY id DESC LIMIT 50").all();
}

export function retryJob(id) {
  const job = getJob(id);
  if (!job) throw new Error("Job not found");
  db.prepare("UPDATE report_jobs SET status='queued', phase='queued', progress=0, error=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  db.prepare("UPDATE reports SET status='generating', error=NULL WHERE id=?").run(job.report_id);
  return getJob(id);
}

function loadInsights(ids) {
  const placeholders = ids.map(() => "?").join(",");
  return db.prepare(`SELECT * FROM insights WHERE id IN (${placeholders}) AND hidden = 0`).all(...ids);
}

export async function runJob(job) {
  setJob(job.id, { status: "generating", phase: "searching", progress: 5 });
  try {
    const ids = JSON.parse(job.insight_ids || "[]");
    const template = db.prepare("SELECT * FROM report_templates WHERE id = ?").get(job.template_id);
    const insights = loadInsights(ids);
    if (insights.length === 0) throw new Error("No available insights for this report");
    const maxCards = template?.max_cards || 10;
    const selected = insights.slice(0, maxCards);

    const notes = [];
    const searchResults = [];
    for (let i = 0; i < selected.length; i++) {
      const ins = selected[i];
      const query = ins.keywords && ins.keywords !== "[]" && ins.keywords !== ""
        ? `${ins.title} ${ins.keywords}`
        : ins.title;
      try {
        const res = await webSearch(query, { maxResults: 5 });
        if (res === null) { notes.push("TAVILY_API_KEY 未配置，搜索降级为仅用卡片内容"); break; }
        if (res.length > 0) searchResults.push({ cardId: ins.id, title: ins.title, results: res });
      } catch (e) {
        notes.push(`卡片 ${ins.id} 搜索失败已跳过: ${e.message}`);
      }
      setJob(job.id, { progress: 5 + Math.round(((i + 1) / selected.length) * 45) });
    }
    if (searchResults.length === 0 && notes.length === 0) notes.push("未获取到搜索结果");

    setJob(job.id, { phase: "summarizing", progress: 60 });
    const insightsBlock = selected.map((ins, idx) => ({
      cardId: ins.id,
      编号: idx + 1,
      标题: ins.title,
      摘要: ins.summary,
      原文链接: ins.url,
      关键词: ins.keywords,
      来源: ins.source_name,
      日期: ins.publish_date,
      业务领域: ins.business_domain,
      企业类型: ins.enterprise_type
    }));
    const date = new Date().toISOString().slice(0, 10);
    const language = template?.language || "zh";
    const resolutions = JSON.parse(job.screening || "[]");
    const resolutionsBlock = Array.isArray(resolutions) && resolutions.length > 0
      ? JSON.stringify(resolutions, null, 2)
      : "无";
    const prompt = (template?.prompt || "请基于以下洞察卡片撰写报告：\n{{insights}}")
      .replaceAll("{{date}}", date)
      .replaceAll("{{language}}", language)
      .replaceAll("{{insights}}", JSON.stringify(insightsBlock, null, 2))
      .replaceAll("{{search_results}}", JSON.stringify(searchResults, null, 2))
      .replaceAll("{{resolutions}}", resolutionsBlock);
    const content = await callLlm([{ role: "user", content: prompt }], { maxTokens: 8192, timeoutMs: 180000 });

    const titleMatch = content.match(/^#\s+(.+)$/m) || content.split("\n").map(s => s.trim()).find(Boolean);
    const title = titleMatch ? (typeof titleMatch === "string" ? titleMatch : titleMatch[1]).slice(0, 80) : `报告 ${date}`;

    db.prepare("UPDATE reports SET title=?, content=?, status='done', template_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(title, content, template?.id ?? null, job.report_id);
    setJob(job.id, { status: "done", phase: "done", progress: 100, error: null, notes: notes.join("；") || null });
  } catch (e) {
    console.error("[report] job failed:", e);
    setJob(job.id, { status: "failed", phase: "failed", error: e.message });
    db.prepare("UPDATE reports SET status='failed', error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(e.message, job.report_id);
  }
}

export async function processQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    let job = db.prepare("SELECT * FROM report_jobs WHERE status = 'queued' ORDER BY id ASC LIMIT 1").get();
    while (job) {
      await runJob(job);
      job = db.prepare("SELECT * FROM report_jobs WHERE status = 'queued' ORDER BY id ASC LIMIT 1").get();
    }
  } finally {
    queueRunning = false;
  }
}

// 服务器启动后兜底：周期补跑遗留 queued 任务（重启恢复 + 队列遗漏）
export function startJobRunner() {
  const tick = () => processQueue().catch(err => console.error("[report] queue processing failed:", err));
  tick();
  setInterval(tick, 10000).unref?.();
}
