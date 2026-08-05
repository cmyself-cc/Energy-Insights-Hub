import { fetchWithTimeout } from "../crawlers/utils.js";

function buildConfig() {
  return {
    providerId: process.env.LLM_PROVIDER || "openai",
    baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
    modelId: process.env.LLM_MODEL || "gpt-4o-mini",
    apiKey: process.env.LLM_API_KEY
  };
}

export async function callLlm(messages, { maxTokens = 4000, temperature = 0.3, timeoutMs = 120000 } = {}) {
  const config = buildConfig();
  if (!config.apiKey) throw new Error("LLM API key not configured");
  const isAnthropic = config.providerId === "anthropic";
  const url = isAnthropic ? `${config.baseUrl}/messages` : `${config.baseUrl}/chat/completions`;
  const headers = isAnthropic
    ? { "Content-Type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" }
    : { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` };
  const body = { model: config.modelId, messages, max_tokens: maxTokens, temperature };
  if (!isAnthropic) body.thinking = { type: "disabled" };

  const response = await fetchWithTimeout(url, { method: "POST", headers, body: JSON.stringify(body) }, timeoutMs);
  if (!response.ok) {
    let detail = "";
    try { const j = await response.json(); detail = j?.error?.message || JSON.stringify(j).slice(0, 200); } catch { /* ignore */ }
    throw new Error(`LLM API failed: ${response.status} ${detail}`);
  }
  const data = await response.json();
  const raw = isAnthropic
    ? (data.content?.[0]?.text || "")
    : (data.choices?.[0]?.message?.content || "");
  return String(raw).replace(/```json\s*|\s*```/g, "").trim();
}

export async function callLlmJson(messages, opts = {}) {
  const txt = await callLlm(messages, { ...opts, temperature: opts.temperature ?? 0.1 });
  try {
    return JSON.parse(txt);
  } catch (e) {
    throw new Error(`LLM returned invalid JSON (${e.message}). Raw preview: ${txt.slice(0, 120)}`);
  }
}
