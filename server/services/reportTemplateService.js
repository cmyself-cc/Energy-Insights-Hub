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
