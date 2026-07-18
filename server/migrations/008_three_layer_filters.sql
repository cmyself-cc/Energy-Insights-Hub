-- Restructure filter_rules: replace 'composite' with three independent layers
-- enterprise / include_keyword / exclude_keyword
CREATE TABLE _filter_rules_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('enterprise', 'include_keyword', 'exclude_keyword')),
  name TEXT,
  must_include TEXT,
  must_exclude TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

DROP TABLE filter_rules;
ALTER TABLE _filter_rules_new RENAME TO filter_rules;
