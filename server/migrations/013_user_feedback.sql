-- User feedback system: semantic filtering driven by explicit user actions.
CREATE TABLE IF NOT EXISTS user_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  insight_id INTEGER REFERENCES insights(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('bookmark', 'hide')),
  reason TEXT CHECK(reason IN ('irrelevant', 'duplicate', 'low_quality', 'not_now', NULL)),
  title TEXT,
  summary TEXT,
  keywords TEXT,
  purposes TEXT,
  categories TEXT,
  source_type TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_feedback_action ON user_feedback(action);
CREATE INDEX IF NOT EXISTS idx_user_feedback_reason ON user_feedback(reason);
CREATE INDEX IF NOT EXISTS idx_user_feedback_created_at ON user_feedback(created_at);

CREATE TABLE IF NOT EXISTS feedback_rules_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('enterprise', 'include_keyword', 'exclude_keyword')),
  name TEXT NOT NULL,
  purpose TEXT DEFAULT '',
  reason TEXT,
  evidence TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  decided_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_feedback_suggestions_status ON feedback_rules_suggestions(status);

CREATE TABLE IF NOT EXISTS feedback_semantic_weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL,
  term_type TEXT NOT NULL CHECK(term_type IN ('keyword', 'entity', 'category')),
  action TEXT NOT NULL CHECK(action IN ('boost', 'suppress')),
  reason_category TEXT,
  score REAL NOT NULL DEFAULT 0,
  feedback_count INTEGER DEFAULT 1,
  last_feedback_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_weights_term_action ON feedback_semantic_weights(term, action);
