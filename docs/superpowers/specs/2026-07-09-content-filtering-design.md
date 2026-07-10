# Content Filtering & Source Import Design

## Goal

Add content filtering capabilities to Energy Insights Hub based on the sample data in `Key Config.xlsx`, plus the ability to import new sources from the same file. The filtering must reduce noise before LLM processing, guide the LLM to exclude semantically irrelevant content, and enforce business-category membership.

## Scope

In scope:

1. **Keyword filtering** — exclude items containing sensitive/disallowed keywords.
2. **Composite keyword filtering** — pre-filter items by AND/OR/NOT keyword combinations.
3. **Semantic filtering** — inject exclusion rules into the LLM prompt so the model drops irrelevant items.
4. **Business classification** — classify each insight into one or more categories and keep only items matching enabled categories.
5. **Configuration import** — upload `Key Config.xlsx` or an equivalent JSON file through the UI to populate rules, categories, semantic prompt, and sources.
6. **Source import** — import WeChat public accounts and websites from the Excel sheet, default active.

Out of scope for this phase:

- Hitting statistics / rule-level metrics.
- UI drag-and-drop rule reordering beyond a numeric priority field.
- Automatic re-classification of existing insights.

## Decisions

- **Configuration import mechanism:** Upload Excel/JSON via the Configuration page. Parsed data is stored in the database and can be updated later by re-uploading.
- **Semantic filtering approach:** Embed exclusion rules directly in the LLM prompt used by `processInsight`. If the model decides the content is irrelevant, it returns empty `title` and `summary`, causing the post-filter to drop the item.
- **Business classification enforcement:** Each insight must belong to at least one enabled business category; otherwise it is discarded.
- **Composite rule timing:** Applied as a pre-filter before LLM processing to reduce LLM call volume.
- **New source default state:** Imported sources are active by default.

## Data Model

New tables (migration `004_content_filters.sql`):

### `filter_rules`

```sql
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
```

- `exclude_keyword`: `must_exclude` stores one or more keywords; if any match, the item is dropped. `must_include` is unused.
- `composite`: **inclusion / focus rule**. An item is kept only if it matches all `must_include` keywords AND does not match any `must_exclude` keyword. If it fails the composite rule, it is dropped. This implements the "关注企业过滤" requirement: focus on specific enterprises and the topics that matter about them.

### `business_categories`

```sql
CREATE TABLE IF NOT EXISTS business_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  inclusion_prompt TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

`inclusion_prompt` is the full paragraph from the Excel sheet explaining how to classify content into this category.

### `filter_config`

```sql
CREATE TABLE IF NOT EXISTS filter_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('semantic')),
  content TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Stores the long semantic-exclusion prompt. Only one active semantic config is used at a time.

### `source_imports`

```sql
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
```

A staging/log table. During import, rows are also inserted into the existing `sources` table with `active=1`.

## Pipeline

```
fetchSourceItems(source)
    ↓
applyPreFilter(items, settings)
    ├── dedupe by url/title
    ├── lookback hours
    ├── max per source
    ├── exclude_keyword rules
    └── composite rules
    ↓
processBatch(candidates, language)
    └── processInsight(item, language)
        └── LLM prompt includes semantic exclusions + business categories
        └── returns structured fields + categories array
    ↓
applyPostFilter(processed, settings)
    ├── drop empty title/summary
    ├── drop if no matching enabled business category
    └── rerun exclude_keyword rules
    ↓
insert into insights
```

## Backend Modules

| File | Responsibility |
|---|---|
| `server/migrations/004_content_filters.sql` | Create new tables and seed default business categories from the Excel data. |
| `server/services/filterRules.js` | Load active rules, match items against exclude/composite rules. |
| `server/services/businessCategories.js` | Load active categories, build classification prompt paragraph. |
| `server/services/llmProcessor.js` | Extend prompt with semantic rules and category instructions; parse returned `categories`. |
| `server/services/tracker.js` | Wire new filters into pre/post filter stages. |
| `server/services/sourceImporter.js` | Validate and insert imported sources into `sources` and `source_imports`. |
| `server/lib/configParser.js` | Parse uploaded `.xlsx` or `.json` into a normalized import payload. |
| `server/routes/filters.js` | CRUD for `filter_rules`, `business_categories`, `filter_config`. |
| `server/routes/sources.js` | Add `POST /api/sources/import` for source-only imports. |
| `server/routes/tracker.js` | Add `POST /api/tracker/import-config` for full config import. |

## API Endpoints

### Filters

- `GET /api/filters/rules` — list filter rules
- `POST /api/filters/rules` — create rule
- `PUT /api/filters/rules/:id` — update rule
- `DELETE /api/filters/rules/:id` — delete rule
- `GET /api/filters/categories` — list business categories
- `PUT /api/filters/categories/:id` — update category (name/description/prompt/active)
- `GET /api/filters/config` — get active semantic config
- `PUT /api/filters/config` — update semantic config

### Import

- `POST /api/tracker/import-config`
  - Body: multipart/form-data with field `file` (`.xlsx` or `.json`) and optional `mode` (`replace` or `append`, default `append`).
  - Response: `{ data: { rulesImported, categoriesImported, sourcesImported } }`
- `POST /api/sources/import`
  - Body: multipart/form-data with field `file`.
  - Response: `{ data: { sourcesImported } }`

## Configuration Import Format

### Excel

**Runtime requirement:** Excel parsing shells out to `python3` and requires the `pandas` package to be installed in the environment. JSON imports do not require Python.

Parsed by worksheet name:

| Worksheet | Parsed into |
|---|---|
| `关键词过滤` | `exclude_keyword` rules; first non-empty column per row is a keyword. |
| `底层过滤关键词` | `composite` focus rules; first column = base enterprise/keyword, fourth column = additional must-include topic, fifth column = must-exclude noise. An item is kept only if it matches all include columns and none of the exclude columns. Empty cells are ignored. |
| `语义过滤` | `filter_config` row with `type='semantic'`; first non-empty cell is the prompt. |
| `业务分类描述` | `business_categories`; columns are `业务分类`, `业务描述`, `Unnamed: 2` (inclusion prompt). |
| `新增微信公众号` | `source_imports` + `sources`; columns are `媒体类型`, `账号名称`, `微信号`, `新增网站`. |

### JSON

```json
{
  "excludeKeywords": ["培训班", "总裁班", "开班"],
  "compositeRules": [
    { "mustInclude": ["中石油", "开业"], "mustNotInclude": ["指数"] }
  ],
  "semanticPrompt": "1、通篇主要/核心资讯要点不包含...",
  "categories": [
    { "name": "移动出行", "description": "...", "inclusionPrompt": "..." }
  ],
  "sources": [
    { "name": "嘉实多", "type": "wechat", "identifier": "castrolchina", "url": "" }
  ]
}
```

`mode=replace` deletes existing active rules/categories/sources of the corresponding type before inserting the uploaded ones. `mode=append` only adds new rows and skips duplicates by name/keyword.

## LLM Prompt Changes

Append to the existing `processInsight` prompt:

```text
--- Filtering instructions ---

Semantic exclusions (drop the article if any apply):
{semanticPrompt}

Business categories (return a "categories" array with names that match):
{categoryPrompts}

Return ONLY a valid JSON object with these additional fields:
- categories: array of strings, names from the business category list above. Empty if none apply.

If the article matches a semantic exclusion or belongs to no business category, set title and summary to empty strings.
```

## Frontend Changes

Add a new **Content Filters** sub-tab inside Configuration, alongside Sources / Tracker Settings / API Config.

Sections:

1. **Keywords** — table of `exclude_keyword` rules with toggle/active state, add/delete, bulk import.
2. **Composite Rules** — table showing include/exclude columns.
3. **Semantic Filter** — textarea for the full prompt.
4. **Business Categories** — cards/toggle list of the 9 categories with descriptions.
5. **Import Config** — file dropzone for `.xlsx`/`.json` with `replace`/`append` toggle.

Add i18n keys to `src/constants/i18n.js` for English and Chinese.

## Testing Plan

- Unit tests:
  - `server/services/filterRules.test.js` — exclude/composite matching.
  - `server/lib/configParser.test.js` — parse sample Excel and JSON.
  - `server/services/sourceImporter.test.js` — dedupe and insert sources.
- Integration:
  - `npm run lint` passes.
  - `npm run build` succeeds.
  - Start dev server, upload `Key Config.xlsx`, run tracker, verify fewer insights and correct category labels.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| LLM ignores semantic rules | Include explicit "If ... set title and summary to empty strings" instruction and verify in post-filter. |
| Over-filtering removes useful content | Default all rules active but allow UI toggle; import defaults to `append`; user can disable rules quickly. |
| Composite rules with empty cells parse incorrectly | Parser ignores empty strings and only creates a rule when at least one include keyword exists. |
| Excel column order changes | Parser uses header names and falls back to column index for known sheets. |

## Future Enhancements

- Per-rule hit counters.
- Preview filter impact on a sample article before running tracker.
- Re-process existing insights with new filters.
