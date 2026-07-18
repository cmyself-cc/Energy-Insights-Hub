# Final Fix Report: Purpose-Based Monitoring — Whole-Branch Review Findings

**Date:** 2026-07-18
**Fixes for:** `.superpowers/sdd/final-review.md` — 3 Important issues
**Commit:** see `git log` — "fix: purpose monitoring backward compat, fail-closed toggle, seed purpose prompts"

## Issue 1: Backward compatibility violated — FIXED

**Problem:** `tracker.js` defaulted untagged sources (`purpose = ''`) to `"competitor"`, so they were gated by competitor rules only. `groupRulesByPurpose` also forced legacy `purpose = ''` rules into the competitor bucket, inconsistent with `loadFilterRules(purpose)`'s "empty purpose matches everything" convention.

**Changes:**

- `server/services/filterRules.js` — rewrote `groupRulesByPurpose`: rules with `purpose = ''` are collected as *global* rules and merged into every purpose bucket. If only global rules exist, they are exposed under all known purposes (new exported `PURPOSES = ["competitor", "policy", "tech"]`). No more forcing legacy rules into `competitor`.
- `server/services/tracker.js:109` — untagged sources (`source.purpose` empty) now pass the **entire** `groupedRules` map to the keyword gate (all rules), restoring pre-purpose behavior.

**Verification:** smoke test confirmed global rules merge into every bucket; global-only rules appear under competitor+policy+tech; with the real DB, an untagged source resolves all three buckets (`competitor,policy,tech` — 369/30/38 seeded rules). 16 untagged live sources (Reuters Energy, Bloomberg Energy, IEA News, etc.) are again gated by all rules.

## Issue 2: Purpose toggle fails open — FIXED

**Problem:** The Tracker Settings toggle deactivates all rules of a purpose. Sources tagged only with that purpose then built an empty `sourceRules` map, and `applyKeywordGate` treated empty `purposeRules` as "pass everything through" — disabling a purpose made its sources ingest completely unfiltered.

**Change:** `server/services/tracker.js` — when a source declares purposes but none of them have active rules (`sourceRules` empty), the source is now **skipped** (logged as `skipped, no active rules for purpose(s) ...`, counted as success) instead of passing everything through. Untagged sources with no rules configured at all still pass through (true backward-compatible "no gating configured" case).

**Verification:** with the real DB, deactivated all `tech` rules in a transaction and rebuilt the grouped map: a `tech`-only source resolved to skipped; a `competitor,tech` source kept its competitor rules only. Rolled back afterwards — DB unchanged. Gate unit check: non-empty `purposeRules` with no match excludes the item; empty `purposeRules` still passes through.

## Issue 3: Per-purpose LLM prompts never seeded — FIXED

**Problem:** `filter_config` had exactly one `semantic` row with `purpose = ''`, so `loadSemanticConfig(purpose)` always fell back to the global prompt; the spec's three analyst prompts existed only as plumbing.

**Changes:**

- New `server/seeds/seedPurposePrompts.js` — exports `PURPOSE_PROMPTS` (竞争情报分析师 / 政策分析师 / 技术分析师, phrased as semantic-exclusion rules matching how `llmProcessor.js` consumes them, keyed to each spec's output fields: 主体公司/事件类型/合作方/交易规模, 政策名称/发文机构/受影响行业, 技术领域/创新点/应用场景) and `seedPurposePrompts()` (insert-if-missing per purpose, so edited prompts are never overwritten). Runnable standalone via `node server/seeds/seedPurposePrompts.js`.
- `server/seeds/seedPurposeRules.js` — now calls `seedPurposePrompts()` after seeding rules and prints the resulting `filter_config` rows.

**Verification:** ran the standalone seed against the live DB — 4 `semantic` rows now exist (`''`, `competitor`, `policy`, `tech`), re-run is idempotent (still 4 rows, no duplicates). `loadSemanticConfig('competitor'|'policy'|'tech')` returns three distinct purpose-specific prompts, distinct from the global fallback.

## Checks

- `npm run lint` — clean (`--max-warnings 0`).
- `node --test server/routes/tracker.test.js` — 2 pass / 3 fail, but the 3 failures (`/import-config` category-import counts) are **pre-existing**: verified identical failures on the unmodified tree via `git stash`. Not related to these fixes.
- Live DB state: 4 semantic config rows; filter_rules unchanged (369 competitor / 30 policy / 38 tech, all active); the deactivation test was transactional and rolled back.

## Not addressed (out of scope, from the review's Minor list)

Stale Tavily source row (id=61), CSV purpose column not wired in `csvConfig.js`, dead `requiredIndustryKeywords`/`requiredCompanyKeywords` settings, `.env.example` model drift, `filters.js` `/config` `LIMIT 1` without purpose predicate (worth revisiting now that purpose-specific `filter_config` rows exist), plan/progress doc hygiene.
