-- Allow ai_presets type in filter_config
CREATE TABLE filter_config_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('semantic', 'ai_presets')),
  content TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  purpose TEXT DEFAULT ''
);

INSERT INTO filter_config_new SELECT * FROM filter_config;
DROP TABLE filter_config;
ALTER TABLE filter_config_new RENAME TO filter_config;
