-- Add categories column to insights for LLM-assigned business category tags
ALTER TABLE insights ADD COLUMN categories TEXT;
