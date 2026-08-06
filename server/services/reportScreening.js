import { callLlmJson } from "../lib/llmClient.js";

function fallbackPlan(template, insights) {
  return {
    questions: [],
    searchPlan: insights.map(ins => {
      const parts = [ins.title, ...(ins.keywords ? ins.keywords.split(",").map(s => s.trim()).slice(0, 3) : [])].filter(Boolean);
      return { cardId: ins.id, queries: [parts.join(" ")] };
    }),
    purpose: template.purpose || template.name,
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

// 第一轮：LLM 提出需要用户澄清的问题（数据不一致等），每题带动态选项。
export async function screenCards({ template, insights }) {
  const prompt = `你是报告生成的前置筛查员。用户将在市场洞察中勾选了以下卡片并用模板"${template.name}"生成报告（用途：${template.purpose || "未指定"}，卡片上限 ${template.max_cards || 10}）。

卡片数据：
${JSON.stringify(cardBlock(insights), null, 2)}

请完成三件事：
1. 检测卡片之间是否存在需要用户澄清的问题（如数值冲突、日期矛盾、事实矛盾、信息缺失需要用户补充说明）。每个问题生成 1 条 questions 条目，附带 2-4 个动态处理选项（如：保留全部并标注差异 / 优先最新日期 / 忽略冲突 / 其他），并给出建议项 suggested。若无问题则 questions 为空数组；
2. 为每张卡片生成 1-3 个用于 websearch 的搜索查询（中文，聚焦标题与关键词）；
3. 给出报告用途说明（一句话，供用户确认或修改）；若卡片数超过上限 ${template.max_cards || 10}，exceedsLimit 设为 true 并建议保留哪些。

返回 ONLY a valid JSON object，字段：
- questions: [{key: string, issue: string, cardIds: number[], options: string[], suggested: string}]
- searchPlan: [{cardId: number, queries: string[]}]
- purpose: string
- exceedsLimit: boolean`;
  try {
    const parsed = await callLlmJson([{ role: "user", content: prompt }], { maxTokens: 4000 });
    return {
      questions: Array.isArray(parsed?.questions) ? parsed.questions : [],
      searchPlan: Array.isArray(parsed?.searchPlan) ? parsed.searchPlan : fallbackPlan(template, insights).searchPlan,
      purpose: parsed?.purpose || template.purpose || template.name,
      exceedsLimit: Boolean(parsed?.exceedsLimit) || insights.length > (template.max_cards || 10)
    };
  } catch (e) {
    console.error("[screening] LLM unavailable, using fallback:", e.message);
    return fallbackPlan(template, insights);
  }
}

// 追问轮：携带用户对上一轮问题的回答，LLM 决定是提出追问还是澄清完成。
export async function clarifyCards({ template, insights, answers = [] }) {
  const prompt = `你是报告生成的前置筛查员。用户已对上一轮澄清问题作答，请判断是否还需要追问。

模板：${template.name}（用途：${template.purpose || "未指定"}）
卡片数据：
${JSON.stringify(cardBlock(insights), null, 2)}

用户的回答：
${JSON.stringify(answers, null, 2)}

请：
1. 若所有问题都已澄清或无需再追问，返回 questions 为空数组，done=true，并把用户回答整理为 resolutions（字段 key/issue/choice/cardIds）；
2. 若仍有疑问需要确认（例如回答含糊、产生了新的不一致、或需要确认报告的时间范围/口径等），返回 1-3 条追问 questions（同样带动态选项 options 与建议 suggested），done=false，同时把已明确的回答并入 resolutions；
3. 给出最终报告用途 purpose（可基于用户回答修正）。

返回 ONLY a valid JSON object，字段：
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
    return {
      questions: [],
      resolutions: answers,
      purpose: template.purpose || template.name,
      done: true
    };
  }
}
