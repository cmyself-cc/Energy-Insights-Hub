import { fetchWithTimeout, stripBoilerplate, truncateAtSentence } from "../crawlers/utils.js";
import db from "../db.js";
import { getPrompt, fillPrompt } from "./promptStore.js";

const SUMMARY_MAX_LEN = 200;

/**
 * Enforce the summary contract regardless of what the LLM returned: cleaned
 * boilerplate, at most SUMMARY_MAX_LEN chars. Falls back to cleaned
 * rawContent/placeholder when the preferred text is empty.
 */
function enforceSummary(preferred, item) {
  const primary = stripBoilerplate(preferred);
  if (primary) return truncateAtSentence(primary, SUMMARY_MAX_LEN);
  const fallback = stripBoilerplate(item.rawContent || item.summary || "");
  return truncateAtSentence(fallback, SUMMARY_MAX_LEN);
}

/**
 * Safely parse JSON from LLM output, handling common issues:
 * - Truncated JSON (missing closing braces/quotes)
 * - Trailing commas
 * - Text before/after JSON object
 * - Unescaped newlines in strings
 */
function safeJsonParse(txt, fallbackItem = {}) {
  if (!txt) throw new Error("Empty LLM response");

  // 1. Try direct parse first
  try { return JSON.parse(txt); } catch {}

  // 2. Extract JSON object from text (find first { to last })
  const firstBrace = txt.indexOf("{");
  const lastBrace = txt.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    let jsonStr = txt.slice(firstBrace, lastBrace + 1);
    try { return JSON.parse(jsonStr); } catch {}
  }

  // 3. Try fixing common JSON issues
  let fixed = txt;
  // Remove trailing commas before } or ]
  fixed = fixed.replace(/,(\s*[}\]])/g, "$1");
  // Try to close unclosed strings/objects
  const openBraces = (fixed.match(/{/g) || []).length;
  const closeBraces = (fixed.match(/}/g) || []).length;
  if (openBraces > closeBraces) {
    fixed += "}".repeat(openBraces - closeBraces);
  }
  // Remove unescaped control chars in strings
  fixed = fixed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ");
  try { return JSON.parse(fixed); } catch {}

  // 4. Last resort: extract individual fields with regex
  console.warn("[llmProcessor] JSON parse failed, falling back to regex extraction");
  return {
    title: fallbackItem.title || "",
    summary: fallbackItem.summary || "",
    keywords: [],
    purposes: [],
    categories: [],
    china_relevance: true
  };
}

export function loadSemanticConfig(purpose = null) {
  if (purpose) {
    const row = db
      .prepare("SELECT content FROM filter_config WHERE type = 'semantic' AND purpose = ? AND active = 1 LIMIT 1")
      .get(purpose);
    if (row) return row.content;
  }
  const row = db
    .prepare("SELECT content FROM filter_config WHERE type = 'semantic' AND (purpose = '' OR purpose IS NULL) AND active = 1 LIMIT 1")
    .get();
  return row ? row.content : "";
}

function buildRequest(config, messages, maxTokens = 2000, temperature = 0.7) {
  const isAnthropic = config.providerId === "anthropic";
  const url = isAnthropic ? `${config.baseUrl}/messages` : `${config.baseUrl}/chat/completions`;
  const headers = isAnthropic
    ? {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01"
      }
    : {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      };
  const body = {
    model: config.modelId,
    messages,
    max_tokens: maxTokens,
    temperature
  };
  if (!isAnthropic) {
    // Reasoning models (e.g. DeepSeek v4 flash) can burn the whole token
    // budget on reasoning_content and return an empty answer; this task only
    // needs a direct JSON reply, so disable thinking explicitly.
    body.thinking = { type: "disabled" };
  }
  return { url, headers, body };
}

function extractContent(data, config) {
  if (config.providerId === "anthropic") {
    return data.content?.[0]?.text || "";
  }
  return data.choices?.[0]?.message?.content || "";
}

export async function processInsight(item, _language = "en", _filterContext = null) {
  const config = {
    providerId: process.env.LLM_PROVIDER || "openai",
    baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
    modelId: process.env.LLM_MODEL || "gpt-4o-mini",
    apiKey: process.env.LLM_API_KEY
  };

  if (!config.apiKey) {
    return {
      title: item.title,
      summary: enforceSummary(item.summary, item),
      url: item.url,
      publishDate: item.publishDate,
      sourceType: "",
      businessDomain: "",
      enterpriseType: "",
      entities: [],
      features: [],
      categories: []
    };
  }

  const categoryNames = (_filterContext?.categories || [])
    .map(c => c.name)
    .filter(Boolean);
  const categoryList = categoryNames.length > 0 ? categoryNames.join("、") : "电力&氢能、储能、光伏、油气、CCS、化工、LNG/天然气、移动出行、润滑油、生物燃料";

  // Inject purpose-specific semantic prompt if available
  let semanticBlock = "";
  const semanticPrompt = _filterContext?.semanticPrompt || "";
  if (semanticPrompt) {
    semanticBlock = `附加语义要求: ${semanticPrompt}`;
  }

  // 主体关键词按监控类型分组注入，LLM 需让标题命中对应类别的主体词
  const subjectByPurpose = _filterContext?.subjectKeywords || {};
  const subjectGroups = [
    ["公司主体（competitor）", subjectByPurpose.competitor],
    ["政策主体（policy）", subjectByPurpose.policy],
    ["技术主体（tech）", subjectByPurpose.tech],
    ["行业主体（industry）", subjectByPurpose.industry]
  ].filter(([, list]) => (list || []).length > 0);
  const subjectKeywordList = subjectGroups.length > 0
    ? subjectGroups.map(([label, list]) => `${label}: ${list.join("、")}`).join("\n")
    : "未配置";

  const prompt = fillPrompt(getPrompt("insight_extraction"), {
    title: item.title,
    content: (item.rawContent || "").slice(0, 3000) || (item.summary || "").slice(0, 3000) || "",
    url: item.url,
    semantic_block: semanticBlock,
    category_list: categoryList,
    subject_keywords: subjectKeywordList
  });

  const messages = [{ role: "user", content: prompt }];
  const { url, headers, body } = buildRequest(config, messages, 2000, 0.5);

  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    }, 90000);

    if (!response.ok) {
      throw new Error(`LLM API failed: ${response.status}`);
    }

    const data = await response.json();
    const txt = extractContent(data, config);
    const cleanTxt = txt.replace(/```json\s*|\s*```/g, "").trim();
    const parsed = safeJsonParse(cleanTxt, item);

    return {
      title: parsed.title || item.title,
      summary: enforceSummary(parsed.summary, item),
      url: item.url,
      publishDate: item.publishDate,
      source: item.source || "",
      sourceType: item.sourceType || "",
      businessDomain: item.businessDomain || "",
      enterpriseType: item.enterpriseType || "",
      entities: item.entities || [],
      features: item.features || [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 3) : [],
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      purposes: Array.isArray(parsed.purposes) ? parsed.purposes : [],
      // LLM 判定事件性质（company_action/policy_action/tech_milestone/industry_overview），
      // 由 tracker 映射为监控类型。空字符串 = LLM 未判出（回退主体关键词判定）。
      eventKind: typeof parsed.event_kind === "string" ? parsed.event_kind : "",
      chinaRelevance: parsed.china_relevance === true
    };
  } catch (e) {
    console.error("LLM process failed:", e.message);
    return {
      title: item.title,
      summary: enforceSummary(item.summary, item),
      url: item.url,
      publishDate: item.publishDate,
      sourceType: "",
      businessDomain: "",
      enterpriseType: "",
      entities: [],
      features: [],
      keywords: [],
      categories: [],
      purposes: [],
      llmFailed: true
    };
  }
}
