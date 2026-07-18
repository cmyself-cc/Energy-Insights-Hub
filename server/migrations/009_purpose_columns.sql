-- Add purpose columns for purpose-based monitoring
ALTER TABLE sources ADD COLUMN purpose TEXT DEFAULT '';
ALTER TABLE filter_rules ADD COLUMN purpose TEXT DEFAULT '';
ALTER TABLE filter_config ADD COLUMN purpose TEXT DEFAULT '';
ALTER TABLE insights ADD COLUMN purpose TEXT DEFAULT '';
