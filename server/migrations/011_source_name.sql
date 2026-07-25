-- Add article-level source name for aggregated sources like WeChat MCP feeds.
ALTER TABLE insights ADD COLUMN source_name TEXT;
