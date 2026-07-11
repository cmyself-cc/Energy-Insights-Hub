-- Add keyword-gate and fuzzy-deduplication settings for the new tracker pipeline.
INSERT OR IGNORE INTO tracker_settings (key, value) VALUES
('required_industry_keywords', ''),
('required_company_keywords', ''),
('fuzzy_deduplication_threshold', '0.85');
