-- Add keywords column to insights for LLM-extracted searchable keywords
ALTER TABLE insights ADD COLUMN keywords TEXT DEFAULT '[]';
