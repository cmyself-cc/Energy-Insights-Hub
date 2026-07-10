# Final Fix Report — Content Filtering & Source Import

## Issues Fixed

### 1. Truncated seeded category prompts (`server/migrations/004_content_filters.sql:48-57`)

**Problem:** Migration seeds `business_categories` with truncated `inclusion_prompt` placeholders ending in `...`. Because `/api/tracker/import-config` skipped existing categories in append mode, uploading `Key Config.xlsx` never replaced the placeholders with the full Excel prompts.

**Fix:** In `server/routes/tracker.js`, append-mode category import now upserts existing categories by running `UPDATE business_categories SET description = ?, inclusion_prompt = ?, active = 1 ... WHERE name = ?` when the category already exists. New categories are still inserted. Replace mode behavior is unchanged.

**Files changed:**
- `server/routes/tracker.js`
- `server/routes/tracker.test.js` (added regression test)

### 2. Zero insights when no LLM API key (`server/services/llmProcessor.js:48-61` + `server/services/tracker.js`)

**Problem:** `processInsight` returns an empty `categories` array when `LLM_API_KEY` is unset, and `server/services/tracker.js` unconditionally dropped any insight that did not match an enabled business category.

**Fix:** Added `classificationEnabled: Boolean(process.env.LLM_API_KEY)` to the `filterContext` in `processBatch`, and gated the `matchesEnabledCategory` post-filter in `runTracker` so category matching is only enforced when the LLM is actually invoked.

**Files changed:**
- `server/services/tracker.js`

### 3. Replace-mode deletes outside transaction (`server/services/sourceImporter.js:29-34`)

**Problem:** In replace mode, source deletes happened before the insert transaction. If the insert failed, previously imported sources were already gone.

**Fix:** Moved the `DELETE FROM sources ...` and `DELETE FROM source_imports` statements inside the same `db.transaction()` that performs the inserts, and recomputed the duplicate-check set after the deletes so the import sees the post-delete state.

**Files changed:**
- `server/services/sourceImporter.js`

### 4. Python/pandas runtime dependency not documented (`server/lib/configParser.js:149-171`)

**Problem:** Excel parsing shells out to `python3` with `pandas`, but this was not documented. Replacing it with a pure-Node library would add a new runtime npm dependency, which violates the project constraint.

**Fix:** Documented the requirement in:
- `docs/superpowers/specs/2026-07-09-content-filtering-design.md` (Excel import section)
- `AGENTS.md` (new "Backend runtime requirements" section)

**Files changed:**
- `docs/superpowers/specs/2026-07-09-content-filtering-design.md`
- `AGENTS.md`

## Verification

### Lint

```bash
npm run lint
```

Result: **pass** (0 errors, 0 warnings).

### Server unit tests

```bash
node --test server/services/filterRules.test.js \
             server/services/businessCategories.test.js \
             server/lib/configParser.test.js \
             server/services/sourceImporter.test.js \
             server/services/trackerRules.test.js \
             server/services/llmProcessor.test.js \
             server/lib/sourcesMdLoader.test.js \
             server/crawlers/websiteCrawler.test.js \
             server/crawlers/rssCrawler.test.js \
             server/crawlers/wechatCrawler.test.js \
             server/routes/tracker.test.js
```

Result:

```
# tests 62
# suites 12
# pass 62
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Result: **pass**.

## Commit

Fixes committed on branch `feat/tracker-rules`.
