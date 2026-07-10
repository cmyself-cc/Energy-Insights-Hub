-- filter_rules: keyword exclusions and composite focus rules
CREATE TABLE IF NOT EXISTS filter_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('exclude_keyword', 'composite')),
  name TEXT,
  must_include TEXT,   -- JSON array of strings
  must_exclude TEXT,   -- JSON array of strings
  active INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- business_categories: industry/event categories with LLM prompts
CREATE TABLE IF NOT EXISTS business_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  inclusion_prompt TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- filter_config: semantic exclusion prompt and future global configs
CREATE TABLE IF NOT EXISTS filter_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('semantic')),
  content TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- source_imports: log of bulk-imported sources
CREATE TABLE IF NOT EXISTS source_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  identifier TEXT,
  type TEXT NOT NULL CHECK(type IN ('wechat', 'website')),
  url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  config TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed the 9 business categories from Key Config.xlsx
INSERT OR IGNORE INTO business_categories (name, description, inclusion_prompt) VALUES
('移动出行', '加油站便利店、充电网络、综合能源站、新能源汽车、商用汽车与出行服务、移动出行生态、动力电池、物流快递货运。', '资讯需满足以下至少一个条件，方可归类为“移动出行”：1. 能源补给设施...'),
('润滑油', '汽车后市场服务、车用润滑油、工业润滑油、浸没式液冷。', '资讯需满足以下至少一个条件，方可归类为“润滑油”：1. 产品相关性...'),
('化工', '石油化工业务，包括乙烷裂解、石脑油、聚碳酸酯、聚乙烯、聚丙烯、化学合成、聚合物、减碳。', '资讯需满足以下至少一个条件，方可归类为“化工”：1. 行业相关性...'),
('生物燃料', '可再生柴油、SAF、绿色甲醇、生物柴油、绿氨、生物炼制。', '资讯需满足以下至少一个条件，方可归类为“生物燃料”：1. 原料相关性...'),
('电力&氢能', '发电、输电、变电、配电、售电、制氢、储氢、加氢、氢能应用。', '资讯需满足以下至少一个条件，方可归类为“电力”或“氢能”：1. 电力相关...'),
('LNG/天然气', 'LNG贸易、基础设施、接收站、长协、煤改气、槽批。', '资讯需满足以下至少一个条件，方可归类为“液化天然气（LNG）/天然气”：1. 行业相关性...'),
('CCS', '碳捕获、运输、封存、碳利用、CCS/CCUS项目。', '资讯需满足以下至少一个条件，方可归类为“CCS”或“CCUS”：1. 技术相关性...'),
('收并购', '股权收购、资产收购、尽职调查、估值、整合规划、投资、合资。', '资讯内容需满足以下至少一项条件，方可归类为收并购相关资讯：1. 交易主体明确...'),
('战略合作', '技术研发合作、联合营销、产业链协同、战略联盟、合作协议。', '资讯内容需满足以下至少一项条件，方可归类为战略合作相关资讯：1. 合作主体明确...');
