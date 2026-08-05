import { callLlmJson } from "../lib/llmClient.js";

function fallbackPlan(template, insights) {
  return {
    inconsistencies: [],
    searchPlan: insights.map(ins => {
      const parts = [ins.title, ...(ins.keywords ? ins.keywords.split(",").map(s => s.trim()).slice(0, 3) : [])].filter(Boolean);
      return { cardId: ins.id, queries: [parts.join(" ")] };
    }),
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
