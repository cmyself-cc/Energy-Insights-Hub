-- Allow wechat_mcp in the source import log (wechat direct import was removed).
CREATE TABLE _source_imports_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  identifier TEXT,
  type TEXT NOT NULL CHECK(type IN ('wechat_mcp', 'website')),
  url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  config TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO _source_imports_new (id, name, identifier, type, url, active, config, created_at, updated_at)
SELECT id, name, identifier,
  CASE WHEN type = 'wechat' THEN 'wechat_mcp' ELSE type END,
  url, active, config, created_at, updated_at
FROM source_imports;

DROP TABLE source_imports;
ALTER TABLE _source_imports_new RENAME TO source_imports;
