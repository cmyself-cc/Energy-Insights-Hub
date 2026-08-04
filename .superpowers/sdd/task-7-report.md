# Task 7 Report: maxAgeDays 全路径生效 + publishDate 空值处理

**Commit:** `94af837` — `feat(crawler): enforce maxAgeDays on HTML/RSS paths, preserve null publishDate`

## What was implemented

- **3a — `isTooOld(publishDate, maxAgeDays)` helper**: added directly after `scoreAndLimit` in `websiteCrawler.js`, verbatim from the brief (returns false for null/invalid dates or non-positive maxAgeDays).
- **3b — `fetchArticleDetail` keeps null**: replaced `extractPublishedDate($) || new Date().toISOString()` with `const publishDate = extractPublishedDate($);` plus the brief's explanatory comment.
- **3c — HTML list branch (`fetchArticles`)**: after `fetchArticleDetail`, added `isTooOld` skip (with `console.log` message, verbatim) and `if (!article.publishDate) article.publishDate = new Date().toISOString();` fallback before push.
- **3d — Playwright DOM branch (`fetchWithPlaywright`)**: same skip + fallback, no console.log, verbatim from the brief.
- **3e — Playwright API branch (verification only, no code change)**: confirmed by reading the code. Line 569 `publishDate: detail.publishDate || new Date().toISOString()` tolerates null; the catch branch and the no-URL branch use plain `new Date().toISOString()`. See self-review finding below for one nuance.
- **3f — `fetchSitemapArticles`**: push now reads `publishDate: candidate.publishDate || detail.publishDate || new Date().toISOString()`.
- **3g — `fetchRssArticles`**: added `items = items.filter(item => !isTooOld(item.publishDate, config.maxAgeDays));` after the `requireNewsPattern` filter and before the enrichment loop. RSS items with no pubDate already get `new Date().toISOString()` in the map stage, so undated items survive the filter.

Tests added verbatim from the brief inside `describe("fetchArticles", { concurrency: false })`:
1. `skips articles older than maxAgeDays in the HTML list path`
2. `keeps articles without a detectable date and falls back to now`

## TDD evidence

**RED** — `npx vitest run server/crawlers/websiteCrawler.test.js` (before implementation):

```
× skips articles older than maxAgeDays in the HTML list path 1019ms
✓ keeps articles without a detectable date and falls back to now  505ms

 FAIL  ... > skips articles older than maxAgeDays in the HTML list path
AssertionError: expected 2 to be 1 // Object.is equality

 Tests  1 failed | 12 passed (13)
```

Failed for the right reason: the 10-day-old article was not filtered (2 articles returned instead of 1). Note: test 2 passed even at RED because the fallback then lived inside `fetchArticleDetail`; after 3b it guards the relocated fallback in the HTML loop.

**GREEN** — `npx vitest run server/crawlers/websiteCrawler.test.js server/crawlers/challenge.test.js` (after implementation):

```
 ✓ server/crawlers/websiteCrawler.test.js (13 tests)
     ✓ skips articles older than maxAgeDays in the HTML list path  508ms
     ✓ keeps articles without a detectable date and falls back to now  507ms
 Test Files  2 passed (2)
      Tests  31 passed (31)
```

websiteCrawler.test.js: 13/13; challenge.test.js: 18/18 (31 total).

## Files changed

- `server/crawlers/websiteCrawler.js` (+22/−2)
- `server/crawlers/websiteCrawler.test.js` (+47)

## Self-review findings

1. **Playwright API branch nuance (3e)**: the brief describes "两处 `publishDate: detail.publishDate || new Date().toISOString()`" in the API branch; in the actual code there is one such site (line 569). There is also a direct `articles.push(detail)` at line 563 (taken when the detail title looks authoritative). After 3b, that pushed object can carry `publishDate: null` when the page has no detectable date. Per the brief's explicit instruction ("无需改动；检查确认即可") I left it unchanged, but flagging it: downstream consumers of API-branch articles may receive null publishDate. (The RSS enrichment's analogous `item.publishDate = detail.publishDate || item.publishDate` is null-safe because the RSS-side value is never null.)
2. Sitemap path was already safe (`candidate.publishDate` is always set at candidate-build time); the 3f fallback is defense in depth, and sitemap lastmod age-filtering already existed.
3. `isTooOld` is called after detail fetch in HTML/Playwright-DOM paths (date only known after fetch) and before enrichment in RSS (pubDate known from feed) — placement matches the brief.
4. Verified `utils.js` `extractPublishedDate` handles `meta[property="article:published_time"]` (used by the new tests) and returns null when nothing matches; utils.js was not modified.

## Deviations

None. Both tests were added verbatim from the brief and pass as written; RED matched the brief's expectation (first case returns 2 articles). All sub-steps 3a–3g applied exactly as specified.

## Follow-up fix: Playwright API branch publishDate fallback

**Commit:** `fix(crawler): apply publishDate fallback in Playwright API branch` (new commit, not an amend)

**What changed:** Self-review finding #1 was confirmed as a real gap: after 3b, the Playwright API branch's direct `articles.push(detail)` (the branch in `fetchWithPlaywright` where the detail title looks authoritative, `websiteCrawler.js` ~line 563) could emit an article with `publishDate: null` into the pool, which downstream would store as `insights.publish_date = NULL` and break date sorting/display. Per the spec intent ("fallback applied by the caller before pushing"), added one line in that branch only, immediately before the push, matching the 3c/3d style:

```javascript
                if (!detail.publishDate) detail.publishDate = new Date().toISOString();
                articles.push(detail);
```

No other branches were touched — they already handle null via their existing `|| new Date().toISOString()` expressions or the 3c/3d/3f fallbacks.

**Verification:** `npx vitest run server/crawlers/websiteCrawler.test.js server/crawlers/challenge.test.js` → `Test Files 2 passed (2)`, `Tests 31 passed (31)`.
