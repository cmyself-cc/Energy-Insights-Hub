# Energy Insights Hub（混沌能源智库）产品需求文档

**Version:** 1.0（完整版，As-Is + To-Be）
**Date:** 2026-10-14 · 更新 2026-10-17
**Status:** 定稿（OQ-1~OQ-5 已全部确认，见 3.15）
**说明:** 本 PRD 取代历史上作为外部系统复刻稿的 `PRD_China_Intelligence_Insights_Hub.md`（已于 2026-08-30 从仓库移除，不再维护）。第一部分如实描述当前系统已上线的功能，第二部分为待开发的「分用户分角色管理」需求（设计决策已与产品负责人确认）。

---

## 1. 产品概述

Energy Insights Hub（混沌能源智库）是一个全栈情报平台：从配置的数据源持续监测能源行业资讯，经过多层过滤管道（行业预过滤 → 关键词门 → LLM 语义处理），以洞察卡片形式呈现于 Market Intelligence 看板，并支持基于模板的 AI 报告生成。

三个监控用途（purpose）贯穿全链路：

- **竞争情报（competitor）**：被跟踪公司的经营动作（投资、合作、并购、签约）
- **政策监测（policy）**：政府机构的能源/政策新闻
- **技术监测（tech）**：储能、光伏、氢能、油气、CCUS 等领域技术突破

### 1.1 目标用户

| 角色 | 描述 |
|---|---|
| 管理员（admin） | 维护数据源与入池过滤规则、跑采集管道、审阅反馈、查看全量报告。当前唯一使用者为产品负责人本人 |
| 普通用户（user） | 本期新增。在公共 insights pool 上配置自己的筛选视角，独立生成和保存自己的报告与模板 |

### 1.2 技术栈与部署（现状）

- 前端 React 18 + Vite 5（`src/`），后端 Express + better-sqlite3（`server/`，端口 3001），SQLite 数据库，定时任务 node-cron，爬虫含 Playwright headless。
- LLM 走 OpenAI 兼容 API（服务端环境变量 `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`），密钥不落前端。
- 两套环境严格分离：测试（本地 `:5177` → `localhost:3001`，`./data/energy_insights.db`）与生产（eih.cmyself.cc，Docker 容器 `3006:3001`，volume `eih_data`），推送 main 分支经 Mac Mini runner 自动部署。

---

## 2. As-Is：现有功能说明（均已上线）

### 2.1 数据源管理（Sources）

- 支持四种源类型：`rss` / `website` / `wechat_mcp` / `api`；启用/停用；按 purpose 标注（逗号分隔，空=全部）。
- 网站爬虫按 RSS → sitemap → HTML 列表 → Playwright 渲染（含 JSON API 拦截）顺序降级；支持子页面发现与列表选择器配置（`sources.config` JSON）。
- 微信公众号数据经 `wechat-mcp/` 子服务接入（依赖第三方微信 RSS 服务）。

### 2.2 采集管道（Tracker）

- 三阶段：Phase 1 抓取（fetchArticles 按类型分发爬虫）→ Phase 2 过滤 → Phase 3 LLM 语义处理 → 写入 insights 池。
- 调度：node-cron 定时 + `POST /api/tracker/run` 手动触发；`tracker_runs` 记录运行日志；前端进度页支持查看与停止。
- `tracker_settings` 可调：回看窗口（lookback_hours）、单源上限（max_per_source）、去重阈值、必要行业关键词、监控开关。

### 2.3 三层内容过滤

1. **行业预过滤**：`industry_categories`（业务领域分类 + 关键词 + LLM 生成的别名 aliases）。
2. **关键词门**：`filter_rules`（`enterprise` 与 `include_keyword` 为 AND 关系，`exclude_keyword` 一票否决），按 purpose 分组生效；新增/编辑关键词时经 `llmAlias` 自动补充同义别名。
3. **语义提示词**：`filter_config`（`type='semantic'`，按 purpose 注入提取提示），LLM 逐篇生成 `title / summary(≤150字) / keywords / categories / purposes / china_relevance`。

### 2.4 Insights 池与情报浏览（IntelligencePage）

- 卡片流展示 insights，3 列网格，分页加载（默认 pageSize=24）。
- 筛选维度：监控用途（purpose/purposes）、类别（businessCategory）、主题类别（subjectCategory）、业务领域（businessDomain）、企业类型/玩家（enterpriseType）、来源类型（sourceType）、日期区间（dateFrom/dateTo）、关键词搜索（search，命中标题/摘要/来源）。
- 卡片动作：打开原文链接、AI 解读、收藏（bookmark）、隐藏（hide）、删除单条 insight（管理员能力）。
- 全部 API 当前无鉴权，任何访问者可见全量数据。

### 2.5 AI 解读（AiDrawer）

- 卡片级右侧抽屉，流式输出；支持多模型切换（`model_configs`：名称/模型/base_url/key，选择器只下发模型 id，密钥不出前端）。
- 解读预设（`filter_config type='ai_presets'`）可配置；系统提示词存 `llm_prompts`（按 key 管理，DB 编辑不被 seed 覆盖）。

### 2.6 报告生成（ReportsPage + ReportGeneratorModal）

- **模板库**：`report_templates`（name/description/purpose/prompt/max_cards/is_public/language），内置三份默认模板（每日能源要闻日报、竞争对手动态简报、政策与行业跟踪），支持自定义模板 CRUD；支持手动输入主题/框架/大纲/核心结论 → LLM 生成提示词模板（`/reports/generate-prompt`）。
- **六步生成流**：卡片筛查（LLM 检查矛盾/重复/不相关，超量提醒）→ 报告用途 → 读者受众 → 报告主题 → 模板选择 → 确认。前三项由 LLM 基于所选卡片推测选项、用户可改。
- **异步任务**：`report_jobs`（queued/generating/done/failed，phase+progress），进程内队列串行消费，重启后周期补跑 queued 任务，支持 retry。
- **搜索补充**：`search_providers` 可配置，生成时按 searchPlan 补充外部信息并标注来源。
- **每日简报**：自动模式跳过确认步骤，选择昨日+今日 insights 直接生成。
- **报告库**：列表 + 详情阅读（Markdown 渲染），导出 Word(.docx) / PDF / Markdown。

### 2.7 反馈闭环（FeedbackPage，仅管理员视角）

- `user_feedback`：收藏/隐藏动作 + 原因标签（irrelevant/duplicate/low_quality/not_now），附卡片快照。
- `feedback_semantic_weights`：按词条聚合的 boost/suppress 权重，影响后续进卡评分。
- `feedback_rules_suggestions`：LLM 从反馈归纳出关键词规则建议，`pending/accepted/rejected` 三态，管理员在反馈页一键采纳（写入 `filter_rules`）或拒绝；已支持 reclassify 反馈。

### 2.8 配置管理与其他

- ConfigurationPage 聚合：数据源、内容过滤（3 purpose 标签页）、Tracker 设置、反馈、模型配置、搜索源、API 配置。
- 统一配置导入/导出（JSON/CSV，`csvConfig`）。
- 中英双语 UI（i18n）、暗色模式、桌面为主（≥1280px，兼容移动端筛选折叠）。

### 2.9 现有数据模型摘要

`sources`、`filter_rules`、`filter_config`、`industry_categories`、`insights`、`reports`、`report_templates`、`report_jobs`、`user_feedback`、`feedback_rules_suggestions`、`feedback_semantic_weights`、`tracker_settings`、`tracker_runs`、`model_configs`、`search_providers`、`llm_prompts`。迁移为编号 SQL 文件（`server/migrations/`，001–022）。

### 2.10 与本期需求相关的已知现状缺口

- **无任何身份体系**：无登录、无用户表、无角色；全部 `/api/*` 匿名可用。
- **所有资源全局共享、无归属**：reports / report_jobs / report_templates / user_feedback 均无用户维度（templates 仅有 `is_public` 标志）。
- **反馈直接影响全局管道**：任何人（当前=唯一使用者）的 bookmark/hide 会改变全局入池权重，多用户化后必须隔离。

---

## 3. To-Be：分用户分角色管理（本期开发需求）

### 3.1 背景与目标

平台即将从单人工具演进为小团队协作工具。需要区分管理员与普通用户：普通用户拥有彼此独立的报告生成空间，能在统一的 insights pool 上保存自己的筛选视角，并管理自己的报告模板；同时保证采集管道、入池过滤规则等"生产资料"仍由管理员独占维护，普通用户行为不污染全局数据。

### 3.2 范围界定

**范围内**：微信登录 + 邀请码开通、角色权限矩阵、情报页自定义视角、报告/模板按 owner 隔离、用户反馈提交-审批流、管理员的用户与邀请码管理。

**范围外（明确不做）**：

- 内容级 ACL——公共池无敏感信源，所有登录用户默认可读全量 insights。
- 每用户独立采集管道/独立池（已确认选方案 A：全局池 + 用户视图；独立池列为远期演进）。
- 新增"我的空间"类页面——沿用现有情报页、报告页、模板管理，不改变页面骨架。
- 用户名密码注册、多租户、组织部门树。

### 3.3 核心设计原则（已确认）

1. 一个全局 insights pool，由管理员的采集管道维护；普通用户只能在池上做**读侧筛选**，不能影响入池逻辑。
2. **自定义视角 > 公共视角**：视角开启时以其筛选集生效，关闭即一键回到公共 pool（不筛选）。
3. 报告、任务、模板、反馈全部按用户归属隔离；管理员对全局资源可见且带归属标注。
4. 普通用户的配置能力与其数据完全独立存放，与管理员配置体系（sources / filter_rules / tracker_settings 等）物理分开。

### 3.4 FR-AUTH 登录与邀请制开通

| ID | 需求 |
|---|---|
| AUTH-1 | 登录身份使用微信：**微信登录只负责采集身份注册信息（UnionID、昵称、头像），授权的钥匙是邀请码**。UnionID 作为用户唯一锚点（OpenID 记录各接入端）。web 端采用微信开放平台**扫码登录**；小程序平台接入后自动弹出授权（`wx.login` 静默获取身份 + 用户信息授权弹窗），两种入口归并到同一 UnionID 账号。前提：网站应用与小程序绑定在同一开放平台账号下，否则 UnionID 不互通、账号无法归并。 |
| AUTH-2 | 邀请制开通：邀请码是授权与开通的钥匙。管理员预先配置邀请码，可携带默认配置与权限（绑定角色、默认视角筛选 JSON、备注）；**默认可复用**，并可另行设定可注册用户数上限（默认不限）与有效期（默认不限）。 |
| AUTH-3 | 新用户首次微信授权 → 系统查无此 UnionID → 进入邀请码输入页 → 校验通过（存在、启用、未过期、未满次数）→ 创建用户（写入 UnionID、微信昵称/头像、邀请码携带的角色与默认配置），邀请码使用计数 +1 → 直接进入系统。 |
| AUTH-4 | 再次登录：UnionID 已注册 → 直接建立会话，无需邀请码。 |
| AUTH-5 | 会话：服务端 session（HttpOnly + SameSite cookie，session 存 SQLite），登出即销毁；无自助注册、无用户名密码。 |
| AUTH-6 | 初始管理员通过环境变量 seed（如 `ADMIN_UNIONID` 或首次启动生成的引导邀请码），保证首个 admin 可用；admin 可变更角色/禁用用户。 |
| AUTH-7 | 未登录访问任意页面/`/api/*`（健康检查除外）→ 跳转登录入口；被禁用用户登录时提示联系管理员。 |

### 3.5 FR-ROLE 角色与权限矩阵

角色两种：`admin` / `user`（users.role 带 CHECK 约束，便于日后扩展 viewer 等）。

| 能力 | admin | user |
|---|---|---|
| 浏览 insights 池（全量）、关键词搜索 | ✓ | ✓ |
| 配置/开关自定义视角、保存筛选集 | ✓ | ✓（仅自己的） |
| 个人 bookmark/hide | ✓ | ✓（仅个人，见 FB-2） |
| 提交反馈给管理员审批 | — | ✓ |
| 生成报告（六步流/每日简报） | ✓ | ✓（候选池可被自己的视角限定） |
| 报告/任务列表 | 全部 + 归属标注 | 仅本人 |
| 模板：查看 | 全部 + 归属标注 | 公共模板 + 本人私有模板 |
| 模板：创建/编辑/删除 | 全部（可设公共） | 仅本人私有 |
| 公共模板"另存为"个人副本 | ✓ | ✓ |
| 数据源/关键词门/语义 prompt/行业类目配置 | ✓ | ✗（前端隐藏 + API 403） |
| Tracker 运行/停止/设置 | ✓ | ✗ |
| LLM 模型/搜索源/系统 prompt 配置 | ✓ | ✗ |
| 反馈审阅（采纳/拒绝规则建议、全局权重） | ✓ | ✗ |
| 删除 insight | ✓ | ✗ |
| 用户管理、邀请码管理 | ✓ | ✗ |
| 统一配置导入/导出 | ✓ | ✗ |

### 3.6 FR-VIEW 自定义视角（insights pool 筛选配置）

| ID | 需求 |
|---|---|
| VIEW-1 | 入口就在情报卡片页面（IntelligencePage 筛选区新增"自定义视角"开关与管理面板），不新增独立页面。 |
| VIEW-2 | 视角 = 命名的筛选条件集，复用现有查询维度：用途 purposes、类别 businessCategory、主题 subjectCategory、业务领域 businessDomain、玩家 enterpriseType、来源 sourceType、关键词 search、日期习惯项（相对天数，可选）。普通用户只能从这些"读侧筛选"能力配置，不暴露任何入池过滤配置。 |
| VIEW-3 | 用户可将当前筛选栏条件一键"保存为视角"，支持命名、重命名、删除、更新（覆盖保存）。每用户视角上限 10 个（已确认），超限时提示用户先删除旧视角。 |
| VIEW-4 | 开关语义：开启某视角 → 列表按该视角筛选集加载（自定义视角优先于公共视角）；关闭视角 → 回到公共 insights pool（应用当前公共筛选状态，不默认加筛选）。 |
| VIEW-5 | 视角可设"默认视角"；登录进入情报页自动启用默认视角（可关）。邀请码携带的默认视角配置在开通时落为首个视角。 |
| VIEW-6 | 临时修改筛选条件不自动回写视角；仅"覆盖保存"动作更新视角。视角开启状态下手动改筛选，UI 需给出"当前已偏离视角，是否更新视角"提示。 |
| VIEW-7 | 视角数据存独立表 `user_views`（owner 隔离），与管理员 filter_rules/filter_config 完全无关。API 仅 CRUD 本人视角（admin 可见/管理全部）。 |
| VIEW-8 | 报告生成的候选卡片默认取当前生效视角（开启=视角，关闭=公共池），用户可在多选卡片时手动扩选（仍限全池可读范围内）。 |

### 3.7 FR-OWNER 报告与模板归属隔离

| ID | 需求 |
|---|---|
| OWN-1 | 不新增页面、不改功能形态：沿用 ReportsPage、模板管理、生成报告流程，仅在数据层与展示层加归属。 |
| OWN-2 | `reports` / `report_jobs` 增加 `owner_id`。普通用户列表只返回本人报告/任务；生成、编辑、删除、重试、导出仅限本人资源（API 校验归属）。 |
| OWN-3 | admin 可见所有人的报告与任务，并在列表/详情标注归属用户（微信昵称），可按用户筛选。 |
| OWN-4 | `report_templates` 增加 `owner_id`；语义调整为三级：公共模板（owner=admin 且 is_public=1，所有人可用）、本人私有模板、admin 视角下的全部模板（带归属标注）。普通用户不可见他人私有模板。 |
| OWN-5 | 普通用户可创建/修改/删除自己的私有模板；可对公共模板"另存为副本"后自由修改，不反向影响公共模板。 |
| OWN-6 | 存量数据迁移：所有现有 reports / report_jobs / report_templates 的 owner 归属到 seed 管理员；现有 `is_public=1` 模板保持公共可用，行为对 admin 零破坏。 |

### 3.8 FR-FB 反馈隔离与提交审批

| ID | 需求 |
|---|---|
| FB-1 | `user_feedback` 增加 `user_id` 与 `submit_state`（none/submitted/accepted/rejected）。 |
| FB-2 | 普通用户的 bookmark/hide 仅作为个人数据（影响个人卡片状态），**不再**进入全局 `feedback_semantic_weights`，也不触发规则建议——防止多用户行为污染入池管道。 |
| FB-3 | 普通用户可对反馈原因补充说明并"提交给管理员"；提交后生成一条带提交人署名的规则建议/权重意见，进入现有 `feedback_rules_suggestions` 审批队列（扩展 submitter_id 字段）。 |
| FB-4 | 管理员在 FeedbackPage 审阅：可见提交人（昵称），操作维持 pending/accepted/rejected 三态；采纳后写入 `filter_rules`（全局生效），拒绝则归档。 |
| FB-5 | 管理员自己的 bookmark/hide 维持现有全链路行为不变（直接进权重与建议流）。 |
| FB-6 | 存量 `user_feedback` 迁移归属到 seed 管理员，历史权重不回滚。 |

### 3.9 FR-ADMIN 用户与邀请码管理

| ID | 需求 |
|---|---|
| ADM-1 | 新增管理员"用户管理"入口（Configuration 下）：用户列表（昵称/角色/状态/注册时间/最近登录/注册来源邀请码）、启用/禁用、角色变更。禁用 = 仅阻断登录，其报告/模板/视角/反馈数据全部保留，可随时重新启用（已确认）。 |
| ADM-2 | 邀请码管理：创建（设置角色、默认视角配置 JSON、可用次数[单次/多次/无限]、有效期、备注）、停用、查看使用记录。 |
| ADM-3 | admin 可全局视角查看各用户的报告数量/模板数量（只读，便于运营），但不进入普通用户的私有编辑流。 |

### 3.10 数据模型变更（新增迁移，编号顺延 023+）

```text
users            id, unionid UNIQUE, openid_web, openid_mp, nickname, avatar_url,
                 role CHECK('admin','user') DEFAULT 'user', status('active','disabled'),
                 invited_by_code_id, created_at, last_login_at
invite_codes     id, code UNIQUE, label, role, default_view JSON,
                 max_uses NULL=不限, used_count, expires_at NULL=长期,
                 active, note, created_by, created_at
sessions         id, user_id, token_hash, user_agent, created_at, expires_at
user_views       id, user_id, name, filters JSON, is_default, sort_order,
                 created_at, updated_at

ALTER reports            ADD owner_id INTEGER      -- 迁移：seed admin
ALTER report_jobs        ADD owner_id INTEGER
ALTER report_templates   ADD owner_id INTEGER
ALTER user_feedback      ADD user_id INTEGER, ADD submit_state TEXT DEFAULT 'none'
ALTER feedback_rules_suggestions ADD submitter_id INTEGER
```

### 3.11 API 变更概览

- 全局鉴权中间件：除 `/api/auth/*`、健康检查外所有 `/api/*` 要求有效 session。
- 新增：`POST /api/auth/wechat/login`（code→identity，未注册返回 need_invite + 临时票据）、`POST /api/auth/wechat/register`（票据+邀请码）、`POST /api/auth/logout`、`GET /api/auth/me`。
- 新增：`/api/views`（本人 CRUD）、`/api/admin/users`、`/api/admin/invite-codes`、`POST /api/feedback/:id/submit`（提交给管理员）。
- 收紧：`sources / filters / industries / settings / models / searchProviders / tracker / feedback决策 / 配置导入导出` 全部挂 `requireAdmin`。
- 归属过滤：`reports`、`report/templates`、`report/screening|clarify|generate`、`feedback` 按 owner 校验；admin 列表返回 owner 信息（`?all=1`）。
- 响应遵循现有 `{ data } / { error }` 约定；越权返回 403，不存在归属资源返回 404（不泄露存在性）。

### 3.12 前端变更概览

- 登录流程页：微信授权回跳、邀请码输入页（首次）、已禁用提示页。
- App.jsx 引入用户态：Header 显示昵称/头像 + 登出；Sidebar 按角色显隐（user 只见 Intelligence / Reports；admin 增加 Configuration / Feedback / 用户管理）。
- IntelligencePage：筛选区加"自定义视角"开关 + 管理面板（保存/切换/更新/删除/设默认），偏离视角时提示。
- ReportsPage / 模板管理：user 自动仅见本人+公共模板；admin 增加归属列与按用户筛选；公共模板加"另存为"。
- FeedbackPage（admin）：规则建议显示提交人与补充说明。
- 新增文案全部进 i18n（zh/en）双语。

### 3.13 非功能需求

| ID | 需求 |
|---|---|
| NF-1 | 安全：仅 HTTPS（生产 eih.cmyself.cc）；session cookie HttpOnly+SameSite=Lax；邀请码校验限速（如 5 次/分钟/设备），防枚举；微信 appid/secret 走服务端环境变量，`.env` 不入库。 |
| NF-2 | 兼容：迁移脚本幂等；升级后管理员既有工作流零感知；存量匿名 bookmark/hide 数据归入 seed admin。 |
| NF-3 | 性能：归属过滤不改变现有查询复杂度；insights 列表与报告接口现有响应时间不回退。 |
| NF-4 | 隐私：用户间私有资源不可见；admin 可查全局属于管理职责；昵称头像仅存展示所需最小数据。 |
| NF-5 | 数据红线：遵循项目约定——未经产品负责人批准不得删除任何数据库数据（尤其配置）。 |
| NF-6 | 测试：鉴权中间件、归属过滤、视角 CRUD、邀请码开通流补 Vitest 用例（colocated `*.test.js`）；上线前走测试环境（:3001 本地库）全流程回归，禁止直连生产库验证。 |

### 3.14 里程碑

| 里程碑 | 内容 | 交付判定 |
|---|---|---|
| M1 身份与角色 | users/sessions/invite_codes 迁移、微信登录（web 端）、邀请码开通流、全局鉴权中间件、requireAdmin、角色显隐 | 新用户凭邀请码完成开通→登录→再入免码；未登录 API 全 401；admin 配置面对 user 403 |
| M2 归属隔离 | reports/jobs/templates owner 迁移与 API 归属过滤、前端标注与筛选、另存为公共模板 | user A 不可见 user B 报告与私有模板；admin 全量+归属标注；存量数据归 admin 可正常读写 |
| M3 自定义视角 | user_views、情报页视角开关与管理面板、默认视角、与报告候选联动 | 开/关视角在公共池与个人视角间切换正确；视角优先规则符合 VIEW-4/6 |
| M4 反馈审批 | user_feedback 隔离、提交审批流、FeedbackPage 扩展 | user 反馈不影响全局权重；提交→admin 采纳→filter_rules 生效链路完整 |

### 3.15 Open Questions

- **OQ-1 微信登录形态** ✅已确认（2026-10-14）：微信登录/小程序授权主要为了获得注册信息，**邀请码才是授权的钥匙**；web 端用开放平台扫码，小程序接入后自动弹出授权。待办依赖：确认开放平台资质（网站应用 + 小程序同主体绑定，UnionID 互通）。
- **OQ-2 邀请码默认策略** ✅已确认（2026-10-14）：邀请码**可复用**，但可设定有效期与可注册用户数上限（均可选，默认不限）。
- **OQ-3 邀请码"默认配置"的边界** ✅已确认（2026-10-14）：邀请码只携带**角色 + 默认视角配置**两项，不需要预置模板引用、报告频率等其他偏好。
- **OQ-4 视角数量** ✅已确认（2026-10-17）：每用户视角上限 10 个；"用户视角分享给同事"本期不做，列为远期。
- **OQ-5 禁用用户的数据处理** ✅已确认（2026-10-17）：禁用 = 只挡登录，报告/模板/视角/反馈数据全部保留，可重新启用恢复（符合"不删库"红线）。

---

## 4. 附录

### A. 术语

- **Insights Pool**：`insights` 表承载的全局卡片池，由采集管道统一维护；本期对普通用户呈现为"公共池 + 个人视角筛选"。
- **自定义视角（View）**：命名并持久化的读侧筛选条件集，仅作用于该用户的浏览与报告候选范围。
- **邀请码（Invite Code）**：管理员预配的开通凭证与授权钥匙，携带角色与默认配置，可复用（可选设可注册用户数上限与有效期）；开通后账号与码解耦（保留来源记录）。

### B. 相关文档

- 仓库工程约定：`AGENTS.md`（架构、命令、环境隔离红线）
- 历史复刻参考（不再维护）：工作区 `PRD_China_Intelligence_Insights_Hub.md` / `EDD_China_Intelligence_Insights_Hub.md`
- 微信数据接入：`wechat-mcp/README.md`
