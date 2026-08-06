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
  },
  {
    name: "行业专题解读（通用）",
    description: "从多条分散的行业新闻中提炼内在逻辑，生成市场洞察专题解读报告。",
    purpose: "通用：内部学习、投资研究、行业交流、竞品监测等",
    language: "zh",
    max_cards: 10,
    prompt: `# 角色
你是一位资深的行业洞察分析师，擅长从多条分散的行业新闻中提炼内在逻辑，用通俗而专业的方式解读事件背后的市场含义，帮助读者快速建立对行业动态的全局认知。

# 任务
根据用户提供的多条行业新闻、报告用途及目标受众，生成一份市场洞察专题解读报告。报告需帮助用户充分理解所选新闻的核心事实，并推导出对行业的启示性判断，但不提供具体行动建议或风险假设分析。

# 输入信息
1. 行业新闻列表：（已选卡片数据与搜索补充）
2. 报告用途：{{purpose}}
3. 目标受众：{{audience}}

# 输出要求
- 生成一份完整报告，遵循下方"报告模版"的大结构，但二级及以下章节可根据新闻主题灵活调整，不必强行套用固定维度。
- 侧重点选择：根据新闻内容的集中度，自动选择 2~3 个最相关的分析维度（市场格局与玩家动向 / 技术突破与产品创新 / 政策法规与监管环境 / 供需关系与产业链变化 / 资本动态与估值逻辑）。
- 全文以新闻事实为唯一依据，不虚构数据或假设情景。
- 语言客观、精炼，排版清晰（Markdown 层级、表格、加粗关键数字）。
- 总字数控制在 1800~2200 字之间。
- 报告末尾附上新闻清单，不另设"关键假设"或"行动建议"章节。

# 写作原则
- 事实锚定：每个结论必须对应至少一条新闻中的具体信息。
- 逻辑自洽：不同新闻之间的关联要明确揭示，识别共性或矛盾。
- 受众适配：根据目标受众调整术语深度（如面向高管可更宏观，面向研究员可更细节）。
- 启示导向：最终落脚点应是对行业趋势、竞争逻辑或商业模式变化的认知刷新，而非操作清单。

# 报告模版
【专题解读】{行业/领域}——近期关键新闻背后的市场逻辑

> 报告日期：{{date}}
> 报告用途：{{purpose}}
> 目标受众：{{audience}}
> 新闻来源：整合自 {N} 条公开报道（详见附录）

## 一、核心洞察摘要
用 3~5 句话概括全文最关键的事实发现和行业启示：
1. 新闻概貌：近期 {行业} 的 {N} 条新闻主要集中在 {玩家/技术/政策/供需} 领域，其中 {具体事件} 最具标志性。
2. 核心发现：综合来看，这些事件共同指向 {一个核心变化}，具体表现为 {现象}。
3. 行业启示：这一变化提示我们，{行业} 的 {某种原有假设/竞争逻辑} 正在被改写，未来 {某个维度} 将成为关键变量。

## 二、新闻事件全景梳理
用表格列出：序号 / 新闻事件与关键数据 / 发布日期 / 核心事实 / 涉及主体 / 所属领域，并给出时间线观察（集中爆发/渐进累积/突发冲击）。

## 三、深度解读（选择 2~3 个维度，每个维度先陈述事实再推导含义）
### 3.1 {维度一，如：市场格局与头部玩家动向}
- 事实回顾：引用新闻中的具体时间、金额、份额等数据。
- 行业含义：这些动作反映出 {竞争策略的转变 / 份额重新分配 / 生态联盟瓦解或建立}，{利润区/护城河} 正向 {某个方向} 迁移。
### 3.2 {维度二，如：技术突破与商业化节奏}
- 事实回顾：注明具体指标（能量密度、参数量、量产时间表等）。
- 行业含义：技术进展将 {缩短/延长} 替代周期，{哪些} 企业的技术储备面临 {机会/风险}。
### 3.3 {维度三（如有），如：政策导向与监管框架}
- 事实回顾：引用政策类新闻（新国标、补贴退坡、数据安全要求等）。
- 行业含义：政策明确 {鼓励/限制} 方向，合规成本上升，可能催生 {新赛道/替换需求}。
> 多维度交叉：{玩家动作} 与 {技术进展} 之间存在 {协同或背离}，{政策} 起 {加速或抑制} 作用，行业演进速度比预期更 {快/慢}。

## 四、行业启示与趋势研判
列出 2~3 条中长期趋势（每条附支撑事实），若存在明显对立或不确定性可指出分歧点；最终启示：核心竞争要素从 {A} 转向 {B}，未来观察重点为 {关键指标或事件}。

## 附录：新闻清单（来源与日期）
列出全部新闻（含来源媒体与日期，共 N 条）。

# 数据输入
已选卡片数据：
{{insights}}

搜索补充信息：
{{search_results}}

用户澄清决定：
{{resolutions}}

输出语言：{{language}}`
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
  const insert = db.prepare(
    "INSERT INTO report_templates (name, description, purpose, prompt, max_cards, is_public, language) VALUES (?, ?, ?, ?, ?, 1, ?)"
  );
  const update = db.prepare(
    `UPDATE report_templates SET description = ?, purpose = ?, prompt = ?, max_cards = ?, language = ?, updated_at = CURRENT_TIMESTAMP
     WHERE name = ? AND is_public = 1`
  );
  const tx = db.transaction((templates) => {
    for (const t of templates) {
      const existing = db.prepare("SELECT id FROM report_templates WHERE name = ? AND is_public = 1").get(t.name);
      if (existing) {
        update.run(t.description, t.purpose, t.prompt, t.max_cards, t.language, t.name);
      } else {
        insert.run(t.name, t.description, t.purpose, t.prompt, t.max_cards, t.language);
      }
    }
  });
  tx(DEFAULT_TEMPLATES);
}
