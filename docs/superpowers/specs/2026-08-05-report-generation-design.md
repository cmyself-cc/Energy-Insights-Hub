# 报告生成功能设计

日期：2026-08-05
状态：已确认（用户 2026-08-05 审批）

## 目标

在市场洞察中勾选 insights 卡片，选择报告模板（公用/自定义），大模型结合 websearch 补料生成结构化报告；报告在左侧报告页统一管理；报告页内可创建/管理模板。

## 现状基础（复用）

- 卡片选择：feed 内 `Selected: N` 栏（现有 cart 机制）+ 勾选切换。
- `reports` 表 + ReportsPage（列表/查看/删除）+ `marked` Markdown 渲染。
- Tavily 搜索链路：`server/crawlers/apiCrawler.js` 已有实现；本地 `.env` 有 `TAVILY_API_KEY`，生产容器未配置。
- 服务端 LLM 统一走 server-managed models（与 feedback 建议生成一致，非浏览器 BYOK）。

## 数据模型

```sql
CREATE TABLE IF NOT EXISTS report_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  purpose TEXT DEFAULT '',          -- 报告用途/受众说明
  prompt TEXT NOT NULL,             -- 模板提示词，占位符 {{date}} {{language}} {{insights}} {{search_results}} {{resolutions}}
  max_cards INTEGER DEFAULT 10,     -- 模板卡片上限（超过时筛查阶段提示）
  is_public INTEGER DEFAULT 1,      -- 1=公用(内置，只读) 0=自定义
  language TEXT DEFAULT 'zh',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS report_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER,
  template_id INTEGER,
  status TEXT DEFAULT 'queued',     -- queued/generating/done/failed
  phase TEXT DEFAULT 'queued',      -- queued/searching/summarizing/done/failed
  progress INTEGER DEFAULT 0,       -- 0-100
  error TEXT,
  insight_ids TEXT,                 -- JSON 数组
  screening TEXT,                   -- JSON：筛查结果与用户处理决定
  notes TEXT,                       -- 降级/跳过等说明
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- reports 表新增列
ALTER TABLE reports ADD COLUMN template_id INTEGER;
ALTER TABLE reports ADD COLUMN status TEXT DEFAULT 'done';   -- done/generating/failed
ALTER TABLE reports ADD COLUMN error TEXT;
```

内置公用模板（seed，表空时插入，幂等）：
1. 每日能源要闻日报（max_cards 10，全部目的）
2. 竞争对手动态简报（max_cards 8，purpose=competitor，搜索重点=企业名+近期动态）
3. 政策与行业跟踪（max_cards 6，purpose=policy/tech）

## 生成流程

1. 市场洞察选中卡片 → 点"生成报告" → 模板选择弹窗（公用/自定义分组，展示 max_cards）。
2. LLM 预筛查（同步）：`POST /api/reports/screening {templateId, insightIds}`
   - 输入：模板 + 卡片数据（标题/摘要/URL/关键词/来源/日期）。
   - 输出 JSON：
     - `inconsistencies`: [{issue, cardIds, options[], suggested}] — 数据不一致与动态处理选项；
     - `searchPlan`: [{cardId, queries[]}] — 每卡检索计划；
     - `purpose`: 建议报告用途（与模板 purpose 核对）；
     - `exceedsLimit`: 是否超出 max_cards，及建议。
   - 前端"筛查确认"对话框：每个不一致项动态选项选择、确认用途；超限提示可继续（生成时截断并记录）。
   - LLM 不可用/失败 → 降级：无 inconsistencies，searchPlan 由卡片标题/关键词直接生成。
3. 异步生成：`POST /api/reports/generate {templateId, insightIds, resolutions}`
   - 创建 reports 草稿（status=generating）+ report_jobs（queued）→ 返回 jobId。
   - 前端轮询 `GET /api/reports/jobs/:id`（3-5s）。
   - 任务执行（单机串行队列，一次一个 job）：
     - searching：按 searchPlan 对每卡（上限 max_cards）调 Tavily（10s 超时，单卡失败跳过；无 key 整体降级仅用卡片内容，job.notes 记录）；
     - summarizing：卡片数据 + 搜索结果 + resolutions + 模板 prompt → LLM（thinking disabled，max_tokens 8192）生成 Markdown（标题 LLM 拟定）；
     - 落库：reports.content/title/status=done；job done。
   - 失败：status=failed + error；可重试（重置 queued 重新入队）。

## API 扩展（server/routes/reports.js）

- 模板：`GET /templates`、`POST /templates`、`PUT /templates/:id`、`DELETE /templates/:id`（公用模板拒绝删除）
- 筛查：`POST /screening`
- 生成：`POST /generate`
- 任务：`GET /jobs`、`GET /jobs/:id`、`POST /jobs/:id/retry`
- 保留原有 `GET /`、`GET /:id`、`POST /`、`DELETE /:id`

## 服务层

- `server/lib/llmClient.js`：统一 LLM 调用（OpenAI 兼容 + Anthropic），非 anthropic 自动 `thinking:{type:"disabled"}`，支持 JSON 解析，异常给出可读错误。
- `server/lib/websearch.js`：Tavily 封装；无 key 返回 null（调用方降级）。
- `server/services/reportTemplateService.js`：CRUD + 内置模板 seed。
- `server/services/reportScreening.js`：LLM 筛查 + 降级。
- `server/services/reportGenerator.js`：job 创建、执行、队列、状态机、重试。

## UI 改动

- IntelligencePage Selected 栏："生成报告"按钮替换旧 Generate Newsletter。
- 新组件 `ReportGeneratorModal.jsx`：步骤 1 模板选择 → 步骤 2 筛查确认（动态选项）→ 步骤 3 进度轮询 → 完成。
- ReportsPage：报告列表加状态徽标（生成中/完成/失败+重试）；查看区展示模板名与卡片元数据；新增"模板管理"视图（公用只读、自定义可增删改）。

## 错误处理与边界

- Tavily 无 key：搜索阶段整体降级，job.notes 说明。
- 单卡搜索失败：跳过继续。
- LLM 失败/超时：job failed + retry。
- 卡片已删除/隐藏：生成时过滤。
- 并发：单机串行队列，运行中标志防重入；server 重启后由周期 runner 补跑 queued job。

## 测试

- vitest：llmClient（含 thinking disabled 断言）、websearch（无 key 降级/有 key 调用）、templateService（CRUD + seed 幂等）、screening（解析/降级）、generator（job 状态机：成功/失败/重试/降级）、routes/reports（模板与 job 接口）。
- 前端：lint + build + 本地全流程活体验证（生成一条真实报告）。

## 待办（部署时）

- 生产容器配置 `TAVILY_API_KEY`（用户已确认）。
- 替换旧 newsletter 按钮（用户已确认）。
