import db from "../db.js";
import { fetchWithTimeout } from "../crawlers/utils.js";
import { getPrompt, fillPrompt } from "./promptStore.js";

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
    fromPurpose: r.from_purpose,
    toPurpose: r.to_purpose,
    title: r.title,
    summary: r.summary,
    keywords: safeJson(r.keywords),
    purposes: safeJson(r.purposes),
    categories: safeJson(r.categories)
  }));

  const prompt = fillPrompt(getPrompt("feedback_suggestions"), {
    samples_json: JSON.stringify(samples, null, 2)
  });

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
  const existsSuggestion = db.prepare(
    "SELECT 1 FROM feedback_rules_suggestions WHERE type = ? AND name = ? AND purpose = ? AND status IN ('pending', 'accepted') LIMIT 1"
  );
  const existsRule = db.prepare(
    "SELECT 1 FROM filter_rules WHERE type = ? AND name = ? AND purpose = ? AND active = 1 LIMIT 1"
  );
  const insertMany = db.transaction((list) => {
    for (const s of list) {
      if (!s || !s.type || !s.name) continue;
      const purpose = s.purpose || "";
      // 跳过已存在（pending/accepted 建议或已生效规则）
      if (existsSuggestion.get(s.type, s.name, purpose)) continue;
      if (existsRule.get(s.type, s.name, purpose)) continue;
      insert.run(s.type, s.name, purpose, s.reason || "", JSON.stringify(s.evidence || []));
    }
  });
  insertMany(suggestions);

  return { generated: suggestions.length };
}
