-- 统一存放可在线调优的 LLM 系统提示词。
-- 代码中的 DEFAULT_PROMPTS 是出厂默认值；入库后以数据库为准，
-- 手工编辑不会被重新 seed 覆盖（与 filter_config/report_templates 同模式）。
CREATE TABLE IF NOT EXISTS llm_prompts (
  key TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
