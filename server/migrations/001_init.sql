-- 数据来源配置
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'rss',
  active INTEGER NOT NULL DEFAULT 1,
  config TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 抓取/生成的洞察卡片
CREATE TABLE IF NOT EXISTS insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER REFERENCES sources(id),
  title TEXT NOT NULL,
  summary TEXT,
  url TEXT,
  publish_date DATETIME,
  source_type TEXT,
  business_domain TEXT,
  enterprise_type TEXT,
  entities TEXT,
  features TEXT,
  raw_content TEXT,
  hidden INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 用户生成的报告
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  items TEXT,
  language TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 调度运行日志
CREATE TABLE IF NOT EXISTS tracker_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME,
  sources_total INTEGER DEFAULT 0,
  sources_success INTEGER DEFAULT 0,
  sources_failed INTEGER DEFAULT 0,
  insights_created INTEGER DEFAULT 0,
  status TEXT DEFAULT 'running',
  message TEXT
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_insights_publish_date ON insights(publish_date DESC);
CREATE INDEX IF NOT EXISTS idx_insights_hidden ON insights(hidden);
CREATE INDEX IF NOT EXISTS idx_insights_source_id ON insights(source_id);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);
