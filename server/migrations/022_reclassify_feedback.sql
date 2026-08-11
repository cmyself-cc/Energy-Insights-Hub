-- Reclassify feedback: allow reclassifying a card's monitoring purpose,
-- record the from/to purpose, and make semantic weights purpose-aware.

-- 1) Rebuild user_feedback: action CHECK gains 'reclassify', add from_purpose/to_purpose.
CREATE TABLE IF NOT EXISTS user_feedback_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  insight_id INTEGER REFERENCES insights(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('bookmark', 'hide', 'reclassify')),
  reason TEXT CHECK(reason IN ('irrelevant', 'duplicate', 'low_quality', 'not_now', NULL)),
  from_purpose TEXT,
  to_purpose TEXT,
  title TEXT,
  summary TEXT,
  keywords TEXT,
  purposes TEXT,
  categories TEXT,
  source_type TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO user_feedback_new (id, insight_id, action, reason, title, summary, keywords, purposes, categories, source_type, created_at)
  SELECT id, insight_id, action, reason, title, summary, keywords, purposes, categories, source_type, created_at
  FROM user_feedback;

DROP TABLE user_feedback;
ALTER TABLE user_feedback_new RENAME TO user_feedback;

CREATE INDEX IF NOT EXISTS idx_user_feedback_action ON user_feedback(action);
CREATE INDEX IF NOT EXISTS idx_user_feedback_reason ON user_feedback(reason);
CREATE INDEX IF NOT EXISTS idx_user_feedback_created_at ON user_feedback(created_at);

-- 2) feedback_semantic_weights: add purpose column ('' = global, else one of
-- competitor/policy/tech/industry). Unique now on (term, action, purpose).
ALTER TABLE feedback_semantic_weights ADD COLUMN purpose TEXT DEFAULT '';

DROP INDEX IF EXISTS idx_feedback_weights_term_action;
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_weights_term_action_purpose
  ON feedback_semantic_weights(term, action, purpose);
