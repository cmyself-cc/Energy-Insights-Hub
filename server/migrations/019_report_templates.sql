CREATE TABLE IF NOT EXISTS report_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  purpose TEXT DEFAULT '',
  prompt TEXT NOT NULL,
  max_cards INTEGER DEFAULT 10,
  is_public INTEGER DEFAULT 1,
  language TEXT DEFAULT 'zh',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS report_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER,
  template_id INTEGER,
  status TEXT DEFAULT 'queued',
  phase TEXT DEFAULT 'queued',
  progress INTEGER DEFAULT 0,
  error TEXT,
  insight_ids TEXT,
  screening TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE reports ADD COLUMN template_id INTEGER;
ALTER TABLE reports ADD COLUMN status TEXT DEFAULT 'done';
ALTER TABLE reports ADD COLUMN error TEXT;
