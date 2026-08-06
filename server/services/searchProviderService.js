import db from "../db.js";

export const PROVIDER_TYPES = ["bocha", "tavily"];

export const DEFAULT_BASE_URLS = {
  bocha: "https://api.bochaai.com/v1/web-search",
  tavily: "https://api.tavily.com/search"
};

function maskKey(key) {
  if (!key) return "";
  if (key.length <= 8) return `${key.slice(0, 2)}…${key.slice(-2)}`;
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

// 对外列表：绝不暴露 api_key，只给掩码
export function listSearchProviders() {
  return db.prepare("SELECT id, name, provider_type, base_url, is_active, api_key, created_at FROM search_providers ORDER BY is_active DESC, id ASC").all()
    .map(({ api_key, ...row }) => ({ ...row, is_active: row.is_active === 1, api_key_masked: maskKey(api_key) }));
}

export function getActiveSearchProvider() {
  return db.prepare("SELECT * FROM search_providers WHERE is_active = 1 LIMIT 1").get() || null;
}

export function createSearchProvider(data) {
  const { name, providerType, apiKey, baseUrl } = data;
  if (!name || !providerType || !apiKey) throw new Error("name, providerType and apiKey are required");
  if (!PROVIDER_TYPES.includes(providerType)) throw new Error(`providerType must be one of ${PROVIDER_TYPES.join(", ")}`);
  const result = db.prepare(
    "INSERT INTO search_providers (name, provider_type, api_key, base_url, is_active) VALUES (?, ?, ?, ?, ?)"
  ).run(String(name), providerType, String(apiKey), baseUrl || DEFAULT_BASE_URLS[providerType] || "", 0);
  return { id: result.lastInsertRowid, name: String(name), provider_type: providerType, is_active: false };
}

export function updateSearchProvider(id, data) {
  const existing = db.prepare("SELECT * FROM search_providers WHERE id = ?").get(id);
  if (!existing) throw new Error("Provider not found");
  const { name, providerType, apiKey, baseUrl } = data;
  if (providerType && !PROVIDER_TYPES.includes(providerType)) {
    throw new Error(`providerType must be one of ${PROVIDER_TYPES.join(", ")}`);
  }
  db.prepare(
    `UPDATE search_providers SET
       name = ?, provider_type = ?, api_key = ?, base_url = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    name ?? existing.name,
    providerType ?? existing.provider_type,
    apiKey ? String(apiKey) : existing.api_key,
    baseUrl !== undefined ? baseUrl : existing.base_url,
    id
  );
  return listSearchProviders().find(p => p.id === id);
}

export function deleteSearchProvider(id) {
  const row = db.prepare("SELECT * FROM search_providers WHERE id = ?").get(id);
  if (!row) throw new Error("Provider not found");
  if (row.is_active === 1) throw new Error("Cannot delete the active search provider; activate another one first");
  db.prepare("DELETE FROM search_providers WHERE id = ?").run(id);
  return { success: true };
}

export function activateSearchProvider(id) {
  const row = db.prepare("SELECT * FROM search_providers WHERE id = ?").get(id);
  if (!row) throw new Error("Provider not found");
  const tx = db.transaction(() => {
    db.prepare("UPDATE search_providers SET is_active = 0").run();
    db.prepare("UPDATE search_providers SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  });
  tx();
  return listSearchProviders().find(p => p.id === id);
}

// 首次启动：从环境变量播种（BOCHA_API_KEY 作为激活的博查；TAVILY_API_KEY 作为备用）
export function seedSearchProviders() {
  const count = db.prepare("SELECT COUNT(*) c FROM search_providers").get().c;
  if (count > 0) return;
  const bochaKey = process.env.BOCHA_API_KEY;
  const tavilyKey = process.env.TAVILY_API_KEY;
  const insert = db.prepare(
    "INSERT INTO search_providers (name, provider_type, api_key, base_url, is_active) VALUES (?, ?, ?, ?, ?)"
  );
  const tx = db.transaction(() => {
    if (bochaKey) insert.run("博查搜索", "bocha", bochaKey, DEFAULT_BASE_URLS.bocha, 1);
    if (tavilyKey) insert.run("Tavily 搜索", "tavily", tavilyKey, DEFAULT_BASE_URLS.tavily, 0);
  });
  tx();
}
