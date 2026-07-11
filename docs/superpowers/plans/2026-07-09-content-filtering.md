# Content Filtering & Source Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add keyword filtering, composite enterprise filtering, semantic LLM filtering, business-category enforcement, and bulk source import to the tracker pipeline, with all rules manageable via Excel/JSON upload.

**Architecture:** New SQLite tables store rules, categories, semantic config, and import logs. A rule engine applies keyword and composite filters before LLM processing; the LLM prompt carries semantic exclusions and category descriptions and returns a `categories` array; a post-filter enforces non-empty title and at least one enabled category. A config parser converts uploaded Excel/JSON into the same normalized shape.

**Tech Stack:** Express + better-sqlite3 + React (existing stack). File parsing uses Python subprocess for `.xlsx` and the native `JSON` parser for `.json`. Tests use `node --test`.

## Global Constraints

- Do not introduce new runtime npm dependencies for the backend.
- Keep existing localStorage API/search config behavior on the frontend.
- Reuse existing `COLORS / FONT_SIZES / BORDER_RADIUS` theme constants.
- Add English/Chinese copy to `src/constants/i18n.js`.
- Do not break existing report, bookmark, or newsletter generation features.
- Work in the existing worktree at `.worktrees/tracker-rules`.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/migrations/004_content_filters.sql` | Create `filter_rules`, `business_categories`, `filter_config`, `source_imports` tables and seed categories from Excel. |
| `server/services/filterRules.js` | Load active rules; match items against exclude/composite rules. |
| `server/services/businessCategories.js` | Load active categories; build prompt paragraph; check if insight matches any enabled category. |
| `server/services/sourceImporter.js` | Validate and insert imported sources into `sources` and `source_imports`. |
| `server/lib/configParser.js` | Parse `.xlsx` (via Python) and `.json` into normalized import payload. |
| `server/services/llmProcessor.js` | Inject semantic rules and category instructions into prompt; parse `categories` from response. |
| `server/services/tracker.js` | Wire new filters into pre/post filter stages. |
| `server/routes/filters.js` | CRUD for rules, categories, semantic config. |
| `server/routes/sources.js` | Add `POST /import` endpoint. |
| `server/routes/tracker.js` | Add `POST /import-config` endpoint. |
| `server/index.js` | Register new routers. |
| `src/utils/backendApi.js` | Add API client methods for filters and import. |
| `src/components/ContentFiltersPage.jsx` | New UI for managing filters, categories, semantic prompt, and config upload. |
| `src/components/ConfigurationPage.jsx` | Add "Content Filters" sub-tab. |
| `src/constants/i18n.js` | Add filter-related copy. |

---

### Task 1: Database Migration

**Files:**
- Create: `server/migrations/004_content_filters.sql`

**Interfaces:**
- Produces: schema for `filter_rules`, `business_categories`, `filter_config`, `source_imports`.

- [ ] **Step 1: Create migration file**

```sql
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
```

- [ ] **Step 2: Verify migration runs**

Run:
```bash
node -e "import('./server/db.js').then(({ initDb }) => { initDb(); console.log('migration ok'); })"
```

Expected: `migration ok` with no errors.

- [ ] **Step 3: Check seeded categories**

Run:
```bash
node -e "import('./server/db.js').then(db => console.log(db.prepare('SELECT COUNT(*) as c FROM business_categories').get()))"
```

Expected: `{ c: 9 }`

---

### Task 2: Filter Rules Engine

**Files:**
- Create: `server/services/filterRules.js`
- Create: `server/services/filterRules.test.js`

**Interfaces:**
- Produces: `loadFilterRules()`, `matchesExclusion(item, rule)`, `matchesComposite(item, rule)`, `applyKeywordFilters(items, rules)`.
- Consumes: better-sqlite3 `db`.

- [ ] **Step 1: Write failing tests**

```js
// server/services/filterRules.test.js
import { describe, it } from "node:test";
import assert from "node:assert";
import { matchesExclusion, matchesComposite, applyKeywordFilters } from "./filterRules.js";

describe("filterRules", () => {
  it("matchesExclusion detects excluded keyword", () => {
    const item = { title: "总裁班开班通知", summary: "" };
    assert.strictEqual(matchesExclusion(item, { must_exclude: ["总裁班"] }), true);
  });

  it("matchesComposite keeps items matching all includes and no excludes", () => {
    const item = { title: "中石油加油站开业", summary: "" };
    assert.strictEqual(matchesComposite(item, { must_include: ["中石油", "开业"], must_exclude: ["指数"] }), true);
  });

  it("applyKeywordFilters drops exclusions and non-matching composites", () => {
    const items = [
      { title: "总裁班开班", summary: "" },
      { title: "中石油开业", summary: "" },
      { title: " unrelated ", summary: "" }
    ];
    const rules = [
      { type: "exclude_keyword", must_exclude: ["总裁班"] },
      { type: "composite", must_include: ["中石油"], must_exclude: [] }
    ];
    const result = applyKeywordFilters(items, rules);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].title, "中石油开业");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
node --test server/services/filterRules.test.js
```

Expected: failures because functions are not defined.

- [ ] **Step 3: Implement filter rules engine**

```js
// server/services/filterRules.js
import db from "../db.js";

export function loadFilterRules() {
  return db.prepare("SELECT * FROM filter_rules WHERE active = 1 ORDER BY priority DESC, id ASC").all();
}

function getSearchText(item) {
  return `${item.title || ""} ${item.summary || ""} ${item.rawContent || ""}`.toLowerCase();
}

export function matchesExclusion(item, rule) {
  const text = getSearchText(item);
  const keywords = JSON.parse(rule.must_exclude || "[]");
  return keywords.some(k => text.includes(k.toLowerCase()));
}

export function matchesComposite(item, rule) {
  const text = getSearchText(item);
  const include = JSON.parse(rule.must_include || "[]");
  const exclude = JSON.parse(rule.must_exclude || "[]");
  const includesMatch = include.every(k => text.includes(k.toLowerCase()));
  const excludesMatch = exclude.some(k => text.includes(k.toLowerCase()));
  return includesMatch && !excludesMatch;
}

export function applyKeywordFilters(items, rules) {
  const excludeRules = rules.filter(r => r.type === "exclude_keyword");
  const compositeRules = rules.filter(r => r.type === "composite");

  return items.filter(item => {
    if (excludeRules.some(rule => matchesExclusion(item, rule))) return false;
    if (compositeRules.length > 0) {
      return compositeRules.some(rule => matchesComposite(item, rule));
    }
    return true;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
node --test server/services/filterRules.test.js
```

Expected: all tests pass.

---

### Task 3: Business Categories Service

**Files:**
- Create: `server/services/businessCategories.js`
- Create: `server/services/businessCategories.test.js`

**Interfaces:**
- Produces: `loadCategories()`, `buildCategoryPrompt()`, `matchesEnabledCategory(insight, categories)`.

- [ ] **Step 1: Write failing tests**

```js
// server/services/businessCategories.test.js
import { describe, it } from "node:test";
import assert from "node:assert";
import { matchesEnabledCategory, buildCategoryPrompt } from "./businessCategories.js";

describe("businessCategories", () => {
  it("matchesEnabledCategory returns true when insight category is enabled", () => {
    const categories = [{ name: "移动出行", active: 1 }];
    assert.strictEqual(matchesEnabledCategory({ categories: ["移动出行"] }, categories), true);
  });

  it("matchesEnabledCategory returns false when no categories match", () => {
    const categories = [{ name: "移动出行", active: 1 }];
    assert.strictEqual(matchesEnabledCategory({ categories: ["化工"] }, categories), false);
  });

  it("buildCategoryPrompt includes category names and prompts", () => {
    const categories = [{ name: "A", inclusion_prompt: "desc A" }];
    const prompt = buildCategoryPrompt(categories);
    assert.ok(prompt.includes("A"));
    assert.ok(prompt.includes("desc A"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
node --test server/services/businessCategories.test.js
```

Expected: failures.

- [ ] **Step 3: Implement service**

```js
// server/services/businessCategories.js
import db from "../db.js";

export function loadCategories() {
  return db.prepare("SELECT * FROM business_categories ORDER BY name ASC").all();
}

export function loadActiveCategories() {
  return db.prepare("SELECT * FROM business_categories WHERE active = 1 ORDER BY name ASC").all();
}

export function buildCategoryPrompt(categories) {
  return categories.map(c => `- ${c.name}: ${c.inclusion_prompt}`).join("\n");
}

export function matchesEnabledCategory(insight, enabledCategories) {
  const names = new Set(enabledCategories.map(c => c.name));
  const insightCategories = insight.categories || [];
  return insightCategories.some(name => names.has(name));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
node --test server/services/businessCategories.test.js
```

Expected: all tests pass.

---

### Task 4: Config Parser

**Files:**
- Create: `server/lib/configParser.js`
- Create: `server/lib/configParser.test.js`

**Interfaces:**
- Produces: `parseConfigFile(buffer, filename)` returning `{ excludeKeywords, compositeRules, semanticPrompt, categories, sources }`.

- [ ] **Step 1: Write failing tests**

```js
// server/lib/configParser.test.js
import { describe, it } from "node:test";
import assert from "node:assert";
import { parseJsonConfig } from "./configParser.js";

describe("configParser", () => {
  it("parses JSON config", () => {
    const payload = {
      excludeKeywords: ["培训班"],
      compositeRules: [{ mustInclude: ["中石油", "开业"], mustNotInclude: ["指数"] }],
      semanticPrompt: "排除会议资讯",
      categories: [{ name: "移动出行", description: "desc", inclusionPrompt: "prompt" }],
      sources: [{ name: "嘉实多", type: "wechat", identifier: "castrolchina" }]
    };
    const result = parseJsonConfig(payload);
    assert.strictEqual(result.excludeKeywords.length, 1);
    assert.strictEqual(result.compositeRules[0].must_include[0], "中石油");
    assert.strictEqual(result.sources[0].type, "wechat");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
node --test server/lib/configParser.test.js
```

Expected: failure.

- [ ] **Step 3: Implement parser**

```js
// server/lib/configParser.js
import { execFileSync } from "child_process";
import path from "path";
import os from "os";
import fs from "fs";

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string" && value.trim()) return value.split(",").map(s => s.trim()).filter(Boolean);
  return [];
}

export function parseJsonConfig(payload) {
  return {
    excludeKeywords: toArray(payload.excludeKeywords),
    compositeRules: (payload.compositeRules || []).map(r => ({
      type: "composite",
      name: r.name || null,
      must_include: JSON.stringify(toArray(r.mustInclude || r.must_include)),
      must_exclude: JSON.stringify(toArray(r.mustNotInclude || r.must_exclude || r.exclude))
    })).filter(r => JSON.parse(r.must_include).length > 0),
    semanticPrompt: payload.semanticPrompt || "",
    categories: (payload.categories || []).map(c => ({
      name: c.name,
      description: c.description || "",
      inclusion_prompt: c.inclusionPrompt || c.inclusion_prompt || ""
    })).filter(c => c.name),
    sources: (payload.sources || []).map(s => ({
      name: s.name,
      identifier: s.identifier || null,
      type: s.type,
      url: s.url || "",
      config: s.config ? JSON.stringify(s.config) : null
    })).filter(s => s.name && s.type)
  };
}

function parseExcelRows(rows, headerOffset = 0) {
  return rows.slice(headerOffset).filter(r => r && Object.values(r).some(v => v !== null && v !== undefined && String(v).trim() !== ""));
}

function parseExcelBuffer(buffer) {
  const tmpDir = os.tmpdir();
  const inPath = path.join(tmpDir, `config-in-${Date.now()}.xlsx`);
  const outPath = path.join(tmpDir, `config-out-${Date.now()}.json`);
  fs.writeFileSync(inPath, buffer);

  const script = `
import pandas as pd
import json
import sys

xl = pd.ExcelFile(sys.argv[1])
result = {}

# 关键词过滤
if "关键词过滤" in xl.sheet_names:
    df = pd.read_excel(xl, sheet_name="关键词过滤", header=None)
    keywords = []
    for _, row in df.iterrows():
        val = row.dropna().astype(str).str.strip()
        val = val[val != ""]
        if len(val) > 0:
            keywords.append(val.iloc[0])
    result["excludeKeywords"] = keywords

# 底层过滤关键词
composite = []
if "底层过滤关键词" in xl.sheet_names:
    df = pd.read_excel(xl, sheet_name="底层过滤关键词", header=None)
    for _, row in df.iterrows():
        vals = row.dropna().astype(str).str.strip()
        vals = vals[vals != ""]
        if len(vals) >= 1:
            composite.append({
                "mustInclude": [vals.iloc[0]] + ([vals.iloc[3]] if len(vals) > 3 else []),
                "mustNotInclude": [vals.iloc[4]] if len(vals) > 4 else []
            })
    result["compositeRules"] = composite

# 语义过滤
if "语义过滤" in xl.sheet_names:
    df = pd.read_excel(xl, sheet_name="语义过滤", header=None)
    for _, row in df.iterrows():
        vals = row.dropna().astype(str).str.strip()
        vals = vals[vals != ""]
        if len(vals) > 0:
            result["semanticPrompt"] = vals.iloc[0]
            break

# 业务分类描述
categories = []
if "业务分类描述" in xl.sheet_names:
    df = pd.read_excel(xl, sheet_name="业务分类描述")
    for _, row in df.iterrows():
        if pd.notna(row.iloc[0]):
            categories.append({
                "name": str(row.iloc[0]).strip(),
                "description": str(row.iloc[1]).strip() if pd.notna(row.iloc[1]) else "",
                "inclusionPrompt": str(row.iloc[2]).strip() if len(row) > 2 and pd.notna(row.iloc[2]) else ""
            })
    result["categories"] = categories

# 新增微信公众号
sources = []
if "新增微信公众号" in xl.sheet_names:
    df = pd.read_excel(xl, sheet_name="新增微信公众号")
    for _, row in df.iterrows():
        media = str(row.iloc[0]).strip() if pd.notna(row.iloc[0]) else ""
        name = str(row.iloc[1]).strip() if pd.notna(row.iloc[1]) else ""
        identifier = str(row.iloc[2]).strip() if pd.notna(row.iloc[2]) else ""
        website = str(row.iloc[3]).strip() if len(row) > 3 and pd.notna(row.iloc[3]) else ""
        if name:
            if media == "微信公众号":
                sources.append({"name": name, "type": "wechat", "identifier": identifier})
            elif website:
                sources.append({"name": website, "type": "website", "url": website})
            elif identifier:
                sources.append({"name": name, "type": "website", "url": identifier})
    result["sources"] = sources

with open(sys.argv[2], "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False)
`;

  const scriptPath = path.join(tmpDir, `parse-config-${Date.now()}.py`);
  fs.writeFileSync(scriptPath, script);
  execFileSync("python3", [scriptPath, inPath, outPath]);

  const raw = JSON.parse(fs.readFileSync(outPath, "utf-8"));
  fs.unlinkSync(inPath);
  fs.unlinkSync(outPath);
  fs.unlinkSync(scriptPath);
  return parseJsonConfig(raw);
}

export function parseConfigFile(buffer, filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".json") {
    return parseJsonConfig(JSON.parse(buffer.toString("utf-8")));
  }
  if (ext === ".xlsx") {
    return parseExcelBuffer(buffer);
  }
  throw new Error("Unsupported file type. Use .json or .xlsx");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
node --test server/lib/configParser.test.js
```

Expected: all tests pass.

---

### Task 5: Source Importer

**Files:**
- Create: `server/services/sourceImporter.js`
- Create: `server/services/sourceImporter.test.js`

**Interfaces:**
- Produces: `importSources(sources, mode)` returning `{ imported, skipped }`.

- [ ] **Step 1: Write failing tests**

```js
// server/services/sourceImporter.test.js
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import db from "../db.js";
import { importSources } from "./sourceImporter.js";

describe("sourceImporter", () => {
  beforeEach(() => {
    db.prepare("DELETE FROM sources").run();
    db.prepare("DELETE FROM source_imports").run();
  });

  it("imports new sources", () => {
    const result = importSources([{ name: "嘉实多", type: "wechat", identifier: "castrolchina", url: "" }], "append");
    assert.strictEqual(result.imported, 1);
    assert.strictEqual(db.prepare("SELECT COUNT(*) as c FROM sources").get().c, 1);
  });

  it("skips duplicates in append mode", () => {
    importSources([{ name: "嘉实多", type: "wechat", identifier: "castrolchina", url: "" }], "append");
    const result = importSources([{ name: "嘉实多", type: "wechat", identifier: "castrolchina", url: "" }], "append");
    assert.strictEqual(result.skipped, 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
node --test server/services/sourceImporter.test.js
```

Expected: failure.

- [ ] **Step 3: Implement source importer**

```js
// server/services/sourceImporter.js
import db from "../db.js";

function sourceUrl(source) {
  if (source.url) return source.url;
  if (source.type === "wechat" && source.identifier) {
    return `https://mp.weixin.qq.com/s/${source.identifier}`;
  }
  return "";
}

export function importSources(sources, mode = "append") {
  if (mode === "replace") {
    db.prepare("DELETE FROM source_imports").run();
    db.prepare("DELETE FROM sources WHERE id IN (SELECT source_id FROM source_imports)").run();
  }

  const existing = new Set(db.prepare("SELECT name FROM sources").all().map(r => r.name));
  const insertSource = db.prepare(
    "INSERT INTO sources (name, url, type, active, config) VALUES (?, ?, ?, 1, ?)"
  );
  const insertImport = db.prepare(
    "INSERT INTO source_imports (name, identifier, type, url, active, config) VALUES (?, ?, ?, ?, 1, ?)"
  );

  let imported = 0;
  let skipped = 0;

  const tx = db.transaction((rows) => {
    for (const s of rows) {
      if (!s.name || !s.type || existing.has(s.name)) {
        skipped++;
        continue;
      }
      const url = sourceUrl(s);
      const config = s.config || null;
      const sourceResult = insertSource.run(s.name, url, s.type, config);
      insertImport.run(s.name, s.identifier || null, s.type, url, config);
      existing.add(s.name);
      imported++;
    }
  });

  tx(sources);
  return { imported, skipped };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
node --test server/services/sourceImporter.test.js
```

Expected: all tests pass.

---

### Task 6: LLM Processor Update

**Files:**
- Modify: `server/services/llmProcessor.js`

**Interfaces:**
- Consumes: `loadSemanticConfig()` and `loadActiveCategories()` from services created in Tasks 3 and 7.
- Produces: `processInsight(item, language, filterContext)` returns object with `categories` array. `filterContext` is `{ semanticPrompt, categories }` loaded once per batch.

- [ ] **Step 1: Add imports and helper**

```js
// server/services/llmProcessor.js
import { loadActiveCategories, buildCategoryPrompt } from "./businessCategories.js";
import db from "../db.js";

function loadSemanticConfig() {
  const row = db.prepare("SELECT content FROM filter_config WHERE type = 'semantic' AND active = 1 LIMIT 1").get();
  return row ? row.content : "";
}
```

- [ ] **Step 2: Modify prompt and return value**

In `processInsight`, replace the prompt construction with:

```js
const semanticPrompt = loadSemanticConfig();
const categories = loadActiveCategories();
const categoryPrompt = buildCategoryPrompt(categories);

const filteringInstructions = semanticPrompt || categoryPrompt
  ? `--- Filtering instructions ---
${semanticPrompt ? `\nSemantic exclusions (drop the article if any apply):\n${semanticPrompt}\n` : ""}
${categoryPrompt ? `\nBusiness categories (return a "categories" array with names that match):\n${categoryPrompt}\n` : ""}
Return ONLY a valid JSON object with these additional fields:
- categories: array of strings, names from the business category list above. Empty if none apply.

If the article matches a semantic exclusion or belongs to no business category, set title and summary to empty strings.`
  : "";

const prompt = `You are an energy industry analyst. Read the following article and extract a structured insight.

Title: ${item.title}
Content: ${item.summary || item.rawContent || ""}
URL: ${item.url}

${filteringInstructions}

Return ONLY a valid JSON object (no markdown, no explanation) with these fields:
- title: string (in ${isZh ? "Chinese" : "English"}, keep it concise)
- summary: string (2-3 sentences, data-driven, in ${isZh ? "Chinese" : "English"})
- sourceType: string (in ${isZh ? "Chinese" : "English"}, e.g. 微信公众号 / WeChat Official Account, 新闻门户 / News Portal)
- businessDomain: string (in ${isZh ? "Chinese" : "English"}, e.g. 能源转型 / Energy Transition, 化工 / Chemicals)
- enterpriseType: string (in ${isZh ? "Chinese" : "English"}, e.g. 国有企业 / SOE, 民营企业 / Private)
- entities: array of 2-5 strings (key companies/technologies, in ${isZh ? "Chinese" : "English"})
- features: array of 1-3 strings (category tags, in ${isZh ? "Chinese" : "English"})
- categories: array of strings (business category names from the list above)
- publishDate: string (ISO 8601 date, e.g. 2026-07-08)

If the content is not related to energy or matches the semantic exclusions, set title and summary to empty strings.`;
```

- [ ] **Step 3: Parse categories from response**

In the parsed object return, add:

```js
categories: Array.isArray(parsed.categories) ? parsed.categories : []
```

- [ ] **Step 4: Test with a manual curl**

Set `LLM_API_KEY` in `.env`, then run a small script to call `processInsight` with a sample article and verify `categories` is returned.

---

### Task 7: Tracker Integration

**Files:**
- Modify: `server/services/tracker.js`

**Interfaces:**
- Consumes: `loadFilterRules`, `applyKeywordFilters` from Task 2; `loadActiveCategories`, `matchesEnabledCategory` from Task 3.

- [ ] **Step 1: Add imports**

```js
import { loadFilterRules, applyKeywordFilters } from "./filterRules.js";
import { loadActiveCategories, matchesEnabledCategory } from "./businessCategories.js";
```

- [ ] **Step 2: Apply keyword filters in pre-filter**

In `runTracker`, before `applyPreFilter`, add:

```js
const filterRules = loadFilterRules();
```

Then inside the source loop, after deduping `newItems`:

```js
const keywordFiltered = applyKeywordFilters(newItems, filterRules);
if (keywordFiltered.length === 0) {
  console.log(`[tracker] Source ${source.name}: no items after keyword filters`);
  successCount++;
  // update progress
  continue;
}
const taggedItems = keywordFiltered.map(item => ({ ...item, sourceId: source.id }));
```

- [ ] **Step 3: Enforce categories in post-filter**

In `applyPostFilter` usage, replace with a new inline filter:

```js
const activeCategories = loadActiveCategories();
const kept = applyPostFilter(processed, settings)
  .filter(insight => insight.title && insight.title.trim() !== "")
  .filter(insight => matchesEnabledCategory(insight, activeCategories));
```

- [ ] **Step 4: Run tracker smoke test**

Run:
```bash
curl -X POST http://localhost:3003/api/tracker/run
```

Then poll `/api/tracker/runs/:id` and verify the run completes and `insights_created` reflects filtering.

---

### Task 8: API Routes

**Files:**
- Create: `server/routes/filters.js`
- Modify: `server/routes/sources.js`
- Modify: `server/routes/tracker.js`
- Modify: `server/index.js`

**Interfaces:**
- Produces: REST endpoints for filter rules, categories, semantic config, and import.

- [ ] **Step 1: Create filters router**

```js
// server/routes/filters.js
import { Router } from "express";
import db from "../db.js";

const router = Router();

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) return value.split(",").map(s => s.trim()).filter(Boolean);
  return [];
}

router.get("/rules", (_req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM filter_rules ORDER BY priority DESC, id ASC").all();
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/rules", (req, res) => {
  try {
    const { type, name, mustInclude, mustExclude, active, priority } = req.body;
    const result = db.prepare(
      "INSERT INTO filter_rules (type, name, must_include, must_exclude, active, priority) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(type, name || null, JSON.stringify(toArray(mustInclude)), JSON.stringify(toArray(mustExclude)), active ? 1 : 0, priority || 0);
    res.json({ data: { id: result.lastInsertRowid } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/rules/:id", (req, res) => {
  try {
    const { name, mustInclude, mustExclude, active, priority } = req.body;
    db.prepare(
      "UPDATE filter_rules SET name = ?, must_include = ?, must_exclude = ?, active = ?, priority = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(name || null, JSON.stringify(toArray(mustInclude)), JSON.stringify(toArray(mustExclude)), active ? 1 : 0, priority || 0, req.params.id);
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/rules/:id", (req, res) => {
  try {
    db.prepare("DELETE FROM filter_rules WHERE id = ?").run(req.params.id);
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/categories", (_req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM business_categories ORDER BY name ASC").all();
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/categories/:id", (req, res) => {
  try {
    const { description, inclusion_prompt, active } = req.body;
    db.prepare(
      "UPDATE business_categories SET description = ?, inclusion_prompt = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(description || "", inclusion_prompt || "", active ? 1 : 0, req.params.id);
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/config", (_req, res) => {
  try {
    const row = db.prepare("SELECT * FROM filter_config WHERE type = 'semantic' LIMIT 1").get();
    res.json({ data: row || { type: "semantic", content: "", active: 1 } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/config", (req, res) => {
  try {
    const { content, active } = req.body;
    const existing = db.prepare("SELECT id FROM filter_config WHERE type = 'semantic' LIMIT 1").get();
    if (existing) {
      db.prepare("UPDATE filter_config SET content = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(content || "", active ? 1 : 0, existing.id);
    } else {
      db.prepare("INSERT INTO filter_config (type, content, active) VALUES ('semantic', ?, ?)")
        .run(content || "", active ? 1 : 0);
    }
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
```

- [ ] **Step 2: Add import endpoint to sources router**

In `server/routes/sources.js`, add after existing routes:

```js
import { parseConfigFile } from "../lib/configParser.js";
import { importSources } from "../services/sourceImporter.js";

router.post("/import", (req, res) => {
  try {
    if (!req.body || !req.body.file) {
      return res.status(400).json({ error: "Missing file" });
    }
    const buffer = Buffer.from(req.body.file, "base64");
    const parsed = parseConfigFile(buffer, req.body.filename || "config.json");
    const result = importSources(parsed.sources, req.body.mode || "append");
    res.json({ data: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 3: Add full config import to tracker router**

In `server/routes/tracker.js`, add:

```js
import { parseConfigFile } from "../lib/configParser.js";
import { importSources } from "../services/sourceImporter.js";

router.post("/import-config", (req, res) => {
  try {
    if (!req.body || !req.body.file) {
      return res.status(400).json({ error: "Missing file" });
    }
    const buffer = Buffer.from(req.body.file, "base64");
    const parsed = parseConfigFile(buffer, req.body.filename || "config.json");
    const mode = req.body.mode || "append";

    if (mode === "replace") {
      db.prepare("DELETE FROM filter_rules").run();
      db.prepare("DELETE FROM business_categories").run();
    }

    const insertRule = db.prepare(
      "INSERT INTO filter_rules (type, name, must_include, must_exclude, active, priority) VALUES (?, ?, ?, ?, 1, 0)"
    );
    const insertCategory = db.prepare(
      "INSERT INTO business_categories (name, description, inclusion_prompt, active) VALUES (?, ?, ?, 1)"
    );
    const upsertConfig = db.prepare(
      "INSERT INTO filter_config (type, content, active) VALUES ('semantic', ?, 1) ON CONFLICT(id) DO UPDATE SET content=excluded.content, active=excluded.active, updated_at=CURRENT_TIMESTAMP"
    );

    const tx = db.transaction(() => {
      for (const k of parsed.excludeKeywords) {
        insertRule.run("exclude_keyword", k, "[]", JSON.stringify([k]));
      }
      for (const r of parsed.compositeRules) {
        insertRule.run(r.type, r.name, r.must_include, r.must_exclude);
      }
      for (const c of parsed.categories) {
        insertCategory.run(c.name, c.description, c.inclusion_prompt);
      }
      if (parsed.semanticPrompt) {
        const existing = db.prepare("SELECT id FROM filter_config WHERE type = 'semantic' LIMIT 1").get();
        if (existing) {
          db.prepare("UPDATE filter_config SET content = ?, active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run(parsed.semanticPrompt, existing.id);
        } else {
          db.prepare("INSERT INTO filter_config (type, content, active) VALUES ('semantic', ?, 1)")
            .run(parsed.semanticPrompt);
        }
      }
    });
    tx();

    const sourceResult = importSources(parsed.sources, mode);

    res.json({ data: {
      rulesImported: parsed.excludeKeywords.length + parsed.compositeRules.length,
      categoriesImported: parsed.categories.length,
      sourcesImported: sourceResult.imported
    }});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 4: Register routers in server/index.js**

```js
import filtersRouter from "./routes/filters.js";

app.use("/api/filters", filtersRouter);
```

- [ ] **Step 5: Test endpoints**

Run:
```bash
curl http://localhost:3003/api/filters/categories
curl http://localhost:3003/api/filters/rules
```

Expected: JSON arrays.

---

### Task 9: Frontend Content Filters UI

**Files:**
- Create: `src/components/ContentFiltersPage.jsx`
- Modify: `src/components/ConfigurationPage.jsx`
- Modify: `src/utils/backendApi.js`

**Interfaces:**
- Consumes: `backendApi` methods for filters and import.
- Produces: UI for managing rules, categories, semantic prompt, and config upload.

- [ ] **Step 1: Add API methods**

In `src/utils/backendApi.js`, add inside the `backendApi` object:

```js
// Filters
getFilterRules: () => request("/filters/rules"),
createFilterRule: (rule) => request("/filters/rules", { method: "POST", body: JSON.stringify(rule) }),
updateFilterRule: (id, rule) => request(`/filters/rules/${id}`, { method: "PUT", body: JSON.stringify(rule) }),
deleteFilterRule: (id) => request(`/filters/rules/${id}`, { method: "DELETE" }),
getBusinessCategories: () => request("/filters/categories"),
updateBusinessCategory: (id, category) => request(`/filters/categories/${id}`, { method: "PUT", body: JSON.stringify(category) }),
getSemanticConfig: () => request("/filters/config"),
updateSemanticConfig: (config) => request("/filters/config", { method: "PUT", body: JSON.stringify(config) }),
importConfig: (base64File, filename, mode = "append") => request("/tracker/import-config", {
  method: "POST",
  body: JSON.stringify({ file: base64File, filename, mode })
})
```

- [ ] **Step 2: Create ContentFiltersPage component**

Create `src/components/ContentFiltersPage.jsx` with sections for:
1. File upload (drag/drop or input) with replace/append toggle.
2. Keyword exclusion list with add/delete/toggle.
3. Composite rule list with include/exclude columns.
4. Semantic prompt textarea.
5. Business category cards with toggle.

Use existing theme constants and `i18n[language]` for copy.

- [ ] **Step 3: Add Content Filters tab to ConfigurationPage**

In `src/components/ConfigurationPage.jsx`:

```js
import ContentFiltersPage from "./ContentFiltersPage";

const TABS = [
  { key: "sources", icon: "🌐", labelKey: "sources" },
  { key: "filters", icon: "🛡️", labelKey: "contentFiltersTab" },
  { key: "tracker", icon: "⚙️", labelKey: "trackerSettingsTab" },
  { key: "api", icon: "🔑", labelKey: "apiConfigTab" }
];
```

And add:

```jsx
{tab === "filters" && <ContentFiltersPage darkMode={darkMode} language={language} />}
```

- [ ] **Step 4: Add i18n keys**

In `src/constants/i18n.js`, add under both `en` and `zh`:

```js
contentFiltersTab: "Content Filters" // en
contentFiltersTab: "内容过滤" // zh
```

- [ ] **Step 5: Verify build**

Run:
```bash
npm run lint
npm run build
```

Expected: no errors.

---

### Task 10: End-to-End Verification

**Files:** none new.

- [ ] **Step 1: Seed filters from Excel**

Use the UI or curl to upload `Key Config.xlsx` to `/api/tracker/import-config` with mode `append`.

- [ ] **Step 2: Run tracker**

```bash
curl -X POST http://localhost:3003/api/tracker/run
```

- [ ] **Step 3: Verify filtered output**

```bash
curl "http://localhost:3003/api/insights?limit=20"
```

Expected: insights have `categories` field; none contain excluded keywords; all match at least one enabled business category.

- [ ] **Step 4: Final checks**

Run:
```bash
npm run lint
npm run build
node --test server/services/filterRules.test.js
node --test server/services/businessCategories.test.js
node --test server/lib/configParser.test.js
node --test server/services/sourceImporter.test.js
```

Expected: all pass.

---

## Self-Review

**Spec coverage:**
- Keyword filtering → Tasks 1, 2, 8
- Composite/enterprise filtering → Tasks 1, 2, 8
- Semantic filtering → Tasks 1, 6, 8
- Business classification → Tasks 1, 3, 6, 7
- Config import → Tasks 4, 8
- Source import → Tasks 1, 4, 5, 8

**Placeholder scan:** No TBD/TODO.

**Type consistency:** `must_include`/`must_exclude` stored as JSON strings in DB, parsed to arrays in `filterRules.js`. `categories` returned by LLM is array of strings. `processInsight` returns `categories`. Consistent across tasks.
