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

  const prompt = `You are an energy industry analyst. Read the following article and extract a structured insight.

Title: ${item.title}
Content: ${item.rawContent || item.summary || ""}
URL: ${item.url}

CRITICAL RULES:
1. title: Extract the CORE EVENT in the most concise Chinese possible (10-20 characters). Remove all noise: source names, dates, author names, filler words. Focus on WHAT happened, WHO did it, and the KEY OUTCOME.
2. summary: Clean the article of ALL noise (author names, source attribution, dates, filler phrases, advertisements, unrelated context). Write a pure, information-dense summary in Chinese, maximum 150 characters. Every word must carry information.

Return ONLY a valid JSON object (no markdown, no explanation) with exactly these three fields:
- title: string (concise Chinese, 10-20 characters, core event only)
- summary: string (pure information, max 150 Chinese characters, no noise)
- keywords: array of exactly 3 strings (specific searchable keywords: company names, technology names, event names, or policy names. NOT generic concepts. Examples: 宁德时代, 钠离子电池, 136号文, 电价改革, 中石化, CCUS)`;

  const messages = [{ role: "user", content: prompt }];
  const { url, headers, body } = buildRequest(config, messages, 1500, 0.5);

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
      sourceType: item.sourceType || "",
      businessDomain: item.businessDomain || "",
      enterpriseType: item.enterpriseType || "",
      entities: item.entities || [],
      features: item.features || [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 3) : [],
      categories: item.categories || []
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
      llmFailed: true
    };
  }
}
