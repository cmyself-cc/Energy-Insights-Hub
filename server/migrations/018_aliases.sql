-- Add aliases column for keyword synonym expansion
ALTER TABLE filter_rules ADD COLUMN aliases TEXT DEFAULT '[]';
ALTER TABLE industry_categories ADD COLUMN aliases TEXT DEFAULT '[]';
