import db from "../db.js";
import { fetchWithTimeout } from "../crawlers/utils.js";

function safeJson(value) {
  if (!value) return [];
  try { return JSON.parse(value); } catch { return []; }
}

function buildRequest(config, messages, maxTokens = 8192) {
  const isAnthropic = config.providerId === "anthropic";
  const url = isAnthropic ? `${config.baseUrl}/messages` : `${config.baseUrl}/chat/completions`;
  const headers = isAnthropic
    ? { "Content-Type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" }
    : { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` };
  const body = { model: config.modelId, messages, max_tokens: maxTokens, temperature: 0.3 };
  if (!isAnthropic) {
    // Reasoning models (e.g. DeepSeek v4 flash) can burn the whole token budget
    // on reasoning_content and return an empty answer; this task only needs a
    // direct JSON reply, so disable thinking explicitly.
    body.thinking = { type: "disabled" };
  }
  return { url, headers, body };
}

function extractContent(data, config) {
  if (config.providerId === "anthropic") return data.content?.[0]?.text || "";
  return data.choices?.[0]?.message?.content || "";
}

export async function generateSuggestions() {
  const config = {
    providerId: process.env.LLM_PROVIDER || "openai",
    baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
    modelId: process.env.LLM_MODEL || "gpt-4o-mini",
    apiKey: process.env.LLM_API_KEY
  };
  if (!config.apiKey) throw new Error("LLM API key not configured");

  const rows = db.prepare("SELECT * FROM user_feedback ORDER BY created_at DESC LIMIT 100").all();
  if (rows.length === 0) return { generated: 0 };

  const samples = rows.map(r => ({
    action: r.action,
    reason: r.reason,
    title: r.title,
    summary: r.summary,
    keywords: safeJson(r.keywords),
    purposes: safeJson(r.purposes),
    categories: safeJson(r.categories)
  }));

  const prompt = `你是一名能源情报平台的规则优化助手。请分析用户的收藏和隐藏反馈，提炼出可以用于过滤未来文章的关键词规则。

反馈数据：
${JSON.stringify(samples, null, 2)}

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
- evidence: string[]`;

  const { url, headers, body } = buildRequest(config, [{ role: "user", content: prompt }]);
  const response = await fetchWithTimeout(url, { method: "POST", headers, body: JSON.stringify(body) }, 60000);
  if (!response.ok) throw new Error(`LLM API failed: ${response.status}`);

  // Read the raw body first so a non-JSON gateway response produces a
  // meaningful error instead of "Unexpected end of JSON input".
  let data;
  try {
    data = await response.json();
  } catch (e) {
    throw new Error(`LLM API returned a non-JSON response: ${e.message}`);
  }
  const finishReason = data.choices?.[0]?.finish_reason;
  const txt = extractContent(data, config).replace(/```json\s*|\s*```/g, "").trim();
  if (!txt) {
    if (finishReason === "length") {
      throw new Error("LLM response was truncated (token limit reached with no content); please retry or increase the model limit");
    }
    throw new Error("LLM returned an empty response");
  }
  let suggestions;
  try {
    suggestions = JSON.parse(txt);
  } catch (e) {
    throw new Error(`LLM returned invalid JSON (${e.message}). Raw preview: ${txt.slice(0, 120)}`);
  }
  if (!Array.isArray(suggestions)) throw new Error("Invalid suggestions format");

  const insert = db.prepare(
    "INSERT INTO feedback_rules_suggestions (type, name, purpose, reason, evidence) VALUES (?, ?, ?, ?, ?)"
  );
  const insertMany = db.transaction((list) => {
    for (const s of list) {
      insert.run(s.type, s.name, s.purpose || "", s.reason || "", JSON.stringify(s.evidence || []));
    }
  });
  insertMany(suggestions);

  return { generated: suggestions.length };
}
