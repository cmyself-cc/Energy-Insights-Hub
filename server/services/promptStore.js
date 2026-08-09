import db from "../db.js";

// 可在线调优的 LLM 系统提示词。
// 代码中保留出厂默认值；启动时 seed 入库（幂等、不覆盖手工编辑），
// 运行时优先读库。占位符用 {{name}}，fillPrompt 只替换已知变量键，
// 因此模板正文里作为「报告占位符」的字面 {{date}}/{{insights}} 等不会被误伤。
export const DEFAULT_PROMPTS = {
  insight_extraction: {
    description: "爬取后洞察提取：标题/摘要/关键词/行业动态筛查/业务分类/中国相关性",
    content: `你是一名能源行业分析师。请阅读以下文章并提取结构化洞察。

Title: {{title}}
Content: {{content}}
URL: {{url}}
{{semantic_block}}
CRITICAL RULES:
0. SINGLE FOCUS: 如果原文包含多条独立新闻或事件，只提取最主要、篇幅最大的那一条。标题、摘要和关键字都只围绕这一条核心信息，忽略其他次要内容。
1. title: 只概括一条核心事件，用最精简的中文（10-20字）概括核心事件。剔除来源名、日期、作者名、文学修饰词、废话词，标准格式严格参考：主体+发生了什么或关键结果是什么。标题必须包含下列主体关键词列表中、与事件主体所属类别对应的一个关键词
{{subject_keywords}}
如果 event_kind 为 industry_overview（事件主体是行业整体/宏观层面），标题必须以行业主体为主语（如"中国核电"、"LNG"、"钠离子电池行业"），并包含行业主体（industry）列表中的关键词，以便在卡片中高亮行业关键词。
如果核心事件的主体不属于上述任何一类关键词，必须返回空数组 []，该文章将被丢弃。（若 {{subject_keywords}} 为"未配置"，则跳过本条检查。）
2. summary: 清理所有噪音（作者名、来源署名、日期、填充短语、广告、无关上下文），用中文写一个信息密集的摘要，最多150字，每个字都要携带信息。
3. keywords: 恰好3个字符串，仅限实体名称：公司名称、技术名称、政策名称、事件名称。必须是具体可搜索的关键词，不要宽泛概念，不要带数量的短语（如"50MW光伏"），不要无意义的单位或指标词（如"出货量"、"装机量"）。示例：宁德时代、钠离子电池、136号文、电价改革、中石化、CCUS。
4. event_kind: 判断该新闻的核心事件属于哪一种类型（只能选一个），事件性质决定监控类型：
   - company_action: 核心事件是某家具体公司/企业/机构自身的动作（发布新品、收购、合作、签约、投产、中标、成立公司、高管变动等）
   - policy_action: 核心事件是政策/监管/政务行为（政策发布、规划、通知、部署、专项整治、标准制定、项目招标公告等），发布方通常是政府、监管机构或行业协会
   - tech_milestone: 核心事件是技术/产品的里程碑进展（首台/首座/首个、技术突破、新专利、量产下线、示范应用、新平台投运等），强调"首次"或技术能力跃迁
   - industry_overview: 核心事件是行业整体/宏观层面情况（全国或区域的装机、产量、销量、市场规模、统计报告、行业趋势数据），不以某家具体企业为主体
5. categories: 从以下两类分类中选择最相关的1-3个：
   a) 业务方向分类：从 {{category_list}} 中选择（这是用户在“配置-内容过滤-行业初筛”中设置的业务方向关键词列表）；
   b) 主体分类：中央部委、地方政府、国有企业、外国公司、私营企业、研究机构。
   规则：必须至少包含一个业务方向分类（即 {{category_list}} 中的一项，按文章内容所属行业选择）；可再搭配至多一个主体分类，按核心事件主体的性质判断（中央级政策发布方/监管机构如国务院、国家发改委、国家能源局等→中央部委，省/市/县级政府及其部门→地方政府，央企/地方国企→国有企业，外资/跨国公司→外国公司，民营企业→私营企业，高校/科研院所→研究机构），无法判断主体性质则不加。不要返回上述两类以外的分类。
6. china_relevance: 判断这篇文章是否与中国强相关（发生在中国、涉及中国企业/机构、中国政策、中国市场或中国技术）。只返回布尔值 true 或 false。

CRITICAL: 只有 china_relevance 为 true 的文章才保留。如果内容与中国无关（如仅涉及越南、美国、欧洲本地市场且与中国无关联），必须返回空数组 []，该文章将被丢弃。

Return ONLY a valid JSON object (no markdown, no explanation) with exactly these fields:
- title: string
- summary: string (max 150 Chinese characters)
- keywords: array of exactly 3 strings
- categories: array of strings
- event_kind: one of company_action, policy_action, tech_milestone, industry_overview
- china_relevance: boolean`
  },
  screen_cards: {
    description: "报告预筛查第一步：卡片质量筛查 + 用途/受众推测 + 搜索计划",
    content: `你是报告生成的前置筛查员。用户勾选了以下卡片，将用模板"{{template_name}}"生成报告（卡片上限 {{max_cards}}）。

卡片数据：
{{cards_json}}

请完成：
1. 数据质量筛查：检测卡片间是否存在 (a) 矛盾（数值/日期/事实冲突）、(b) 重复（内容高度相似）、(c) 存在多个主题（即卡片之间主题完全无关，难以归入同一份报告的中心主题）。每条 issue 给出动态处理选项 options（如：保留全部并标注差异 / 优先最新 / 仅保留其一 / 移除该卡片 / 拆分为多份报告）与建议 suggested；若无问题 quality 为空数组；
2. 基于确认后的卡片信息推测 2-3 个可能的报告用途（purposeOptions）并给出首选 purpose；
3. 推测 2-3 个可能的报告读者/受众（audienceOptions）并给出首选 audience；
4. 基于卡片内容推荐 3-4 个候选报告主题（themeOptions，每条 6-16 字，概括报告可聚焦的主题方向，彼此之间有明显区分度），并给出首选 theme；用户也可以不选推荐而自定义主题；
5. 为每张卡片生成 1-3 个 websearch 搜索查询（中文）；
6. 若卡片数超过上限 {{max_cards}}，exceedsLimit=true 并建议保留哪些。

返回 ONLY a valid JSON object：
- quality: [{kind: "contradiction"|"duplicate"|"multi_theme", issue: string, cardIds: number[], options: string[], suggested: string}]
- purposeOptions: string[]
- purpose: string
- audienceOptions: string[]
- audience: string
- themeOptions: string[]
- theme: string
- searchPlan: [{cardId: number, queries: string[]}]
- exceedsLimit: boolean`
  },
  clarify_cards: {
    description: "报告预筛查追问轮：判断是否还需澄清并整理用户决定",
    content: `你是报告生成的前置筛查员。用户已对上一轮澄清问题作答，请判断是否还需要追问。

模板：{{template_name}}（用途：{{template_purpose}}）
卡片数据：
{{cards_json}}

用户的回答：
{{answers_json}}

请：
1. 若所有问题都已澄清，返回 questions 为空数组，done=true，把用户回答整理为 resolutions（key/issue/choice/cardIds）；
2. 若仍有疑问，返回 1-3 条追问 questions（带 options 与 suggested），done=false，已明确的回答并入 resolutions；
3. 给出最终报告用途 purpose。

返回 ONLY a valid JSON object：
- questions: [{key: string, issue: string, cardIds: number[], options: string[], suggested: string}]
- resolutions: [{key: string, issue: string, choice: string, cardIds: number[]}]
- purpose: string
- done: boolean`
  },
  generate_manual_prompt: {
    description: "用户手动输入主题/框架/大纲/核心结论 → LLM 生成报告提示词模板",
    content: `你是一名报告提示词工程师。用户要生成一份报告，请根据以下需求编写一份完整的报告生成提示词模板（将用于大模型生成报告）。

报告主题：{{topic}}
框架：{{framework}}
大纲：{{outline}}
核心结论要求：{{conclusion}}
输出语言：{{output_language}}

提示词模板必须：
1. 明确报告目的、读者、结构；
2. 包含占位符：{{date}} {{language}} {{theme}}（用户确认的报告主题）{{insights}}（已选卡片数据）{{search_results}}（搜索补充）{{resolutions}}（用户澄清决定）；
3. 要求引用卡片编号与来源、标注搜索补充来源链接、区分「来自已选卡片」与「来自外部搜索」；
4. 使用 Markdown 排版要求。

返回 ONLY 提示词正文（纯文本，不要 JSON 包装、不要 markdown 代码围栏）。`
  },
  manual_prompt_fallback: {
    description: "手动提示词生成的兜底模板（LLM 不可用时直接使用）",
    content: `你是能源行业情报分析师。请基于以下要求撰写报告。
主题：{{topic}}
框架：{{framework}}
大纲：{{outline}}
核心结论：{{conclusion}}

要求：
1. 严格按上述主题/框架/大纲组织内容；
2. 引用已选卡片（编号+标题+来源）与搜索补充信息，并标注来源链接；
3. 数据冲突按用户处理决定处理；
4. 使用 Markdown 排版，输出语言：{{language}}。
日期：{{date}}
输入数据：{{insights}}
搜索补充：{{search_results}}
用户澄清决定：{{resolutions}}`
  },
  feedback_suggestions: {
    description: "反馈建议生成：从收藏/隐藏反馈中提炼过滤规则",
    content: `你是一名能源情报平台的规则优化助手。请分析用户的收藏和隐藏反馈，提炼出可以用于过滤未来文章的关键词规则。

反馈数据：
{{samples_json}}

要求：
1. 只建议高频、明确、可执行的规则；
2. 每个建议必须附带理由和证据（引用具体标题或关键词）；
3. 不要过度泛化：不要因一篇具体负面反馈就排除整个企业或主题；
4. 区分三种规则类型：enterprise（企业）、include_keyword（包含关键词）、exclude_keyword（排除关键词）；
5. 如果反馈中多次出现某个企业/关键词被收藏，建议加入 include_keyword 或 enterprise；
6. 如果反馈中多次出现某个企业/关键词因"不相关"或"质量差"被隐藏，建议加入 exclude_keyword；
7. 为每个建议指定最相关的 purpose：competitor、policy、tech，如果不确定则留空字符串。

返回 ONLY a valid JSON array, no markdown, no explanation. 每个对象字段：
- type: "enterprise" | "include_keyword" | "exclude_keyword"
- name: string
- purpose: "competitor" | "policy" | "tech" | ""
- reason: string
- evidence: string[]`
  },
  ai_interpret_zh: {
    description: "AI 抽屉解读（中文）系统提示词",
    content: "你是一位能源行业分析师。请基于提供的文章信息给出专业、简洁的解读。"
  },
  ai_interpret_en: {
    description: "AI 抽屉解读（英文）系统提示词",
    content: "You are an energy industry analyst. Provide a professional, concise interpretation based on the article information provided."
  }
};

export const PROMPT_KEYS = Object.keys(DEFAULT_PROMPTS);

// 只替换已知变量键；正文中作为报告占位符的字面 {{date}} 等保持原样。
export function fillPrompt(template, vars = {}) {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, String(value ?? ""));
  }
  return out;
}

export function getPrompt(key) {
  try {
    const row = db.prepare("SELECT content FROM llm_prompts WHERE key = ?").get(key);
    if (row && row.content) return row.content;
  } catch {
    // Table missing (e.g. tests without initDb) — fall through to the default.
  }
  return DEFAULT_PROMPTS[key]?.content ?? null;
}

export function setPrompt(key, content) {
  db.prepare(
    "INSERT INTO llm_prompts (key, content, description) VALUES (?, ?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET content = excluded.content, updated_at = CURRENT_TIMESTAMP"
  ).run(key, content, DEFAULT_PROMPTS[key]?.description || "");
}

// Insert only if missing so edited prompts are never overwritten.
export function seedLlmPrompts() {
  const has = db.prepare("SELECT 1 FROM llm_prompts WHERE key = ?");
  const insert = db.prepare("INSERT INTO llm_prompts (key, content, description) VALUES (?, ?, ?)");
  for (const [key, def] of Object.entries(DEFAULT_PROMPTS)) {
    if (has.get(key)) continue;
    insert.run(key, def.content, def.description);
  }
}
