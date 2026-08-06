import { callLlm, callLlmJson } from "../lib/llmClient.js";

function fallbackPlan(template, insights) {
  return {
    quality: [],
    purposeOptions: [template.purpose || template.name, "专题分析报告"],
    purpose: template.purpose || template.name,
    audienceOptions: ["团队内部", "管理层决策"],
    audience: "团队内部",
    searchPlan: insights.map(ins => {
      const parts = [ins.title, ...(ins.keywords ? ins.keywords.split(",").map(s => s.trim()).slice(0, 3) : [])].filter(Boolean);
      return { cardId: ins.id, queries: [parts.join(" ")] };
    }),
    exceedsLimit: insights.length > (template.max_cards || 10)
  };
}

function cardBlock(insights) {
  return insights.map(ins => ({
    cardId: ins.id,
    title: ins.title,
    summary: ins.summary,
    url: ins.url,
    keywords: ins.keywords,
    source: ins.source_name,
    date: ins.publish_date
  }));
}

// 第一步筛查：卡片质量（矛盾/重复/不相关）+ 用途与受众推测
export async function screenCards({ template, insights }) {
  const prompt = `你是报告生成的前置筛查员。用户勾选了以下卡片，将用模板"${template.name}"生成报告（卡片上限 ${template.max_cards || 10}）。

卡片数据：
${JSON.stringify(cardBlock(insights), null, 2)}

请完成：
1. 数据质量筛查：检测卡片间是否存在 (a) 矛盾（数值/日期/事实冲突）、(b) 重复（内容高度相似）、(c) 完全不相关（与整体主题无关）。每条 issue 给出动态处理选项 options（如：保留全部并标注差异 / 优先最新 / 仅保留其一 / 移除该卡片）与建议 suggested；若无问题 quality 为空数组；
2. 基于确认后的卡片信息推测 2-3 个可能的报告用途（purposeOptions）并给出首选 purpose；
3. 推测 2-3 个可能的报告读者/受众（audienceOptions）并给出首选 audience；
4. 为每张卡片生成 1-3 个 websearch 搜索查询（中文）；
5. 若卡片数超过上限 ${template.max_cards || 10}，exceedsLimit=true 并建议保留哪些。

返回 ONLY a valid JSON object：
- quality: [{kind: "contradiction"|"duplicate"|"irrelevant", issue: string, cardIds: number[], options: string[], suggested: string}]
- purposeOptions: string[]
- purpose: string
- audienceOptions: string[]
- audience: string
- searchPlan: [{cardId: number, queries: string[]}]
- exceedsLimit: boolean`;
  try {
    const parsed = await callLlmJson([{ role: "user", content: prompt }], { maxTokens: 4000 });
    const fallback = fallbackPlan(template, insights);
    return {
      quality: Array.isArray(parsed?.quality) ? parsed.quality : [],
      purposeOptions: Array.isArray(parsed?.purposeOptions) && parsed.purposeOptions.length > 0 ? parsed.purposeOptions : fallback.purposeOptions,
      purpose: parsed?.purpose || fallback.purpose,
      audienceOptions: Array.isArray(parsed?.audienceOptions) && parsed.audienceOptions.length > 0 ? parsed.audienceOptions : fallback.audienceOptions,
      audience: parsed?.audience || fallback.audience,
      searchPlan: Array.isArray(parsed?.searchPlan) ? parsed.searchPlan : fallback.searchPlan,
      exceedsLimit: Boolean(parsed?.exceedsLimit) || insights.length > (template.max_cards || 10)
    };
  } catch (e) {
    console.error("[screening] LLM unavailable, using fallback:", e.message);
    return fallbackPlan(template, insights);
  }
}

// 追问轮（保留：供问答式澄清使用）
export async function clarifyCards({ template, insights, answers = [] }) {
  const prompt = `你是报告生成的前置筛查员。用户已对上一轮澄清问题作答，请判断是否还需要追问。

模板：${template.name}（用途：${template.purpose || "未指定"}）
卡片数据：
${JSON.stringify(cardBlock(insights), null, 2)}

用户的回答：
${JSON.stringify(answers, null, 2)}

请：
1. 若所有问题都已澄清，返回 questions 为空数组，done=true，把用户回答整理为 resolutions（key/issue/choice/cardIds）；
2. 若仍有疑问，返回 1-3 条追问 questions（带 options 与 suggested），done=false，已明确的回答并入 resolutions；
3. 给出最终报告用途 purpose。

返回 ONLY a valid JSON object：
- questions: [{key: string, issue: string, cardIds: number[], options: string[], suggested: string}]
- resolutions: [{key: string, issue: string, choice: string, cardIds: number[]}]
- purpose: string
- done: boolean`;
  try {
    const parsed = await callLlmJson([{ role: "user", content: prompt }], { maxTokens: 4000 });
    return {
      questions: Array.isArray(parsed?.questions) ? parsed.questions : [],
      resolutions: Array.isArray(parsed?.resolutions) ? parsed.resolutions : answers,
      purpose: parsed?.purpose || template.purpose || template.name,
      done: parsed?.done === true || !Array.isArray(parsed?.questions) || parsed.questions.length === 0
    };
  } catch (e) {
    console.error("[screening] clarify fallback to done:", e.message);
    return { questions: [], resolutions: answers, purpose: template.purpose || template.name, done: true };
  }
}

// 用户手动输入主题/框架/大纲/核心结论 → LLM 生成报告提示词模板
export async function generateManualPrompt({ topic, framework, outline, conclusion, language = "zh" }) {
  const fallback = `你是能源行业情报分析师。请基于以下要求撰写报告。
主题：${topic || ""}
框架：${framework || "按主题分节"}
大纲：${outline || ""}
核心结论：${conclusion || ""}

要求：
1. 严格按上述主题/框架/大纲组织内容；
2. 引用已选卡片（编号+标题+来源）与搜索补充信息，并标注来源链接；
3. 数据冲突按用户处理决定处理；
4. 使用 Markdown 排版，输出语言：${language === "en" ? "English" : "中文"}。
日期：{{date}}
输入数据：{{insights}}
搜索补充：{{search_results}}
用户澄清决定：{{resolutions}}`;
  try {
    const prompt = `你是一名报告提示词工程师。用户要生成一份报告，请根据以下需求编写一份完整的报告生成提示词模板（将用于大模型生成报告）。

报告主题：${topic || "（未指定）"}
框架：${framework || "（未指定）"}
大纲：${outline || "（未指定）"}
核心结论要求：${conclusion || "（未指定）"}
输出语言：${language === "en" ? "English" : "中文"}

提示词模板必须：
1. 明确报告目的、读者、结构；
2. 包含占位符：{{date}} {{language}} {{insights}}（已选卡片数据）{{search_results}}（搜索补充）{{resolutions}}（用户澄清决定）；
3. 要求引用卡片编号与来源、标注搜索补充来源链接、区分「来自已选卡片」与「来自外部搜索」；
4. 使用 Markdown 排版要求。

返回 ONLY 提示词正文（纯文本，不要 JSON 包装、不要 markdown 代码围栏）。`;
    const text = await callLlm([{ role: "user", content: prompt }], { maxTokens: 4000, temperature: 0.3 });
    if (!text || text.length < 10) return { prompt: fallback, generated: false };
    return { prompt: text, generated: true };
  } catch (e) {
    console.error("[screening] manual prompt fallback:", e.message);
    return { prompt: fallback, generated: false };
  }
}
