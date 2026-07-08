CREATE TABLE IF NOT EXISTS tracker_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO tracker_settings (key, value) VALUES
('lookback_hours', '24'),
('max_per_source', '3'),
('include_business_domains', ''),
('include_enterprise_types', ''),
('include_categories', ''),
('exclude_keywords', '股票,证券,股市,行情,广告,推广,赞助');
