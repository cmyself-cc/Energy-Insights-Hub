import { callLlm, callLlmJson } from "../lib/llmClient.js";
import { getPrompt, fillPrompt } from "./promptStore.js";

function fallbackPlan(template, insights) {
  return {
    quality: [],
    purposeOptions: [template.purpose || template.name, "专题分析报告"],
    purpose: template.purpose || template.name,
    audienceOptions: ["团队内部", "管理层决策"],
    audience: "团队内部",
    themeOptions: [template.purpose || template.name],
    theme: template.purpose || template.name,
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
  const prompt = fillPrompt(getPrompt("screen_cards"), {
    template_name: template.name,
    max_cards: template.max_cards || 10,
    cards_json: JSON.stringify(cardBlock(insights), null, 2)
  });
  try {
    const parsed = await callLlmJson([{ role: "user", content: prompt }], { maxTokens: 4000 });
    const fallback = fallbackPlan(template, insights);
    return {
      quality: Array.isArray(parsed?.quality) ? parsed.quality : [],
      purposeOptions: Array.isArray(parsed?.purposeOptions) && parsed.purposeOptions.length > 0 ? parsed.purposeOptions : fallback.purposeOptions,
      purpose: parsed?.purpose || fallback.purpose,
      audienceOptions: Array.isArray(parsed?.audienceOptions) && parsed.audienceOptions.length > 0 ? parsed.audienceOptions : fallback.audienceOptions,
      audience: parsed?.audience || fallback.audience,
      themeOptions: Array.isArray(parsed?.themeOptions) && parsed.themeOptions.length > 0 ? parsed.themeOptions : fallback.themeOptions,
      theme: parsed?.theme || fallback.theme,
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
  const prompt = fillPrompt(getPrompt("clarify_cards"), {
    template_name: template.name,
    template_purpose: template.purpose || "未指定",
    cards_json: JSON.stringify(cardBlock(insights), null, 2),
    answers_json: JSON.stringify(answers, null, 2)
  });
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
  const langName = language === "en" ? "English" : "中文";
  const fallback = fillPrompt(getPrompt("manual_prompt_fallback"), {
    topic: topic || "",
    framework: framework || "按主题分节",
    outline: outline || "",
    conclusion: conclusion || "",
    language: langName
  });
  try {
    const prompt = fillPrompt(getPrompt("generate_manual_prompt"), {
      topic: topic || "（未指定）",
      framework: framework || "（未指定）",
      outline: outline || "（未指定）",
      conclusion: conclusion || "（未指定）",
      output_language: langName
    });
    const text = await callLlm([{ role: "user", content: prompt }], { maxTokens: 4000, temperature: 0.3 });
    if (!text || text.length < 10) return { prompt: fallback, generated: false };
    return { prompt: text, generated: true };
  } catch (e) {
    console.error("[screening] manual prompt fallback:", e.message);
    return { prompt: fallback, generated: false };
  }
}
