# 报告生成功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在市场洞察中勾选 insights 卡片 → 选择模板（公用/自定义）→ LLM 预筛查（动态选项澄清不一致）→ 异步任务（Tavily websearch + LLM 总结）生成 Markdown 报告；报告页统一管理与模板管理。

**Architecture:** 单机 Node + Express + better-sqlite3。新增 `report_templates`/`report_jobs` 表与 `reports` 加列；服务层新增 `lib/llmClient.js`（统一 LLM 调用，非 anthropic 自动 `thinking:{type:"disabled"}`）、`lib/websearch.js`（Tavily 封装，无 key 降级）、`services/reportTemplateService.js`、`services/reportScreening.js`、`services/reportGenerator.js`（job 状态机 + 串行队列）；路由扩展 `routes/reports.js`；前端新增 `ReportGeneratorModal.jsx`，升级 `ReportsPage.jsx`（状态徽标 + 模板管理视图）。

**Tech Stack:** Node 22 ESM、Express、better-sqlite3、vitest、React（vite）、marked。

## Global Constraints

- 测试：新测试全部用 vitest（NODE_ENV=test 隔离 test 库）；每个任务先 RED 后 GREEN。
- 路径含空格：项目根 `/Users/cmyself/Live Projects/Energy Insights Hub`，命令必须引号。
- LLM 调用：非 anthropic 一律 `body.thinking = { type: "disabled" }`；JSON 解析失败抛可读错误（不得裸抛 "Unexpected end of JSON input"）。
- 不引入新依赖；不修改 llmProcessor.js / feedbackSuggestionGenerator.js（保持既有行为）。
- 中文文案与现有 i18n 风格一致（zh/en 双份）。
- 提交信息前缀：`feat(report): ...`。

---

### Task 1: 迁移 + 模板服务（CRUD + seed）

**Files:**
- Create: `server/migrations/019_report_templates.sql`
- Create: `server/services/reportTemplateService.js`
- Create: `server/services/reportTemplateService.test.js`
- Modify: `server/index.js`（seed 调用）

**Interfaces:**
- Produces: `listTemplates()` → rows（`is_public` 转 bool）；`createTemplate({name, description, purpose, prompt, max_cards, language, is_public})` → row；`updateTemplate(id, data)` → row；`deleteTemplate(id)`；`seedReportTemplates()`（表空时插入内置模板，幂等）；常量 `DEFAULT_TEMPLATES`。

- [ ] **Step 1: 写迁移文件**

`server/migrations/019_report_templates.sql`：
```sql
CREATE TABLE IF NOT EXISTS report_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  purpose TEXT DEFAULT '',
  prompt TEXT NOT NULL,
  max_cards INTEGER DEFAULT 10,
  is_public INTEGER DEFAULT 1,
  language TEXT DEFAULT 'zh',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS report_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER,
  template_id INTEGER,
  status TEXT DEFAULT 'queued',
  phase TEXT DEFAULT 'queued',
  progress INTEGER DEFAULT 0,
  error TEXT,
  insight_ids TEXT,
  screening TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE reports ADD COLUMN template_id INTEGER;
ALTER TABLE reports ADD COLUMN status TEXT DEFAULT 'done';
ALTER TABLE reports ADD COLUMN error TEXT;
```

- [ ] **Step 2: 写失败测试**

`server/services/reportTemplateService.test.js`：
```js
import { describe, it, expect, beforeEach } from "vitest";
import db, { initDb } from "../db.js";
import { listTemplates, createTemplate, updateTemplate, deleteTemplate, seedReportTemplates, DEFAULT_TEMPLATES } from "./reportTemplateService.js";

describe("reportTemplateService", () => {
  beforeEach(() => {
    initDb();
    db.prepare("DELETE FROM report_templates").run();
  });

  it("seeds default templates only when the table is empty (idempotent)", () => {
    seedReportTemplates();
    const first = listTemplates().length;
    expect(first).toBe(DEFAULT_TEMPLATES.length);
    seedReportTemplates();
    expect(listTemplates().length).toBe(first);
  });

  it("creates, updates and deletes a custom template", () => {
    const created = createTemplate({ name: "测试模板", prompt: "编写报告", max_cards: 5, is_public: 0 });
    expect(created.id).toBeGreaterThan(0);
    expect(created.is_public).toBe(0);
    const updated = updateTemplate(created.id, { name: "测试模板2", prompt: "新提示词" });
    expect(updated.name).toBe("测试模板2");
    expect(listTemplates().some(t => t.id === created.id && t.name === "测试模板2")).toBe(true);
    deleteTemplate(created.id);
    expect(listTemplates().some(t => t.id === created.id)).toBe(false);
  });

  it("default templates are public and carry max_cards", () => {
    seedReportTemplates();
    const templates = listTemplates();
    expect(templates.every(t => t.is_public === 1)).toBe(true);
    expect(templates.every(t => t.max_cards > 0)).toBe(true);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `cd "/Users/cmyself/Live Projects/Energy Insights Hub" && NODE_ENV=test npx vitest run server/services/reportTemplateService.test.js`
Expected: FAIL（模块不存在 / 表不存在）

- [ ] **Step 4: 实现服务**

`server/services/reportTemplateService.js`：
```js
import db from "../db.js";

export const DEFAULT_TEMPLATES = [
  {
    name: "每日能源要闻日报",
    description: "汇总选中的能源行业新闻，按主题整理成一份每日要闻简报。",
    purpose: "面向团队日常晨会，快速掌握当日行业动态",
    language: "zh",
    max_cards: 10,
    prompt: `你是能源行业情报分析师。请根据提供的洞察卡片与搜索结果，撰写一份《每日能源要闻日报》。
要求：
1. 开头给出 1 段 80-120 字的总体概况；
2. 按主题/业务领域分组（如 电力/氢能/化工/生物燃料），每组列出要点；
3. 每条要点标注对应的卡片编号与来源名称；
4. 搜索补充的信息以「补充信息」小节单独列出，注明来源链接；
5. 结尾给出 3-5 条趋势观察或关注建议；
6. 使用 Markdown 排版（标题/列表/加粗），输出语言：{{language}}。
今日日期：{{date}}`
  },
  {
    name: "竞争对手动态简报",
    description: "聚焦竞争对手的近期动态、战略与产品信息。",
    purpose: "竞品跟踪：关注重点企业的战略、产品、投资动态",
    language: "zh",
    max_cards: 8,
    prompt: `你是企业情报分析师。请围绕选中的企业/主体，结合卡片与搜索结果，撰写《竞争对手动态简报》。
要求：
1. 按企业分节，每节包含：近期动态、战略意图、对我方的影响；
2. 卡片数据与搜索信息相互印证，不一致处按用户处理决定标注；
3. 明确区分「来自已选卡片」与「来自外部搜索补充」；
4. 结尾输出竞争格局小结（3-5 条）；
5. 使用 Markdown 排版，输出语言：{{language}}。
日期：{{date}}`
  },
  {
    name: "政策与行业跟踪",
    description: "跟踪政策变化与行业趋势，输出结构化跟踪报告。",
    purpose: "政策/行业趋势跟踪：适用于月度政策梳理或行业观察",
    language: "zh",
    max_cards: 6,
    prompt: `你是产业政策研究员。请基于卡片与搜索结果撰写《政策与行业跟踪报告》。
要求：
1. 先列出涉及的政策/行业主题清单；
2. 每个主题小节：现状描述、最新动态（含搜索补充）、影响分析；
3. 数据冲突按用户处理决定处理并标注；
4. 结尾给出风险提示与前瞻判断（3-5 条）；
5. 使用 Markdown 排版，输出语言：{{language}}。
日期：{{date}}`
  }
];

function parseRow(row) {
  if (!row) return row;
  return { ...row, is_public: row.is_public === 1 };
}

export function listTemplates() {
  return db.prepare("SELECT * FROM report_templates ORDER BY is_public DESC, id ASC").all().map(parseRow);
}

export function createTemplate(data) {
  const { name, description = "", purpose = "", prompt, max_cards = 10, language = "zh", is_public = 0 } = data;
  if (!name || !prompt) throw new Error("name and prompt are required");
  const result = db.prepare(
    "INSERT INTO report_templates (name, description, purpose, prompt, max_cards, is_public, language) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(String(name), String(description), String(purpose), String(prompt), Number(max_cards) || 10, is_public ? 1 : 0, String(language));
  const row = db.prepare("SELECT * FROM report_templates WHERE id = ?").get(result.lastInsertRowid);
  return parseRow(row);
}

export function updateTemplate(id, data) {
  const existing = db.prepare("SELECT * FROM report_templates WHERE id = ?").get(id);
  if (!existing) throw new Error("Template not found");
  const { name, description, purpose, prompt, max_cards, language } = data;
  db.prepare(
    `UPDATE report_templates SET
       name = ?, description = ?, purpose = ?, prompt = ?,
       max_cards = ?, language = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    name ?? existing.name,
    description ?? existing.description,
    purpose ?? existing.purpose,
    prompt ?? existing.prompt,
    max_cards !== undefined ? Number(max_cards) || existing.max_cards : existing.max_cards,
    language ?? existing.language,
    id
  );
  return parseRow(db.prepare("SELECT * FROM report_templates WHERE id = ?").get(id));
}

export function deleteTemplate(id) {
  const row = db.prepare("SELECT is_public FROM report_templates WHERE id = ?").get(id);
  if (!row) throw new Error("Template not found");
  if (row.is_public === 1) throw new Error("Public templates cannot be deleted");
  db.prepare("DELETE FROM report_templates WHERE id = ?").run(id);
  return { success: true };
}

export function seedReportTemplates() {
  const count = db.prepare("SELECT COUNT(*) c FROM report_templates").get().c;
  if (count > 0) return;
  const insert = db.prepare(
    "INSERT INTO report_templates (name, description, purpose, prompt, max_cards, is_public, language) VALUES (?, ?, ?, ?, ?, 1, ?)"
  );
  const tx = db.transaction((templates) => {
    for (const t of templates) insert.run(t.name, t.description, t.purpose, t.prompt, t.max_cards, t.language);
  });
  tx(DEFAULT_TEMPLATES);
}
```

- [ ] **Step 5: 接线 seed**

`server/index.js`：在现有 seed 导入区加 `import { seedReportTemplates } from "./services/reportTemplateService.js";`，并在 `seedDefaults();` 后加 `seedReportTemplates();`。

- [ ] **Step 6: 运行确认通过 + 提交**

Run: `NODE_ENV=test npx vitest run server/services/reportTemplateService.test.js` → PASS
```bash
git add server/migrations/019_report_templates.sql server/services/reportTemplateService.js server/services/reportTemplateService.test.js server/index.js
git commit -m "feat(report): templates table + CRUD service with default seeds"
```

---

### Task 2: llmClient 统一 LLM 调用

**Files:**
- Create: `server/lib/llmClient.js`
- Create: `server/lib/llmClient.test.js`

**Interfaces:**
- Produces: `callLlm(messages, { maxTokens = 4000, temperature = 0.3, timeoutMs = 120000 } = {})` → `Promise<string>`（已去 markdown fence、trim）；`callLlmJson(messages, opts)` → `Promise<any>`（JSON.parse，失败抛可读错误含预览）。
- Consumes: `fetchWithTimeout` from `../crawlers/utils.js`；`process.env.LLM_PROVIDER/LLM_BASE_URL/LLM_MODEL/LLM_API_KEY`。

- [ ] **Step 1: 写失败测试**

`server/lib/llmClient.test.js`（vi.mock `../crawlers/utils.js` 的 fetchWithTimeout，模式同 feedbackSuggestionGenerator.test.js）：
```js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("../crawlers/utils.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchWithTimeout: vi.fn() };
});
import { callLlm, callLlmJson } from "./llmClient.js";
import { fetchWithTimeout } from "../crawlers/utils.js";

describe("llmClient", () => {
  const originalApiKey = process.env.LLM_API_KEY;
  beforeEach(() => { process.env.LLM_API_KEY = "test-key"; fetchWithTimeout.mockReset(); });
  afterEach(() => { if (originalApiKey === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = originalApiKey; });

  it("sends thinking disabled on the openai-compatible path", async () => {
    fetchWithTimeout.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) });
    await callLlm([{ role: "user", content: "hi" }]);
    const body = JSON.parse(fetchWithTimeout.mock.calls[0][1].body);
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("returns trimmed content and strips markdown fences", async () => {
    fetchWithTimeout.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: "```json\n{\"a\":1}\n```" } }] }) });
    expect(await callLlm([{ role: "user", content: "x" }])).toBe('{"a":1}');
  });

  it("callLlmJson parses valid JSON", async () => {
    fetchWithTimeout.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '[{"x":1}]' } }] }) });
    expect(await callLlmJson([{ role: "user", content: "x" }])).toEqual([{ x: 1 }]);
  });

  it("callLlmJson throws a readable error on invalid JSON", async () => {
    fetchWithTimeout.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: "not json" } }] }) });
    await expect(callLlmJson([{ role: "user", content: "x" }])).rejects.toThrow(/invalid json/i);
  });
});
```

- [ ] **Step 2: 运行确认失败** → FAIL（模块不存在）
- [ ] **Step 3: 实现**

`server/lib/llmClient.js`：
```js
import { fetchWithTimeout } from "../crawlers/utils.js";

function buildConfig() {
  return {
    providerId: process.env.LLM_PROVIDER || "openai",
    baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
    modelId: process.env.LLM_MODEL || "gpt-4o-mini",
    apiKey: process.env.LLM_API_KEY
  };
}

export async function callLlm(messages, { maxTokens = 4000, temperature = 0.3, timeoutMs = 120000 } = {}) {
  const config = buildConfig();
  if (!config.apiKey) throw new Error("LLM API key not configured");
  const isAnthropic = config.providerId === "anthropic";
  const url = isAnthropic ? `${config.baseUrl}/messages` : `${config.baseUrl}/chat/completions`;
  const headers = isAnthropic
    ? { "Content-Type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" }
    : { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` };
  const body = { model: config.modelId, messages, max_tokens: maxTokens, temperature };
  if (!isAnthropic) body.thinking = { type: "disabled" };

  const response = await fetchWithTimeout(url, { method: "POST", headers, body: JSON.stringify(body) }, timeoutMs);
  if (!response.ok) {
    let detail = "";
    try { const j = await response.json(); detail = j?.error?.message || JSON.stringify(j).slice(0, 200); } catch { /* ignore */ }
    throw new Error(`LLM API failed: ${response.status} ${detail}`);
  }
  const data = await response.json();
  const raw = isAnthropic
    ? (data.content?.[0]?.text || "")
    : (data.choices?.[0]?.message?.content || "");
  return String(raw).replace(/```json\s*|\s*```/g, "").trim();
}

export async function callLlmJson(messages, opts = {}) {
  const txt = await callLlm(messages, { ...opts, temperature: opts.temperature ?? 0.1 });
  try {
    return JSON.parse(txt);
  } catch (e) {
    throw new Error(`LLM returned invalid JSON (${e.message}). Raw preview: ${txt.slice(0, 120)}`);
  }
}
```

- [ ] **Step 4: 运行确认通过 + 提交** → PASS
```bash
git add server/lib/llmClient.js server/lib/llmClient.test.js
git commit -m "feat(report): shared llmClient with thinking disabled + json helper"
```

---

### Task 3: websearch（Tavily 封装，无 key 降级）

**Files:**
- Create: `server/lib/websearch.js`
- Create: `server/lib/websearch.test.js`

**Interfaces:**
- Produces: `webSearch(query, { maxResults = 5, days = 14 } = {})` → `Promise<Array<{title, url, content}> | null>`；无 `TAVILY_API_KEY` 返回 `null`；失败抛错（调用方捕获降级）。

- [ ] **Step 1: 写失败测试**（mock 全局 fetch）

```js
import { describe, it, expect, vi, afterEach } from "vitest";
import { webSearch } from "./websearch.js";

describe("webSearch", () => {
  const originalKey = process.env.TAVILY_API_KEY;
  const originalFetch = global.fetch;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = originalKey;
    global.fetch = originalFetch;
  });

  it("returns null when TAVILY_API_KEY is not configured", async () => {
    delete process.env.TAVILY_API_KEY;
    expect(await webSearch("氢能 政策")).toBeNull();
  });

  it("calls tavily and returns title/url/content results", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ title: "A", url: "https://a.com", content: "body" }] })
    });
    const results = await webSearch("氢能 政策");
    expect(results).toEqual([{ title: "A", url: "https://a.com", content: "body" }]);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.query).toBe("氢能 政策");
    expect(body.max_results).toBe(5);
  });
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**

`server/lib/websearch.js`：
```js
const TAVILY_URL = "https://api.tavily.com/search";

export async function webSearch(query, { maxResults = 5, days = 14 } = {}) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const response = await fetch(TAVILY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: String(query),
      search_depth: "advanced",
      include_answer: false,
      include_domains: [],
      max_results: maxResults
    })
  });
  if (!response.ok) throw new Error(`Tavily search failed: ${response.status}`);
  const data = await response.json();
  return (data.results || []).map(r => ({
    title: r.title || "",
    url: r.url || "",
    content: r.content || ""
  }));
}
```

- [ ] **Step 4: 运行确认通过 + 提交**
```bash
git add server/lib/websearch.js server/lib/websearch.test.js
git commit -m "feat(report): tavily websearch wrapper with no-key fallback"
```

---

### Task 4: LLM 预筛查服务

**Files:**
- Create: `server/services/reportScreening.js`
- Create: `server/services/reportScreening.test.js`

**Interfaces:**
- Produces: `screenCards({ template, insights })` → `{ inconsistencies: [{issue, cardIds, options[], suggested}], searchPlan: [{cardId, queries[]}], purpose, exceedsLimit }`。LLM 失败/无 key 时降级：`inconsistencies: []`，`searchPlan` 由卡片标题+关键词直接生成，`purpose: template.purpose`。
- Consumes: `callLlmJson` from `../lib/llmClient.js`（测试中 vi.mock）。

- [ ] **Step 1: 写失败测试**

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../lib/llmClient.js", () => ({ callLlmJson: vi.fn() }));
import { screenCards } from "./reportScreening.js";
import { callLlmJson } from "../lib/llmClient.js";

const template = { id: 1, name: "T", purpose: "日报", max_cards: 2, prompt: "p", language: "zh" };
const insights = [
  { id: 11, title: "光伏装机创新高", summary: "2026年装机50GW", url: "https://a", keywords: "光伏", source_name: "北极星" },
  { id: 12, title: "光伏装机数据争议", summary: "装机40GW", url: "https://b", keywords: "光伏", source_name: "北极星" }
];

describe("reportScreening", () => {
  beforeEach(() => { callLlmJson.mockReset(); });

  it("parses LLM screening output", async () => {
    callLlmJson.mockResolvedValue({
      inconsistencies: [{ issue: "装机数据冲突", cardIds: [11, 12], options: ["保留全部并标注", "优先最新"], suggested: "保留全部并标注" }],
      searchPlan: [{ cardId: 11, queries: ["光伏 装机 2026"] }],
      purpose: "日报",
      exceedsLimit: false
    });
    const result = await screenCards({ template, insights });
    expect(result.inconsistencies).toHaveLength(1);
    expect(result.searchPlan[0].queries).toEqual(["光伏 装机 2026"]);
  });

  it("falls back when the LLM is unavailable", async () => {
    callLlmJson.mockRejectedValue(new Error("LLM API key not configured"));
    const result = await screenCards({ template, insights });
    expect(result.inconsistencies).toEqual([]);
    expect(result.searchPlan).toHaveLength(2);
    expect(result.purpose).toBe("日报");
    expect(result.searchPlan[0].queries[0]).toContain("光伏");
  });

  it("reports when the card count exceeds the template limit", async () => {
    callLlmJson.mockResolvedValue({ inconsistencies: [], searchPlan: [], purpose: "日报", exceedsLimit: true });
    const result = await screenCards({ template, insights });
    expect(result.exceedsLimit).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**

`server/services/reportScreening.js`：
```js
import { callLlmJson } from "../lib/llmClient.js";

function fallbackPlan(template, insights) {
  return {
    inconsistencies: [],
    searchPlan: insights.map(ins => ({
      cardId: ins.id,
      queries: [ [ins.title, ...(ins.keywords ? ins.keywords.split(",").slice(0, 3) : [])].filter(Boolean).join(" ") ].filter(Boolean)
    })),
    purpose: template.purpose || template.name,
    exceedsLimit: insights.length > (template.max_cards || 10)
  };
}

export async function screenCards({ template, insights }) {
  const cards = insights.map(ins => ({
    cardId: ins.id,
    title: ins.title,
    summary: ins.summary,
    url: ins.url,
    keywords: ins.keywords,
    source: ins.source_name,
    date: ins.publish_date
  }));
  const prompt = `你是报告生成的前置筛查员。用户将在市场洞察中勾选了以下卡片并用模板"${template.name}"生成报告（用途：${template.purpose || "未指定"}，卡片上限 ${template.max_cards || 10}）。

卡片数据：
${JSON.stringify(cards, null, 2)}

请完成三件事：
1. 检测卡片之间是否存在数据不一致（数值冲突、日期矛盾、事实矛盾）。每条不一致给出动态处理选项（如：保留全部并标注差异 / 优先最新日期 / 忽略冲突），并给出建议项；
2. 为每张卡片生成 1-3 个用于 websearch 的搜索查询（中文，聚焦标题与关键词）；
3. 给出报告用途说明（一句话，供用户确认）；若卡片数超过上限 ${template.max_cards || 10}，exceedsLimit 设为 true 并建议保留哪些。

返回 ONLY a valid JSON object，字段：
- inconsistencies: [{issue: string, cardIds: number[], options: string[], suggested: string}]
- searchPlan: [{cardId: number, queries: string[]}]
- purpose: string
- exceedsLimit: boolean`;
  try {
    const parsed = await callLlmJson([{ role: "user", content: prompt }], { maxTokens: 4000 });
    return {
      inconsistencies: Array.isArray(parsed?.inconsistencies) ? parsed.inconsistencies : [],
      searchPlan: Array.isArray(parsed?.searchPlan) ? parsed.searchPlan : fallbackPlan(template, insights).searchPlan,
      purpose: parsed?.purpose || template.purpose || template.name,
      exceedsLimit: Boolean(parsed?.exceedsLimit) || insights.length > (template.max_cards || 10)
    };
  } catch (e) {
    console.error("[screening] LLM unavailable, using fallback:", e.message);
    return fallbackPlan(template, insights);
  }
}
```

- [ ] **Step 4: 运行确认通过 + 提交**
```bash
git add server/services/reportScreening.js server/services/reportScreening.test.js
git commit -m "feat(report): LLM pre-screening with dynamic inconsistency options"
```

---

### Task 5: 生成任务服务（job 状态机 + 串行队列）

**Files:**
- Create: `server/services/reportGenerator.js`
- Create: `server/services/reportGenerator.test.js`

**Interfaces:**
- Produces:
  - `createReportJob({ templateId, insightIds, resolutions })` → job row（同时插入 reports 草稿 status=generating）
  - `getJob(id)` → job row + report 关联；`listJobs()` → 最新 50 条
  - `retryJob(id)` → 重置 queued（清 error）
  - `processQueue()` → 串行执行一个 queued job（内部 guard 防重入）；成功后启动下一个
  - `runJob(job)`（供测试直接调用）→ 更新 reports + job 状态
- Consumes: `callLlm`/`callLlmJson`（vi.mock）、`webSearch`（vi.mock）、`listTemplates`。

- [ ] **Step 1: 写失败测试**（关键：成功/失败/重试/降级/串行 guard）

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../lib/llmClient.js", () => ({ callLlm: vi.fn(), callLlmJson: vi.fn() }));
vi.mock("../lib/websearch.js", () => ({ webSearch: vi.fn() }));
import db, { initDb } from "../db.js";
import { createReportJob, getJob, retryJob, runJob, processQueue } from "./reportGenerator.js";
import { callLlm, callLlmJson } from "../lib/llmClient.js";
import { webSearch } from "../lib/websearch.js";

function seedTemplateAndInsight() {
  db.prepare("INSERT INTO report_templates (id, name, prompt, max_cards, is_public, language) VALUES (1, 'T', '用卡片写报告 {{insights}} {{search_results}}', 5, 1, 'zh')").run();
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

  it("processQueue runs one job at a time", async () => {
    callLlm.mockResolvedValue("# r");
    createReportJob({ templateId: 1, insightIds: [11], resolutions: [] });
    createReportJob({ templateId: 1, insightIds: [11], resolutions: [] });
    await processQueue();
    const jobs = db.prepare("SELECT status FROM report_jobs ORDER BY id").all();
    expect(jobs[0].status).toBe("done");
    expect(jobs[1].status).toBe("queued");
  });
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**

`server/services/reportGenerator.js`：
```js
import db from "../db.js";
import { callLlm } from "../lib/llmClient.js";
import { webSearch } from "../lib/websearch.js";
import { listTemplates } from "./reportTemplateService.js";

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
  processQueue();
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
  processQueue();
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

    // searching phase（无 key / 失败均降级，不中断）
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

    // summarizing phase
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

    // title：取正文第一个 H1/行首非空短句
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

// 服务器启动后兜底：重启时补跑遗留 queued 任务
export function startJobRunner() {
  processQueue().catch(err => console.error("[report] queue processing failed:", err));
}
```

- [ ] **Step 4: 运行确认通过 + 提交**
```bash
git add server/services/reportGenerator.js server/services/reportGenerator.test.js
git commit -m "feat(report): async generation jobs with serial queue and retry"
```

---

### Task 6: reports 路由扩展

**Files:**
- Modify: `server/routes/reports.js`
- Create: `server/routes/reports.test.js`

**Interfaces:**
- Consumes: 全部 Task 1/4/5 服务。
- Produces 端点：
  - `GET /api/reports/templates`、`POST /api/reports/templates`、`PUT /api/reports/templates/:id`、`DELETE /api/reports/templates/:id`
  - `POST /api/reports/screening` `{templateId, insightIds}` → `{data: screening}`
  - `POST /api/reports/generate` `{templateId, insightIds, resolutions}` → `{data: job}`
  - `GET /api/reports/jobs`、`GET /api/reports/jobs/:id`、`POST /api/reports/jobs/:id/retry`

- [ ] **Step 1: 写失败测试**（express app 模式同 settings.test.js；vi.mock 服务模块）

```js
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import db, { initDb } from "../db.js";
import reportRouter from "./reports.js";
import { listTemplates, seedReportTemplates } from "../services/reportTemplateService.js";
import { screenCards } from "../services/reportScreening.js";
import { createReportJob, getJob, retryJob } from "../services/reportGenerator.js";

vi.mock("../services/reportScreening.js", () => ({ screenCards: vi.fn() }));
vi.mock("../services/reportGenerator.js", () => ({ createReportJob: vi.fn(), getJob: vi.fn(), listJobs: vi.fn(), retryJob: vi.fn(), startJobRunner: vi.fn() }));

function buildApp() { const app = express(); app.use(express.json()); app.use("/api/reports", reportRouter); return app; }
async function call(path, opts = {}) {
  const app = buildApp(); const server = app.listen(0, "127.0.0.1");
  await new Promise(r => server.on("listening", r));
  try { const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/reports${path}`, { headers: { "Content-Type": "application/json" }, ...opts });
    return { status: res.status, body: await res.json() };
  } finally { server.close(); }
}

describe("reports routes", () => {
  beforeEach(() => { initDb(); db.prepare("DELETE FROM report_templates").run(); seedReportTemplates(); screenCards.mockReset(); createReportJob.mockReset(); });

  it("lists seeded public templates", async () => {
    const { status, body } = await call("/templates");
    expect(status).toBe(200);
    expect(body.data.length).toBeGreaterThanOrEqual(3);
  });

  it("creates a custom template", async () => {
    const { status, body } = await call("/templates", { method: "POST", body: JSON.stringify({ name: "自定义", prompt: "写报告" }) });
    expect(status).toBe(201);
    expect(body.data.name).toBe("自定义");
    expect(body.data.is_public).toBe(0);
  });

  it("rejects deleting a public template", async () => {
    const first = listTemplates()[0];
    const { status } = await call(`/templates/${first.id}`, { method: "DELETE" });
    expect(status).toBe(400);
  });

  it("runs screening and returns the plan", async () => {
    screenCards.mockResolvedValue({ inconsistencies: [], searchPlan: [], purpose: "日报", exceedsLimit: false });
    const { status, body } = await call("/screening", { method: "POST", body: JSON.stringify({ templateId: 1, insightIds: [11] }) });
    expect(status).toBe(200);
    expect(body.data.purpose).toBe("日报");
  });

  it("creates a generation job", async () => {
    createReportJob.mockReturnValue({ id: 99, status: "queued", report_id: 1 });
    const { status, body } = await call("/generate", { method: "POST", body: JSON.stringify({ templateId: 1, insightIds: [11], resolutions: [] }) });
    expect(status).toBe(201);
    expect(body.data.id).toBe(99);
  });

  it("returns job status and retries", async () => {
    getJob.mockReturnValue({ id: 1, status: "done" }); retryJob.mockReturnValue({ id: 1, status: "queued" });
    expect((await call("/jobs/1")).body.data.status).toBe("done");
    expect((await call("/jobs/1/retry", { method: "POST" })).body.data.status).toBe("queued");
  });
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**（`server/routes/reports.js` 追加以下内容，保留原有路由；`POST /generate` 与 `POST /` 用 201；screening 需要 `insightIds` 校验）

```js
import { listTemplates, createTemplate, updateTemplate, deleteTemplate } from "../services/reportTemplateService.js";
import { screenCards } from "../services/reportScreening.js";
import { createReportJob, getJob, listJobs, retryJob } from "../services/reportGenerator.js";

// 模板管理
router.get("/templates", (_req, res) => {
  try { res.json({ data: listTemplates() }); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/templates", (req, res) => {
  try { const row = createTemplate(req.body); res.status(201).json({ data: row }); } catch (e) { res.status(400).json({ error: e.message }); }
});
router.put("/templates/:id", (req, res) => {
  try { const row = updateTemplate(Number(req.params.id), req.body); res.json({ data: row }); } catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete("/templates/:id", (req, res) => {
  try { deleteTemplate(Number(req.params.id)); res.json({ success: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});

// 筛查
router.post("/screening", async (req, res) => {
  try {
    const { templateId, insightIds } = req.body;
    if (!templateId || !Array.isArray(insightIds) || insightIds.length === 0) {
      return res.status(400).json({ error: "templateId and insightIds are required" });
    }
    const template = listTemplates().find(t => t.id === Number(templateId));
    if (!template) return res.status(404).json({ error: "Template not found" });
    const ids = insightIds.map(Number).filter(Boolean);
    const placeholders = ids.map(() => "?").join(",");
    const insights = db.prepare(`SELECT * FROM insights WHERE id IN (${placeholders}) AND hidden = 0`).all(...ids);
    const result = await screenCards({ template, insights });
    res.json({ data: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 生成任务
router.post("/generate", (req, res) => {
  try {
    const { templateId, insightIds, resolutions } = req.body;
    if (!templateId || !Array.isArray(insightIds) || insightIds.length === 0) {
      return res.status(400).json({ error: "templateId and insightIds are required" });
    }
    const job = createReportJob({ templateId: Number(templateId), insightIds, resolutions: resolutions || [] });
    res.status(201).json({ data: job });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.get("/jobs", (_req, res) => { try { res.json({ data: listJobs() }); } catch (e) { res.status(500).json({ error: e.message }); } });
router.get("/jobs/:id", (req, res) => {
  try { const job = getJob(Number(req.params.id)); if (!job) return res.status(404).json({ error: "Job not found" }); res.json({ data: job }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/jobs/:id/retry", (req, res) => {
  try { const job = retryJob(Number(req.params.id)); res.json({ data: job }); } catch (e) { res.status(400).json({ error: e.message }); }
});
```
并在 `server/index.js` 加 `startJobRunner()`（导入自 reportGenerator，`startScheduler()` 之后调用）。

- [ ] **Step 4: 运行确认通过 + 提交**
```bash
git add server/routes/reports.js server/routes/reports.test.js server/index.js
git commit -m "feat(report): reports routes for templates, screening, jobs"
```

---

### Task 7: 前端 backendApi 扩展

**Files:**
- Modify: `src/utils/backendApi.js`（在 `// Reports` 区块追加）

**Interfaces:**
- Produces: `getReportTemplates()`、`createReportTemplate(data)`、`updateReportTemplate(id, data)`、`deleteReportTemplate(id)`、`screenReport(templateId, insightIds)`、`generateReport(templateId, insightIds, resolutions)`、`getReportJobs()`、`getReportJob(id)`、`retryReportJob(id)`。

- [ ] **Step 1: 实现**（追加到 `// Reports` 区块）：

```js
  getReportTemplates: () => request("/reports/templates"),
  createReportTemplate: (data) => request("/reports/templates", { method: "POST", body: JSON.stringify(data) }),
  updateReportTemplate: (id, data) => request(`/reports/templates/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteReportTemplate: (id) => request(`/reports/templates/${id}`, { method: "DELETE" }),
  screenReport: (templateId, insightIds) => request("/reports/screening", { method: "POST", body: JSON.stringify({ templateId, insightIds }) }),
  generateReport: (templateId, insightIds, resolutions) => request("/reports/generate", { method: "POST", body: JSON.stringify({ templateId, insightIds, resolutions }) }),
  getReportJobs: () => request("/reports/jobs"),
  getReportJob: (id) => request(`/reports/jobs/${id}`),
  retryReportJob: (id) => request(`/reports/jobs/${id}/retry`, { method: "POST" }),
```

- [ ] **Step 2: 提交**
```bash
git add src/utils/backendApi.js
git commit -m "feat(report): backendApi methods for templates, screening, jobs"
```

---

### Task 8: ReportGeneratorModal 组件（模板选择 → 筛查确认 → 进度）

**Files:**
- Create: `src/components/ReportGeneratorModal.jsx`

**Interfaces:**
- Props: `{ darkMode, language, templates, cart, onClose, onDone(reportId), onOpenReports }`
- 内部状态：`step`（pick/screen/progress/done）、`selectedTemplateId`、`screening`、`resolutions`（Map cardId→suggested 或按 index）、`jobId`、`job`（轮询）。
- 复用 `ReportGeneratorModal.jsx` 内的 i18n 文案（zh/en 三元式，与现有页面一致，不扩展 i18n.js 以减小改动面——但文案直接内联）。

- [ ] **Step 1: 实现**（关键逻辑：step pick → 选模板后调 `screenReport` → step screen 显示不一致动态选项（radio）+ 用途确认 + 超限提示 → 提交 `generateReport` → step progress 每 3s 轮询 `getReportJob` → done 调 `onDone`/`onOpenReports`）

```jsx
import { useEffect, useRef, useState } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS } from "../constants/theme";
import { backendApi } from "../utils/backendApi";

export default function ReportGeneratorModal({ darkMode, language, templates, cart, onClose, onDone, onOpenReports }) {
  const zh = language === "zh";
  const [step, setStep] = useState("pick");
  const [templateId, setTemplateId] = useState(null);
  const [screening, setScreening] = useState(null);
  const [resolutions, setResolutions] = useState([]);
  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef(null);

  const cardBg = darkMode ? COLORS.background.cardDark : COLORS.background.card;
  const border = darkMode ? COLORS.border.dark : COLORS.border.light;
  const text = darkMode ? "#e8e8e8" : COLORS.text.primary;
  const secondary = darkMode ? "#aaa" : COLORS.text.secondary;

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => stopPolling, []);

  const pickTemplate = async (t) => {
    setTemplateId(t.id); setBusy(true); setError(null);
    try {
      const res = await backendApi.screenReport(t.id, cart.map(c => c.id).filter(Boolean));
      setScreening(res.data);
      setResolutions((res.data.inconsistencies || []).map(inc => inc.suggested || (inc.options || [])[0] || ""));
      setStep("screen");
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const merged = (screening?.inconsistencies || []).map((inc, i) => ({ issue: inc.issue, cardIds: inc.cardIds, choice: resolutions[i] }));
      const res = await backendApi.generateReport(templateId, cart.map(c => c.id).filter(Boolean), merged);
      setJobId(res.data.id); setStep("progress");
      pollRef.current = setInterval(async () => {
        try {
          const jr = await backendApi.getReportJob(res.data.id);
          setJob(jr.data);
          if (jr.data.status === "done" || jr.data.status === "failed") { stopPolling(); setStep("done"); }
        } catch { /* keep polling */ }
      }, 3000);
    } catch (e) { setError(e.message); setBusy(false); }
  };

  const modalStyle = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 };
  const cardStyle = { background: cardBg, border, borderRadius: BORDER_RADIUS.lg, padding: 24, maxWidth: 640, width: "100%", maxHeight: "80vh", overflowY: "auto" };
  const btn = (primary) => ({ padding: "8px 16px", borderRadius: BORDER_RADIUS.md, border: "none", background: primary ? COLORS.primary : "transparent", color: primary ? "#fff" : text, fontSize: FONT_SIZES.sm, cursor: "pointer", border: primary ? "none" : `1px solid ${border}` });

  return (
    <div style={modalStyle}>
      <div style={cardStyle}>
        <h3 style={{ margin: "0 0 16px", color: text }}>{zh ? "生成报告" : "Generate Report"}</h3>

        {step === "pick" && (
          <>
            <p style={{ margin: "0 0 12px", fontSize: FONT_SIZES.sm, color: secondary }}>
              {zh ? `已选 ${cart.length} 张卡片，请选择报告模板：` : `Selected ${cart.length} card(s). Choose a template:`}
            </p>
            {templates.filter(t => t.is_public === 1).length > 0 && (
              <SectionLabel zh={zh} text={zh ? "公用模板" : "Public templates"} />
            )}
            {templates.filter(t => t.is_public === 1).map(t => <TemplateRow key={t.id} t={t} zh={zh} disabled={busy} onPick={() => pickTemplate(t)} cardBg={cardBg} border={border} text={text} secondary={secondary} />)}
            {templates.filter(t => t.is_public !== 1).length > 0 && (
              <SectionLabel zh={zh} text={zh ? "自定义模板" : "Custom templates"} />
            )}
            {templates.filter(t => t.is_public !== 1).map(t => <TemplateRow key={t.id} t={t} zh={zh} disabled={busy} onPick={() => pickTemplate(t)} cardBg={cardBg} border={border} text={text} secondary={secondary} />)}
            {error && <ErrorBox text={error} />}
          </>
        )}

        {step === "screen" && screening && (
          <>
            <p style={{ margin: "0 0 10px", fontSize: FONT_SIZES.sm, color: secondary }}>
              {zh ? "报告用途：" : "Purpose: "}<strong style={{ color: text }}>{screening.purpose || "—"}</strong>
            </p>
            {screening.exceedsLimit && (
              <div style={{ background: "#fff8e6", border: "1px solid #e6c300", borderRadius: BORDER_RADIUS.md, padding: "10px 14px", marginBottom: 12, fontSize: FONT_SIZES.sm, color: "#8a6d00" }}>
                {zh ? "卡片数超过该模板上限，生成时将只取前若干张。" : "Card count exceeds the template limit; only the first cards will be used."}
              </div>
            )}
            {(screening.inconsistencies || []).length === 0 && (
              <p style={{ fontSize: FONT_SIZES.sm, color: secondary, margin: "0 0 12px" }}>{zh ? "未发现数据不一致。" : "No inconsistencies detected."}</p>
            )}
            {(screening.inconsistencies || []).map((inc, i) => (
              <div key={i} style={{ border: `1px solid ${border}`, borderRadius: BORDER_RADIUS.md, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: FONT_SIZES.sm, color: text, fontWeight: 600, marginBottom: 8 }}>{inc.issue}</div>
                {(inc.options || []).map(opt => (
                  <label key={opt} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: FONT_SIZES.sm, color: text, marginBottom: 4, cursor: "pointer" }}>
                    <input type="radio" name={`inc-${i}`} checked={resolutions[i] === opt} onChange={() => setResolutions(prev => prev.map((v, j) => j === i ? opt : v))} style={{ width: 14, height: 14, cursor: "pointer" }} />
                    {opt}
                  </label>
                ))}
              </div>
            ))}
            {error && <ErrorBox text={error} />}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button style={btn(false)} onClick={() => setStep("pick")} disabled={busy}>{zh ? "返回" : "Back"}</button>
              <button style={btn(true)} onClick={submit} disabled={busy}>{busy ? (zh ? "提交中..." : "Submitting...") : (zh ? "生成报告" : "Generate")}</button>
            </div>
          </>
        )}

        {step === "progress" && (
          <div>
            <p style={{ color: text, margin: "0 0 12px" }}>
              {zh ? `生成中：${phaseLabel(job?.phase, zh)}（${job?.progress ?? 0}%）` : `Generating: ${phaseLabel(job?.phase, false)} (${job?.progress ?? 0}%)`}
            </p>
            <div style={{ background: darkMode ? "#333" : "#eee", borderRadius: BORDER_RADIUS.sm, height: 8, overflow: "hidden" }}>
              <div style={{ width: `${job?.progress ?? 0}%`, height: "100%", background: COLORS.primary, transition: "width .5s" }} />
            </div>
            {job?.notes && <p style={{ fontSize: FONT_SIZES.sm, color: secondary, marginTop: 8 }}>{job.notes}</p>}
          </div>
        )}

        {step === "done" && (
          <div>
            {job?.status === "done" ? (
              <p style={{ color: text, margin: "0 0 12px" }}>{zh ? "报告已生成！" : "Report generated!"}</p>
            ) : (
              <p style={{ color: "#c00", margin: "0 0 12px" }}>{zh ? `生成失败：${job?.error || "未知错误"}` : `Failed: ${job?.error || "unknown error"}`}</p>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={btn(false)} onClick={onClose}>{zh ? "关闭" : "Close"}</button>
              {job?.status === "done" && <button style={btn(true)} onClick={() => { onDone?.(job.report_id); onOpenReports?.(); }}>{zh ? "查看报告" : "View Report"}</button>}
              {job?.status === "failed" && <button style={btn(true)} onClick={() => { backendApi.retryReportJob(jobId).then(() => { setStep("progress"); setBusy(false); }); }}>{zh ? "重试" : "Retry"}</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function phaseLabel(phase, zh) {
  const map = { queued: ["排队中", "Queued"], searching: ["检索资料中", "Searching"], summarizing: ["AI 总结中", "Summarizing"], done: ["完成", "Done"], failed: ["失败", "Failed"] };
  return (map[phase] || ["处理中", "Processing"])[zh ? 0 : 1];
}
function SectionLabel({ zh, text }) { return <div style={{ fontSize: FONT_SIZES.sm, fontWeight: 700, color: "#666", margin: "10px 0 6px" }}>{text}</div>; }
function ErrorBox({ text }) { return <div style={{ background: "#fff0f0", border: "1px solid #fcc", borderRadius: BORDER_RADIUS.md, padding: "10px 14px", color: "#c00", fontSize: FONT_SIZES.sm, marginTop: 12 }}>{text}</div>; }
function TemplateRow({ t, zh, disabled, onPick, cardBg, border, text, secondary }) {
  return (
    <div key={t.id} style={{ border: `1px solid ${border}`, borderRadius: BORDER_RADIUS.md, padding: "12px 16px", marginBottom: 10, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1 }} onClick={disabled ? undefined : onPick}>
      <div style={{ fontWeight: 600, color: text, fontSize: FONT_SIZES.base }}>{t.name} <span style={{ fontSize: 11, color: secondary }}>{zh ? `上限 ${t.max_cards} 张` : `max ${t.max_cards} cards`}</span></div>
      <div style={{ fontSize: FONT_SIZES.sm, color: secondary, marginTop: 4 }}>{t.description || "—"}</div>
    </div>
  );
}
```

- [ ] **Step 2: 提交**
```bash
git add src/components/ReportGeneratorModal.jsx
git commit -m "feat(report): generation modal with template pick, screening confirm, progress"
```

---

### Task 9: IntelligencePage + App.jsx 接线

**Files:**
- Modify: `src/App.jsx`（新增 `showReportModal` 状态、`onGenerateReport`、模板加载、渲染 Modal）
- Modify: `src/components/IntelligencePage.jsx`（Selected 栏按钮替换）

- [ ] **Step 1: App.jsx**（在现有 state 区加 `const [showReportModal, setShowReportModal] = useState(false); const [reportTemplates, setReportTemplates] = useState([]);`；加载处 `backendApi.getReportTemplates().then(r => setReportTemplates(r.data)).catch(() => {});`；把 `onGenerateNewsletter={generateNewsletter} summarizing={summarizing}` 替换为 `onGenerateReport={() => setShowReportModal(true)}`；`onOpenReports` 跳转到报告页（现有 reports tab 切换逻辑；找到切换配置页 tab 的机制，ReportsPage 通过 `onViewReport` 从 App 打开——沿用同一跳转方式，比如设置 active 页面状态为 reports）；在组件树末尾渲染 `{showReportModal && <ReportGeneratorModal darkMode={darkMode} language={language} templates={reportTemplates} cart={cart} onClose={() => setShowReportModal(false)} onOpenReports={openReportsPage} />}`（引入 `import ReportGeneratorModal from "./components/ReportGeneratorModal.jsx";`）。

- [ ] **Step 2: IntelligencePage.jsx**：Selected 栏的 Generate Newsletter 按钮（约 129-139 行）替换为：
```jsx
<button onClick={onGenerateReport} style={{
  padding: "5px 14px",
  borderRadius: BORDER_RADIUS.sm,
  border: "none",
  background: COLORS.primary,
  color: "#fff",
  fontSize: FONT_SIZES.sm,
  cursor: "pointer"
}}>{language === "zh" ? "生成报告" : "Generate Report"}</button>
```
props 解构处把 `onGenerateNewsletter, summarizing` 换成 `onGenerateReport`。

- [ ] **Step 3: 提交**
```bash
git add src/App.jsx src/components/IntelligencePage.jsx
git commit -m "feat(report): wire generation entry in intelligence page"
```

---

### Task 10: ReportsPage 状态徽标 + 模板管理视图

**Files:**
- Modify: `src/components/ReportsPage.jsx`

**Interfaces:**
- 保留现有 props（`darkMode, language, selectedReport, setSelectedReport, onViewReport`）。内部新增：模板列表加载、`view` 状态（`reports`/`templates`）、模板表单。
- 报告列表条目加状态徽标：`generating`（橙）/`done`（绿）/`failed`（红 + 重试按钮调 `backendApi.retryReportJob` 后刷新）。
- 报告查看区标题下显示模板名（从模板列表按 `template_id` 查）。
- 模板管理视图：公用模板只读卡片列表；自定义模板可编辑（点击展开表单：name/description/purpose/prompt/max_cards/language）+ 删除；顶部"新建模板"表单。用 `backendApi` 的模板方法。

- [ ] **Step 1: 实现**（在 ReportsPage 组件内加状态与两个视图渲染；模板管理视图的核心表单与列表，样式沿用现有 card 风格；重试/删除/新建后刷新模板列表与报告列表）

- [ ] **Step 2: 提交**
```bash
git add src/components/ReportsPage.jsx
git commit -m "feat(report): reports page status badges and template management"
```

---

### Task 11: 全量验证 + 本地活体验证

**Files:**
- 无新增。

- [ ] **Step 1: 全量测试**：`NODE_ENV=test npx vitest run` → 全部通过（新增报告相关 suite 全绿；"No test suite found" 的 node:test 存量文件状态与 HEAD 一致）。
- [ ] **Step 2: lint + build**：`npx eslint <改动文件>` 0 error；`npm run build` exit 0。
- [ ] **Step 3: 本地重启后端**：`pkill -f "node server/index.js"` + nohup 重启；确认日志出现模板 seed 与 job runner。
- [ ] **Step 4: 端到端**：选卡片 → 生成报告 → 模板选择 → 筛查 → 生成 → 报告页出现完成报告；`curl` 验证 `GET /api/reports/templates`、`POST /api/reports/generate`、轮询 job、`GET /api/reports` 状态 done。
- [ ] **Step 5: 提交**：`git add -A && git commit -m "feat(report): end-to-end verification"`（如有残留改动）。
