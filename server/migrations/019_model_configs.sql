-- Model configs managed server-side (kept out of the browser to protect API keys)
CREATE TABLE IF NOT EXISTS model_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  provider_name TEXT DEFAULT '',
  base_url TEXT NOT NULL,
  model_id TEXT NOT NULL,
  api_key TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
