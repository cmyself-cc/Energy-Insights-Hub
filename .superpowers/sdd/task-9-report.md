# Task 9 Report: routes/sources.js 发现端点接入挑战层

**Status:** DONE
**Commit:** `7ad65be` — `fix: route source discovery endpoints through challenge-aware fetch`

## What I implemented

Switched both sub-page discovery endpoints in `server/routes/sources.js` from raw
`fetchWithTimeout(...).text()` (UTF-8-forced, no challenge handling) to the
challenge-aware `fetchHtmlSmart(...)` from `server/crawlers/challenge.js`
(GBK/charset decoding, retry, WAF challenge solving, cookie cache):

1. **Imports (lines 7–8):** replaced
   `import { fetchWithTimeout, randomUserAgent } from "../crawlers/utils.js";`
   with
   `import { randomUserAgent } from "../crawlers/utils.js";` and
   `import { fetchHtmlSmart } from "../crawlers/challenge.js";`.
   `fetchWithTimeout` was verified to have zero remaining references in the file
   (grep after edit: no matches), so it was removed from the import per the brief.
   `randomUserAgent` is kept and still used in both new calls.

2. **`POST /:id/discover-subpages`** (line 173): fetch of the source homepage now
   `const html = await fetchHtmlSmart(source.url, { headers: { "User-Agent": randomUserAgent(), "Accept": "text/html" } }, 20000);`

3. **`POST /:id/confirm-subpages`** (line 199): fetch of each confirmed sub-page for
   list-selector detection now uses the same `fetchHtmlSmart(sp.url, {...}, 20000)` shape.
   Error behavior is preserved: the surrounding `try/catch` still sets
   `sp.listSelectors = []` if the fetch/challenge-solving throws (verified
   `fetchHtmlSmart` throws `WAF challenge could not be solved for <url>` when unsolvable).

Signature compatibility confirmed against `server/crawlers/challenge.js:222`:
`export async function fetchHtmlSmart(url, options = {}, timeoutMs = 20000, { retryDelayMs = 1000 } = {})`
— it returns a decoded HTML **string** (via `fetchDecoded`), so the downstream
`discoverSubPages(html, source.url)` and `discoverListSelectors(html)` calls receive
the same type they did before, now correctly decoded for GBK pages.

## Verification

### eslint — `server/routes/sources.js` (before vs after)

| When | Finding |
|------|---------|
| Before change | `192:63 error Empty block statement no-empty` (1 problem) |
| After change  | `193:63 error Empty block statement no-empty` (1 problem) |

Same single pre-existing error (line shifted 192→193 because one import line was
added). **Zero new lint issues introduced.** The pre-existing `catch {}` inside
confirm-subpages' `JSON.parse` was left untouched per instructions.

Additionally verified via stash-diff of full `npm run lint`: the sources.js section of
the lint output is identical before and after (same 1 error), while the full-project
lint has unrelated pre-existing failures elsewhere (23 problems total: 15 errors /
8 warnings, e.g. `no-dupe-keys` in `src/constants/i18n.js`, unused vars in
`src/components/*`) — none touched or caused by this task.

### build — `npm run build`

Exit code 0. `vite v5.4.21` built successfully: 60 modules transformed,
`dist/index.html`, `dist/assets/index-*.css`, `dist/assets/index-*.js` emitted in 886ms.
The >500 kB chunk-size warning is informational and pre-existing.

### grep

`fetchWithTimeout` in `server/routes/sources.js` after edits: no matches.

## Files changed

- `server/routes/sources.js` — 6 insertions, 5 deletions (import line split + two fetch sites)

## Self-review findings

- `fetchHtmlSmart` returns a string, matching the prior `.text()` contract — no shape change for callers.
- Timeout argument (20000) and headers (`User-Agent` via `randomUserAgent()`, `Accept: text/html`) preserved exactly at both sites, matching the brief's target code verbatim.
- Error paths preserved: discover-subpages still returns 500 with `e.message` on failure; confirm-subpages still falls back to `listSelectors = []` per sub-page on fetch error.
- No other routes, crawlers, or files were modified. Unrelated pre-existing working-tree changes (`.superpowers/sdd/progress.md`, task-7/8 reports, untracked docs) were deliberately NOT staged.
- No unit tests exist for these endpoints (pre-existing, per task instructions); verification was eslint + build only, as directed. No new test infrastructure invented.

## Deviations

None. All three steps of the brief followed exactly, including the exact commit message.
One note: the brief's Step 2 says `npm run lint && npm run build` "均通过"; full
`npm run lint` cannot pass due to pre-existing project-wide errors unrelated to this
file (documented above). Per the task instructions, the required verification was
`npx eslint server/routes/sources.js` introducing no new issues (satisfied — findings
identical before/after) and `npm run build` (exit 0).
