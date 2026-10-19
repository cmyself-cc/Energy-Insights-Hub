-- server/migrations/025_user_views.sql
CREATE TABLE IF NOT EXISTS user_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  filters TEXT NOT NULL DEFAULT '{}',   -- JSON：GET /api/insights 参数集
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_views_user ON user_views(user_id);
