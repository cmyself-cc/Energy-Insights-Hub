import { fetchWithTimeout } from "../crawlers/utils.js";
import db from "../db.js";

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
      summary: item.summary,
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
  const categoryList = categoryNames.length > 0 ? categoryNames.join("、") : "电力&氢能、储能、光伏、油气、CCS、化工、LNG/天然气、移动出行、润滑油、生物燃料、战略合作、收并购、项目";

  const prompt = `你是一名能源行业分析师。请阅读以下文章并提取结构化洞察。

Title: ${item.title}
Content: ${item.rawContent || item.summary || ""}
URL: ${item.url}

CRITICAL RULES:
1. title: 用最精简的中文（10-20字）概括核心事件。剔除来源名、日期、作者名、废话词，聚焦发生了什么、主体是谁、关键结果。
2. summary: 清理所有噪音（作者名、来源署名、日期、填充短语、广告、无关上下文），用中文写一个信息密集的摘要，最多150字，每个字都要携带信息。
3. keywords: 恰好3个字符串，必须是具体可搜索的关键词：公司名称、技术名称、事件名称或政策名称。不要宽泛概念。示例：宁德时代、钠离子电池、136号文、电价改革、中石化、CCUS。
4. purposes: 根据内容判断该文章属于哪些监控类型（可多选）。必须严格符合以下定义：
   - competitor: 涉及能源企业的投资、收购、合作、签约、合资、并购等竞争动态
   - policy: 涉及政策、规划、通知、批复、标准、方案、意见等的发布或解读
   - tech: 涉及技术突破、创新、研发、专利、量产、示范应用等技术进展
   如果文章内容不符合以上任何一类，返回空数组 []，该文章将被丢弃。
5. categories: 从以下分类中选择最相关的1-3个：${categoryList}。必须至少包含一个业务分类（电力&氢能、储能、光伏、油气、CCS、化工、LNG/天然气、移动出行、润滑油、生物燃料），可再搭配事件分类（战略合作、收并购、项目）。
6. china_relevance: 判断这篇文章是否与中国强相关（发生在中国、涉及中国企业/机构、中国政策、中国市场或中国技术）。只返回布尔值 true 或 false。

CRITICAL: 只有 china_relevance 为 true 的文章才保留。如果内容与中国无关（如仅涉及越南、美国、欧洲本地市场且与中国无关联），必须返回空数组 []，该文章将被丢弃。

Return ONLY a valid JSON object (no markdown, no explanation) with exactly these fields:
- title: string
- summary: string (max 150 Chinese characters)
- keywords: array of exactly 3 strings
- purposes: array of strings (competitor, policy, tech, or empty [])
- categories: array of strings
- china_relevance: boolean
- title: string
- summary: string (max 150 Chinese characters)
- keywords: array of exactly 3 strings
- purposes: array of strings (competitor, policy, tech, or empty [])
- categories: array of strings`;

  const messages = [{ role: "user", content: prompt }];
  const { url, headers, body } = buildRequest(config, messages, 2000, 0.5);

  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    }, 60000);

    if (!response.ok) {
      throw new Error(`LLM API failed: ${response.status}`);
    }

    const data = await response.json();
    const txt = extractContent(data, config);
    const cleanTxt = txt.replace(/```json\s*|\s*```/g, "").trim();
    const parsed = JSON.parse(cleanTxt);

    return {
      title: parsed.title || item.title,
      summary: parsed.summary || item.summary,
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
      chinaRelevance: parsed.china_relevance === true
    };
  } catch (e) {
    console.error("LLM process failed:", e.message);
    return {
      title: item.title,
      summary: item.summary,
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
