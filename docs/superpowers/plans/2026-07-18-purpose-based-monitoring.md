# Purpose-Based Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `purpose` field to sources and filter rules so each source routes through purpose-appropriate keyword gates and LLM prompts.

**Architecture:** Sources tagged with purpose (competitor/policy/tech), filter rules grouped by purpose, tracker routes each source through purpose-specific keyword gate + LLM prompt. Single pipeline, purpose-aware filtering.

**Tech Stack:** Express, better-sqlite3, React, cheerio, rss-parser

## Global Constraints

- All DB changes via numbered migrations in `server/migrations/`
- Existing crawler types (rss, website, wechat_mcp) unchanged
- No Tavily as source type (reserved for future)
- Sources without purpose default to using all rules (backward compatible)
- LLM model: `deepseek-ai/DeepSeek-V4-Flash`

---

### Task 1: Database Migrations

**Files:**
- Create: `server/migrations/009_purpose_columns.sql`

**Interfaces:**
- Produces: `purpose` column on `sources`, `filter_rules`, `filter_config`, `insights`

- [ ] **Step 1: Create migration**

```sql
-- Add purpose columns for purpose-based monitoring
ALTER TABLE sources ADD COLUMN purpose TEXT DEFAULT '';
ALTER TABLE filter_rules ADD COLUMN purpose TEXT DEFAULT '';
ALTER TABLE filter_config ADD COLUMN purpose TEXT DEFAULT '';
ALTER TABLE insights ADD COLUMN purpose TEXT DEFAULT '';
```

- [ ] **Step 2: Run migration and verify**

Run: `sqlite3 data/energy_insights.db < server/migrations/009_purpose_columns.sql && sqlite3 data/energy_insights.db ".schema sources" | grep purpose`
Expected: `purpose TEXT DEFAULT ''` appears in schema

- [ ] **Step 3: Commit**

```bash
git add server/migrations/009_purpose_columns.sql
git commit -m "feat: add purpose columns to sources, filter_rules, filter_config, insights"
```

---

### Task 2: Update filterRules.js to group by purpose

**Files:**
- Modify: `server/services/filterRules.js`

**Interfaces:**
- Consumes: `db` from `../db.js`
- Produces: `loadFilterRules(purpose)` returns rules filtered by purpose

- [ ] **Step 1: Rewrite filterRules.js**

```javascript
import db from "../db.js";

export function loadFilterRules(purpose = null) {
  if (purpose) {
    return db
      .prepare("SELECT * FROM filter_rules WHERE active = 1 AND (purpose = ? OR purpose = '') ORDER BY priority DESC, id ASC")
      .all(purpose);
  }
  return db
    .prepare("SELECT * FROM filter_rules WHERE active = 1 ORDER BY priority DESC, id ASC")
    .all();
}

export function groupRulesByPurpose(rules) {
  const grouped = {};
  for (const rule of rules) {
    const p = rule.purpose || "competitor";
    if (!grouped[p]) grouped[p] = { enterprise: [], include_keyword: [], exclude_keyword: [] };
    if (rule.type === "enterprise") grouped[p].enterprise.push(rule.name);
    else if (rule.type === "include_keyword") grouped[p].include_keyword.push(rule.name);
    else if (rule.type === "exclude_keyword") grouped[p].exclude_keyword.push(rule.name);
  }
  return grouped;
}

export function matchesAnyKeyword(item, keywords) {
  if (!keywords || keywords.length === 0) return false;
  const text = `${item.title || ""} ${item.summary || ""}`.toLowerCase();
  return keywords.some(k => text.includes(String(k).toLowerCase()));
}
```

- [ ] **Step 2: Test with sqlite3**

Run: `sqlite3 data/energy_insights.db "SELECT type, COUNT(*) FROM filter_rules WHERE purpose='competitor' GROUP BY type;"`
Expected: Shows counts (may be 0 until seeded)

- [ ] **Step 3: Commit**

```bash
git add server/services/filterRules.js
git commit -m "feat: group filter rules by purpose"
```

---

### Task 3: Update keywordGate.js to accept purpose-specific rules

**Files:**
- Modify: `server/services/keywordGate.js`

**Interfaces:**
- Consumes: `matchesAnyKeyword` from `filterRules.js`
- Produces: `applyKeywordGate(items, context)` where context includes `purposeRules`

- [ ] **Step 1: Rewrite keywordGate.js**

```javascript
import { matchesAnyKeyword } from "./filterRules.js";

function parseList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map(s => s.trim()).filter(Boolean);
  }
  return [];
}

export function applyKeywordGate(items, context) {
  const excludeKeywords = parseList(context.excludeKeywords);
  const purposeRules = context.purposeRules || {};

  const kept = [];
  let excluded = 0;

  for (const item of items) {
    if (!item.title) { excluded++; continue; }

    // Global exclude keywords (tracker_settings)
    if (excludeKeywords.length && matchesAnyKeyword(item, excludeKeywords)) {
      excluded++;
      continue;
    }

    // If no purpose rules configured, pass through
    const hasPurposeRules = Object.keys(purposeRules).length > 0;
    if (!hasPurposeRules) {
      kept.push(item);
      continue;
    }

    // Check if item matches at least one purpose
    let matched = false;
    for (const [purpose, rules] of Object.entries(purposeRules)) {
      const subjectMatch = rules.enterprise?.length > 0 && matchesAnyKeyword(item, rules.enterprise);
      const includeMatch = rules.include_keyword?.length > 0 && matchesAnyKeyword(item, rules.include_keyword);
      const excludeMatch = rules.exclude_keyword?.length > 0 && matchesAnyKeyword(item, rules.exclude_keyword);

      // Exclude keyword blocks the match for this purpose
      if (excludeMatch) continue;

      // Subject OR include keyword matches
      if (subjectMatch || includeMatch) {
        matched = true;
        item.matchedPurpose = purpose; // Tag which purpose matched
        break;
      }
    }

    if (!matched) {
      excluded++;
      continue;
    }

    kept.push(item);
  }

  return { kept, excluded };
}
```

- [ ] **Step 2: Test with node**

Run: `node -e "import {applyKeywordGate} from './server/services/keywordGate.js'; const items=[{title:'中石油收购案',summary:'test'}]; const rules={competitor:{enterprise:['中石油'],include_keyword:['收购'],exclude_keyword:[]}}; console.log(applyKeywordGate(items,{purposeRules:rules}).kept.length);"`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add server/services/keywordGate.js
git commit -m "feat: keyword gate routes by purpose"
```

---

### Task 4: Update llmProcessor.js to use purpose-specific prompt

**Files:**
- Modify: `server/services/llmProcessor.js`

**Interfaces:**
- Consumes: `db` from `../db.js`, `buildCategoryPrompt` from `businessCategories.js`
- Produces: `loadSemanticConfig(purpose)` returns purpose-specific prompt

- [ ] **Step 1: Add purpose parameter to loadSemanticConfig**

```javascript
export function loadSemanticConfig(purpose = null) {
  if (purpose) {
    const row = db
      .prepare("SELECT content FROM filter_config WHERE type = 'semantic' AND purpose = ? AND active = 1 LIMIT 1")
      .get(purpose);
    if (row) return row.content;
  }
  const row = db
    .prepare("SELECT content FROM filter_config WHERE type = 'semantic' AND (purpose = '' OR purpose IS NULL) AND active = 1 LIMIT 1")
    .get();
  return row ? row.content : "";
}
```

- [ ] **Step 2: Update processInsight to accept purpose**

Change the function signature:
```javascript
export async function processInsight(item, language = "en", filterContext = null) {
  // ... existing code ...
  const semanticPrompt = filterContext?.semanticPrompt || "";
  // ... rest unchanged
}
```

The `filterContext` already includes `semanticPrompt`, so callers just need to pass the purpose-specific prompt.

- [ ] **Step 3: Test**

Run: `node -e "import {loadSemanticConfig} from './server/services/llmProcessor.js'; console.log(loadSemanticConfig('competitor').slice(0,50));"`
Expected: Empty string or existing content (no error)

- [ ] **Step 4: Commit**

```bash
git add server/services/llmProcessor.js
git commit -m "feat: LLM processor accepts purpose-specific prompt"
```

---

### Task 5: Update tracker.js to route by purpose

**Files:**
- Modify: `server/services/tracker.js`

**Interfaces:**
- Consumes: `loadFilterRules` from `filterRules.js`, `groupRulesByPurpose` from `filterRules.js`, `loadSemanticConfig` from `llmProcessor.js`, `applyKeywordGate` from `keywordGate.js`
- Produces: Tracker routes each source through purpose-specific rules

- [ ] **Step 1: Update runTracker to load grouped rules and route by purpose**

Replace the keyword gate section in `runTracker`:

```javascript
const allRules = loadFilterRules();
const groupedRules = groupRulesByPurpose(allRules);

for (const source of sources) {
  try {
    console.log(`[tracker] Fetching source: ${source.name}`);
    const items = await fetchSourceItems(source);

    // Dedup against DB
    const newItems = [];
    for (const item of items) {
      if (!item.title) continue;
      const existing = db.prepare(
        "SELECT id FROM insights WHERE url = ? OR title = ?"
      ).get(item.url || "", item.title);
      if (!existing) newItems.push(item);
    }
    console.log(`[tracker] Source ${source.name}: fetched ${items.length}, new ${newItems.length}`);

    if (newItems.length === 0) { successCount++; continue; }

    // Get purposes for this source
    const sourcePurposes = (source.purpose || "competitor").split(",").map(s => s.trim()).filter(Boolean);
    const sourceRules = {};
    for (const p of sourcePurposes) {
      if (groupedRules[p]) sourceRules[p] = groupedRules[p];
    }

    // Keyword gate with purpose-specific rules
    const gate = applyKeywordGate(newItems, {
      excludeKeywords: settings.excludeKeywords,
      purposeRules: sourceRules
    });
    console.log(`[tracker] Source ${source.name}: ${gate.kept.length} items after keyword gate (${gate.excluded} excluded)`);

    if (gate.kept.length === 0) {
      successCount++;
      db.prepare(
        `UPDATE tracker_runs SET sources_success = ?, sources_failed = ?, insights_created = ?, message = ? WHERE id = ?`
      ).run(successCount, failedCount, insightsCreated, errors.join("; ").slice(0, 2000), runId);
      continue;
    }

    // Dedup
    const deduped = deduplicateItems(gate.kept, {
      threshold: settings.fuzzyDeduplicationThreshold,
      lookbackDays: Math.max(1, Math.ceil(settings.lookbackHours / 24) + 1)
    });
    console.log(`[tracker] Source ${source.name}: ${deduped.length} items after dedup`);

    const taggedItems = deduped.map(item => ({ ...item, sourceId: source.id }));
    const candidates = applyPreFilter(taggedItems, settings);
    console.log(`[tracker] Source ${source.name}: ${candidates.length} candidates after pre-filter`);

    if (candidates.length > 0) {
      // Group by matched purpose for LLM processing
      const byPurpose = {};
      for (const item of candidates) {
        const p = item.matchedPurpose || "competitor";
        if (!byPurpose[p]) byPurpose[p] = [];
        byPurpose[p].push(item);
      }

      const allProcessed = [];
      for (const [purpose, purposeItems] of Object.entries(byPurpose)) {
        const semanticPrompt = loadSemanticConfig(purpose);
        const filterContext = {
          semanticPrompt,
          categories: loadActiveCategories(),
          classificationEnabled: Boolean(process.env.LLM_API_KEY)
        };
        const processed = await processBatch(purposeItems, LANGUAGE, filterContext);
        allProcessed.push(...processed);
      }

      const kept = applyPostFilter(allProcessed, settings)
        .filter(insight => insight.title && insight.title.trim() !== "")
        .filter(insight => {
          if (!classificationEnabled) return true;
          if (insight.llmFailed) return true;
          return matchesEnabledCategory(insight, activeCategories);
        });
      console.log(`[tracker] Source ${source.name}: ${kept.length} insights after post-filter`);

      if (kept.length > 0) {
        const insert = db.prepare(
          `INSERT INTO insights (
            source_id, title, summary, url, publish_date, source_type,
            business_domain, enterprise_type, entities, features, raw_content, categories, purpose
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const insertMany = db.transaction((rows) => {
          for (const row of rows) {
            if (!row.title) continue;
            insert.run(
              source.id, row.title, row.summary, row.url, row.publishDate,
              row.sourceType, row.businessDomain, row.enterpriseType,
              JSON.stringify(row.entities), JSON.stringify(row.features),
              row.rawContent || row.summary || "",
              row.categories ? JSON.stringify(row.categories) : null,
              row.matchedPurpose || "competitor"
            );
          }
        });
        insertMany(kept);
        insightsCreated += kept.length;
        console.log(`[tracker] Source ${source.name}: created ${kept.length} insights`);
      }
    }

    successCount++;
    db.prepare(
      `UPDATE tracker_runs SET sources_success = ?, sources_failed = ?, insights_created = ?, message = ? WHERE id = ?`
    ).run(successCount, failedCount, insightsCreated, errors.join("; ").slice(0, 2000), runId);
  } catch (e) {
    // ... error handling unchanged
  }
}
```

- [ ] **Step 2: Update processBatch to accept filterContext**

```javascript
async function processBatch(items, language, filterContext = null) {
  const results = [];
  const ctx = filterContext || {
    semanticPrompt: loadSemanticConfig(),
    categories: loadActiveCategories(),
    classificationEnabled: Boolean(process.env.LLM_API_KEY)
  };
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(item => processInsight(item, language, ctx))
    );
    for (let j = 0; j < settled.length; j++) {
      const result = settled[j];
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        console.error(`[tracker] processInsight failed for batch item ${i + j}:`, result.reason?.message || result.reason);
      }
    }
    if (results.length === 0 && batch.length > 0) {
      throw new Error(`All ${batch.length} articles in batch failed LLM processing`);
    }
    if (i + BATCH_SIZE < items.length) await sleep(2000);
  }
  return results;
}
```

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add server/services/tracker.js
git commit -m "feat: tracker routes by purpose with purpose-specific LLM prompts"
```

---

### Task 6: Update insights route to return purpose

**Files:**
- Modify: `server/routes/insights.js`

**Interfaces:**
- Consumes: `db` from `../db.js`
- Produces: Insights include `purpose` field

- [ ] **Step 1: Update parseRow to include purpose**

```javascript
function parseRow(row) {
  if (!row) return row;
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    url: row.url,
    date: row.publish_date,
    publishDate: row.publish_date,
    sourceId: row.source_id,
    source: row.source_name || row.source_id,
    sourceType: row.source_type,
    businessDomain: row.business_domain,
    enterpriseType: row.enterprise_type,
    entities: safeJson(row.entities),
    features: safeJson(row.features),
    categories: safeJson(row.categories),
    rawContent: row.raw_content,
    hidden: row.hidden,
    purpose: row.purpose || "competitor"
  };
}
```

- [ ] **Step 2: Add purpose filter to GET endpoint**

```javascript
if (req.query.purpose) {
  conditions.push("purpose = ?");
  params.push(req.query.purpose);
}
```

- [ ] **Step 3: Test**

Run: `curl -s "http://127.0.0.1:3001/api/insights?purpose=competitor" | python3 -m json.tool | head -20`
Expected: Returns insights with purpose field

- [ ] **Step 4: Commit**

```bash
git add server/routes/insights.js
git commit -m "feat: insights API returns and filters by purpose"
```

---

### Task 7: Update sources routes to handle purpose

**Files:**
- Modify: `server/routes/sources.js`

**Interfaces:**
- Consumes: `db` from `../db.js`
- Produces: Sources CRUD supports `purpose` field

- [ ] **Step 1: Update POST / to accept purpose**

```javascript
router.post("/", (req, res) => {
  try {
    const { name, url, type = "rss", active = 1, config, purpose = "" } = req.body;
    // ... validation unchanged ...
    const configStr = config ? JSON.stringify(config) : null;
    const result = db.prepare(
      "INSERT INTO sources (name, url, type, active, config, purpose) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(name, url, type, active ? 1 : 0, configStr, purpose);
    // ... rest unchanged
  }
});
```

- [ ] **Step 2: Update PUT /:id to accept purpose**

```javascript
router.put("/:id", (req, res) => {
  try {
    const { name, url, type, active, config, purpose } = req.body;
    // ... validation unchanged ...
    const configStr = config ? JSON.stringify(config) : null;
    db.prepare(
      "UPDATE sources SET name = ?, url = ?, type = ?, active = ?, config = ?, purpose = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(name, url, type, active ? 1 : 0, configStr, purpose || "", req.params.id);
    // ... rest unchanged
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add server/routes/sources.js
git commit -m "feat: sources API supports purpose field"
```

---

### Task 8: Update filters routes to handle purpose

**Files:**
- Modify: `server/routes/filters.js`

**Interfaces:**
- Consumes: `db` from `../db.js`
- Produces: Filter rules CRUD supports `purpose` field

- [ ] **Step 1: Update POST /rules to accept purpose**

```javascript
router.post("/rules", (req, res) => {
  try {
    const { type, name, mustInclude, mustExclude, active, priority, purpose = "" } = req.body;
    const result = db.prepare(
      "INSERT INTO filter_rules (type, name, must_include, must_exclude, active, priority, purpose) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(type, name || null, JSON.stringify(toArray(mustInclude)), JSON.stringify(toArray(mustExclude)), active ? 1 : 0, priority || 0, purpose);
    res.json({ data: { id: result.lastInsertRowid } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 2: Update PUT /rules/:id to accept purpose**

```javascript
router.put("/rules/:id", (req, res) => {
  try {
    const { name, mustInclude, mustExclude, active, priority, purpose } = req.body;
    db.prepare(
      "UPDATE filter_rules SET name = ?, must_include = ?, must_exclude = ?, active = ?, priority = ?, purpose = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(name || null, JSON.stringify(toArray(mustInclude)), JSON.stringify(toArray(mustExclude)), active ? 1 : 0, priority || 0, purpose || "", req.params.id);
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add server/routes/filters.js
git commit -m "feat: filter rules API supports purpose field"
```

---

### Task 9: Update SourcesPage.jsx to show purpose selector

**Files:**
- Modify: `src/components/SourcesPage.jsx`

**Interfaces:**
- Consumes: `backendApi` from `../utils/backendApi.js`
- Produces: Sources page shows purpose field

- [ ] **Step 1: Add purpose to source form and table**

Add `purpose` to the source object state and form fields. The exact implementation depends on the current SourcesPage structure, but the key changes are:

- Add `purpose` to the source form (text input or multi-select with checkboxes for competitor/policy/tech)
- Display purpose in the sources table
- Pass purpose in create/update API calls

- [ ] **Step 2: Commit**

```bash
git add src/components/SourcesPage.jsx
git commit -m "feat: sources page shows purpose selector"
```

---

### Task 10: Update ContentFiltersPage.jsx to group by purpose

**Files:**
- Modify: `src/components/ContentFiltersPage.jsx`

**Interfaces:**
- Consumes: `backendApi` from `../utils/backendApi.js`
- Produces: Filter rules grouped by purpose with collapsible sections

- [ ] **Step 1: Group filter rules by purpose in the UI**

Change the rules rendering to group by purpose:

```javascript
const purposes = ["competitor", "policy", "tech"];
const rulesByPurpose = {};
for (const p of purposes) {
  rulesByPurpose[p] = {
    enterprise: enterpriseKeywords.filter(r => (r.purpose || "competitor") === p),
    include_keyword: includeKeywords.filter(r => (r.purpose || "competitor") === p),
    exclude_keyword: excludeKeywords.filter(r => (r.purpose || "competitor") === p)
  };
}
```

Render each purpose as a collapsible section with its three sub-lists.

- [ ] **Step 2: Commit**

```bash
git add src/components/ContentFiltersPage.jsx
git commit -m "feat: content filters grouped by purpose"
```

---

### Task 11: Update InsightCard.jsx to show purpose tag

**Files:**
- Modify: `src/components/InsightCard.jsx`

**Interfaces:**
- Consumes: `item` prop with `purpose` field
- Produces: Card displays purpose tag

- [ ] **Step 1: Add purpose chip to InsightCard**

```javascript
const purposeLabels = {
  competitor: language === "zh" ? "竞争监控" : "Competitor",
  policy: language === "zh" ? "政策监控" : "Policy",
  tech: language === "zh" ? "技术突破" : "Tech"
};
const purposeColors = {
  competitor: "#e74c3c",
  policy: "#3498db",
  tech: "#27ae60"
};
```

Add a chip showing the purpose next to the source name.

- [ ] **Step 2: Commit**

```bash
git add src/components/InsightCard.jsx
git commit -m "feat: insight card shows purpose tag"
```

---

### Task 12: Update i18n and CSV template

**Files:**
- Modify: `src/constants/i18n.js`
- Modify: `public/content-filters-template.csv`

**Interfaces:**
- Produces: Purpose labels in both languages, CSV template includes purpose

- [ ] **Step 1: Add purpose labels to i18n**

```javascript
// In both en and zh sections, add:
purposeLabels: {
  competitor: "Competitor Monitoring" / "竞争监控",
  policy: "Policy Monitoring" / "政策监控",
  tech: "Tech Breakthrough" / "技术突破"
}
```

- [ ] **Step 2: Update CSV template to include purpose column**

Add `purpose` column to the template headers.

- [ ] **Step 3: Commit**

```bash
git add src/constants/i18n.js public/content-filters-template.csv
git commit -m "feat: i18n and CSV template support purpose"
```

---

### Task 13: Seed purpose-specific filter rules

**Files:**
- Create: `server/seeds/seedPurposeRules.js` (or inline script)

**Interfaces:**
- Consumes: `Key Config.xlsx`, `db` from `../db.js`
- Produces: Purpose-tagged filter rules in DB

- [ ] **Step 1: Write seed script to extract and tag rules by purpose**

```javascript
import "dotenv/config";
import db from "../db.js";
import { execFileSync } from "child_process";
import path from "path";
import os from "os";
import fs from "fs";

function runPython(script) {
  const tmpDir = os.tmpdir();
  const scriptPath = path.join(tmpDir, `seed-${Date.now()}.py`);
  fs.writeFileSync(scriptPath, script);
  const out = execFileSync("python3", [scriptPath], { encoding: "utf-8" });
  fs.unlinkSync(scriptPath);
  return JSON.parse(out);
}

const script = `
import pandas as pd
import json

xl = pd.ExcelFile('Key Config.xlsx')

# Competitor rules
comp = pd.read_excel(xl, sheet_name='底层过滤关键词', header=None).iloc[1:]
competitor = {'enterprise': set(), 'include': set(), 'exclude': set()}
for _, row in comp.iterrows():
    base = str(row.iloc[0]).strip() if pd.notna(row.iloc[0]) else ''
    inc = str(row.iloc[4]).strip() if len(row) > 4 and pd.notna(row.iloc[4]) else ''
    exc = str(row.iloc[5]).strip() if len(row) > 5 and pd.notna(row.iloc[5]) else ''
    if base: competitor['enterprise'].add(base)
    if inc: competitor['include'].add(inc)
    if exc: competitor['exclude'].add(exc)

# Policy rules
policy = {'enterprise': set(), 'include': set(), 'exclude': set()}
for name in ['国家能源局', '国家发改委', '交通部', '生态环境部', '工信部', '财政部', '商务部', '能源局']:
    policy['enterprise'].add(name)
for kw in ['政策', '规划', '通知', '批复', '标准', '方案', '意见', '办法', '条例', '规定', '指导', '部署']:
    policy['include'].add(kw)
for kw in ['培训', '会议', '学术', '获奖', '颁奖', '庆典', '活动', '论坛', '展会', '广告']:
    policy['exclude'].add(kw)

# Tech rules
tech = {'enterprise': set(), 'include': set(), 'exclude': set()}
for kw in ['新能源', '储能', '光伏', '油气', 'CCUS', '氢能', '锂电池', '燃料电池', '风电', '核电', '太阳能', '智能电网', '充电', '换电', '电池回收', '碳捕捉', '碳封存']:
    tech['enterprise'].add(kw)
for kw in ['突破', '创新', '研发', '专利', '首次', '发布', '量产', '试制', '试验', '验证', '示范', '应用', '落地']:
    tech['include'].add(kw)
for kw in ['获奖', '任命', '推广', '广告', '赞助', '招聘', '培训', '会议']:
    tech['exclude'].add(kw)

result = {
    'competitor': {k: sorted(v) for k, v in competitor.items()},
    'policy': {k: sorted(v) for k, v in policy.items()},
    'tech': {k: sorted(v) for k, v in tech.items()}
}
print(json.dumps(result, ensure_ascii=False))
`;

const data = runPython(script);

db.prepare("DELETE FROM filter_rules").run();

const insert = db.prepare(
  "INSERT INTO filter_rules (type, name, must_include, must_exclude, active, priority, purpose) VALUES (?, ?, '[]', '[]', 1, 0, ?)"
);

const tx = db.transaction(() => {
  for (const [purpose, rules] of Object.entries(data)) {
    for (const kw of rules.enterprise) insert.run("enterprise", kw, purpose);
    for (const kw of rules.include) insert.run("include_keyword", kw, purpose);
    for (const kw of rules.exclude) insert.run("exclude_keyword", kw, purpose);
  }
});
tx();

const counts = db.prepare("SELECT purpose, type, COUNT(*) as cnt FROM filter_rules GROUP BY purpose, type").all();
console.log(JSON.stringify(counts, null, 2));
```

- [ ] **Step 2: Run seed script**

Run: `node server/seeds/seedPurposeRules.js`
Expected: Rules inserted with correct purpose tags

- [ ] **Step 2: Run seed script**

Run: `node server/seeds/seedPurposeRules.js`
Expected: Rules inserted with correct purpose tags

- [ ] **Step 3: Commit**

```bash
git add server/seeds/seedPurposeRules.js
git commit -m "feat: seed purpose-specific filter rules"
```

---

### Task 14: Update tracker settings page to show purpose

**Files:**
- Modify: `src/components/TrackerSettingsPage.jsx`

**Interfaces:**
- Produces: Settings page shows purpose-related config

- [ ] **Step 1: Add purpose display to tracker settings**

Show which purposes are configured and allow toggling them on/off.

- [ ] **Step 2: Commit**

```bash
git add src/components/TrackerSettingsPage.jsx
git commit -m "feat: tracker settings shows purpose config"
```

---

### Task 15: Run tracker and verify

**Files:**
- No file changes, verification only

- [ ] **Step 1: Restart dev server**

```bash
pkill -f "nodemon server/index.js" || true; pkill -f "vite" || true; sleep 1; npm run dev
```

- [ ] **Step 2: Tag existing sources with purposes**

```bash
sqlite3 data/energy_insights.db <<'SQL'
UPDATE sources SET purpose = 'competitor' WHERE name IN ('财新能源', '第一财经', '新浪财经', '金融界');
UPDATE sources SET purpose = 'competitor' WHERE name IN ('微信公众号聚合 (19个账号)');
UPDATE sources SET purpose = 'policy' WHERE name IN ('国家能源局', '中国石油官网', '中国石化官网', '中国海油官网', '美国能源信息署');
UPDATE sources SET purpose = 'competitor,policy' WHERE name IN ('中国能源网');
SQL
```

- [ ] **Step 3: Run tracker**

```bash
curl -s -X POST http://127.0.0.1:3001/api/tracker/run
```

- [ ] **Step 4: Verify insights have purpose tags**

```bash
sqlite3 data/energy_insights.db "SELECT id, title, purpose FROM insights ORDER BY id DESC LIMIT 5;"
```

Expected: Insights show `purpose` field with values like `competitor`, `policy`, `tech`

- [ ] **Step 5: Commit final state**

```bash
git add -A
git commit -m "feat: purpose-based monitoring complete"
```
