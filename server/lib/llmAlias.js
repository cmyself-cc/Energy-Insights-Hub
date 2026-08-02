import { fetchWithTimeout } from "../crawlers/utils.js";

/**
 * Generate synonym/alias variants for a keyword using the configured LLM.
 * Returns an array of strings (may be empty on failure — caller degrades to base keyword only).
 *
 * Examples:
 *   "中石油" -> ["CNPC", "PetroChina", "中国石油", "中国石油集团", "中石油集团"]
 *   "energy storage" -> ["储能", "energy storage system", "ESS", "电化学储能"]
 */
export async function generateAliases(keyword) {
  const kw = String(keyword || "").trim();
  if (!kw) return [];

  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) return [];

  const config = {
    providerId: process.env.LLM_PROVIDER || "openai",
    baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
    modelId: process.env.LLM_MODEL || "gpt-4o-mini",
    apiKey
  };

  const isAnthropic = config.providerId === "anthropic";
  const url = isAnthropic ? `${config.baseUrl}/messages` : `${config.baseUrl}/chat/completions`;

  const headers = isAnthropic
    ? { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
    : { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };

  const prompt = `为关键词 "${kw}" 生成 5 个同义词（简称、官方英文名、缩写、别名），输出 JSON 数组。`;

  const body = {
    model: config.modelId,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 200,
    temperature: 0.3
  };

  // deepseek 等推理模型会先生成 reasoning_content 占用 token，偶发 content 为空。
  // 重试多次，失败时用启发式变体兜底保证有输出。
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      }, 60000);

      if (!response.ok) {
        console.warn(`[llmAlias] LLM API failed: ${response.status}`);
        return fallbackAliases(kw);
      }

      const data = await response.json();
      const txt = isAnthropic ? data.content?.[0]?.text || "" : data.choices?.[0]?.message?.content || "";
      const parsed = extractAliasArray(txt);

      if (parsed && parsed.length > 0) {
        // Deduplicate, trim, drop empties and exact base keyword
        const seen = new Set([kw.toLowerCase()]);
        const aliases = [];
        for (const item of parsed) {
          const s = String(item || "").trim();
          if (!s) continue;
          const key = s.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          aliases.push(s);
          if (aliases.length >= 12) break;
        }

        // Drop containment duplicates: if one alias is a substring of another,
        // keep the shorter one (e.g. keep "LONGi Green Energy" over
        // "LONGi Green Energy Technology" — the shorter already matches).
        const normalized = aliases.map(a => a.toLowerCase());
        const kept = [];
        for (let i = 0; i < aliases.length; i++) {
          const isContained = normalized.some((n, j) => j !== i && n.includes(normalized[i]));
          if (!isContained) kept.push(aliases[i]);
        }
        return kept;
      }
      if (attempt < 2) console.warn(`[llmAlias] Empty aliases for "${kw}", retrying (${attempt + 1})...`);
    } catch (e) {
      console.warn(`[llmAlias] Attempt ${attempt + 1} failed for "${kw}":`, e.message);
    }
  }
  return fallbackAliases(kw);
}

/**
 * 启发式兜底：LLM 完全失败时，生成基本的词形变体（大小写、括号标注、
 * 常见后缀），保证"同义词生成"始终有可用输出。
 */
function fallbackAliases(kw) {
  const s = String(kw || "").trim();
  if (!s) return [];
  const out = new Set();
  const lower = s.toLowerCase();
  const upper = s.toUpperCase();
  if (lower !== s) out.add(lower);
  if (upper !== s && upper !== lower) out.add(upper);
  if (/\s/.test(s) && !/[（(]/.test(s)) {
    const [first, ...rest] = s.split(/\s+/);
    out.add(first.toUpperCase());
    out.add(first.toUpperCase() + rest.map(w => w[0] || "").join("").toUpperCase());
  }
  // 中文词常见组合
  if (/[\u4e00-\u9fa5]/.test(s) && s.length <= 6) {
    out.add(`${s}集团`);
    out.add(`${s}公司`);
  }
  out.delete(s);
  return [...out].slice(0, 8);
}

/**
 * Extract an array of strings from LLM output, tolerating markdown fences,
 * surrounding prose, and truncated JSON.
 */
function extractAliasArray(txt) {
  if (!txt) return null;
  const clean = txt.replace(/```json\s*|\s*```/g, "").trim();

  // Direct parse
  try {
    const p = JSON.parse(clean);
    if (Array.isArray(p)) return p;
  } catch {}

  // Find the array brackets and parse the substring
  const first = clean.indexOf("[");
  const last = clean.lastIndexOf("]");
  if (first >= 0 && last > first) {
    let slice = clean.slice(first, last + 1);
    try {
      const p = JSON.parse(slice);
      if (Array.isArray(p)) return p;
    } catch {
      // Truncated array — repair with a regex scan for quoted strings
      const items = [];
      const re = /"((?:[^"\\]|\\.)*)"/g;
      let m;
      while ((m = re.exec(slice)) && items.length < 12) {
        items.push(m[1]);
      }
      if (items.length > 0) return items;
    }
  }

  // Regex scan over the whole text
  const items = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(clean)) && items.length < 12) {
    items.push(m[1]);
  }
  return items.length > 0 ? items : null;
}
