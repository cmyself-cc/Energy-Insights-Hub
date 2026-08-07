# AGENTS.md — Energy Insights Hub

This file is a quick reference for AI coding agents working on this project. It describes the project's purpose, architecture, layout, conventions, and how to build/test/deploy it.

## Project overview

**Energy Insights Hub** (混沌能源智库) is a full-stack intelligence platform that monitors energy-industry news from configured sources, filters them through a multi-stage pipeline (industry pre-filter → keyword gate → LLM semantic processing), and presents the results as insight cards on a Market Intelligence dashboard.

The platform serves three monitoring purposes:

- **Competitor monitoring** — business moves of tracked companies (investments, cooperation, M&A, contracts).
- **Policy monitoring** — energy/policy news from government agencies.
- **Tech monitoring** — breakthroughs in tracked technology areas (storage, PV, hydrogen, oil & gas, CCUS, etc.).

Key features:

- Source management: RSS / website / WeChat MCP / API sources; website crawler supports sub-page discovery, Playwright headless rendering for JS-heavy sites, and JSON API interception.
- Content filtering: industry pre-filter (business-domain keywords with LLM-generated synonyms/aliases), keyword gate (enterprise + include keywords AND logic, exclude keywords), semantic prompts per monitoring purpose.
- Insight cards with LLM-generated titles/summaries/keywords, bookmark/hide feedback that feeds back into filtering weights.
- Config UI: data sources, content filters (3 purpose tabs), AI interpretation presets, feedback page, tracker settings, unified config import/export.
- Bilingual (中文 / English), dark mode.

## Technology stack

- **Frontend:** React 18 + Vite 5 (`src/`), plain JS/JSX, inline styles referencing `src/constants/theme.js`.
- **Backend:** Express + better-sqlite3 (`server/`), port `3001`. Vite dev server proxies `/api` to `localhost:3001`.
- **Crawlers:** `rss-parser`, `cheerio`, `playwright` (headless Chromium for JS-heavy sites).
- **LLM:** OpenAI-compatible API (base URL/model/API key from server env: `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_PROVIDER`).
- **Database:** SQLite via `better-sqlite3`; schema managed by numbered SQL migrations in `server/migrations/`.
- **Testing:** Vitest (`*.test.js` next to source files in `server/`).
- **Deployment:** Docker (`Dockerfile`), CI workflow under `.github/workflows/`, deployed to `eih.cmyself.cc` via a Mac Mini runner.

## Build and run commands

```bash
# Install dependencies
npm install

# Dev: run backend + frontend together
npm run dev

# Backend only (Express, port 3001)
npm run dev:server

# Frontend only (Vite, port 5177, strictPort)
npm run dev:client

# Production build; output goes to ./dist
npm run build

# Lint
npm run lint

# Run tests (Vitest; no `test` script — invoke directly)
npx vitest run

# Run the production server (serves dist + API when NODE_ENV=production)
npm run server
```

`vite.config.js`: port `5177`, `/api` proxied to `http://localhost:3001`.

## Project structure

```text
.
├── index.html                 # SPA entry point
├── package.json               # Dependencies and scripts
├── vite.config.js             # Vite config (React plugin, port 5177, /api proxy)
├── Dockerfile                 # Production container image
├── .github/workflows/         # CI / auto-deploy workflow
├── data/                      # SQLite database file (runtime data)
├── dist/                      # Production build output
├── server/
│   ├── index.js               # Express app entry; serves API + static dist in production
│   ├── db.js                  # SQLite connection + migration runner
│   ├── migrations/            # Numbered SQL migration files
│   ├── routes/                # Express routers: sources, insights, tracker, filters, industries, feedback, settings, reports
│   ├── crawlers/              # fetchArticles dispatch + rss/website/wechat_mcp/wechatAlbum/api crawlers, utils
│   ├── services/              # tracker pipeline, keywordGate, filterRules, llmProcessor, dedup, feedbackWeights, businessCategories, trackerRules
│   ├── lib/                   # configParser, sourcesMdLoader, trackerSettings, llmAlias
│   └── seeds/                 # seed sources, industry categories, default rules/prompts
└── src/
    ├── App.jsx                # Shell: sidebar, header, page routing, toasts
    ├── main.jsx               # Mounts <App /> in <ErrorBoundary> + StrictMode
    ├── components/            # IntelligencePage, ReportsPage, ConfigurationPage, SourcesPage,
    │                          #   ContentFiltersPage, TrackerSettingsPage, FeedbackPage, InsightCard,
    │                          #   CardActions, FilterBar, Header, Sidebar, AiDrawer, TrackerProgress, ...
    ├── constants/             # theme.js, i18n.js, taxonomy.js
    └── utils/                 # backendApi.js, api.js, csvConfig.js, storage.js
```

## Runtime architecture

1. **Fetch layer** (`server/services/tracker.js` Phase 1): `fetchArticles(source)` dispatches by source type to the appropriate crawler (`rssCrawler`, `websiteCrawler`, `wechatMcpCrawler`, `apiCrawler`). The website crawler tries RSS → sitemap → HTML list → Playwright (headless browser, incl. JSON API interception) in that order.
2. **Filter layer** (Phases 2): industry pre-filter (`applyIndustryFilter`, uses business-domain keywords + LLM aliases) → date lookback filter → keyword gate (`applyKeywordGate`: per-purpose `enterprise` AND `include_keyword` must both match; `exclude_keyword` blocks) → dedup.
3. **Semantic layer** (Phase 3): LLM reads each surviving article's content, generating `title`, `summary` (≤150 chars), `keywords`, `categories`, `purposes`, and `china_relevance`. The extraction system prompt lives in `llm_prompts` (key `insight_extraction`); the additional semantic prompt per purpose lives in `filter_config` (`type='semantic'`).
4. **Storage layer**: processed items are saved to the `insights` table (the "insights pool"); feedback weights (`feedbackWeights.js`) may drop low-scoring items.
5. **Frontend** queries `/api/insights` with filters (monitoring type, business, event, source, date, keyword) and renders insight cards.

## Key data model

- `sources` — name, url, type (`rss`/`website`/`wechat_mcp`/`api`), active, purpose (comma-separated monitoring types; empty = all), config JSON (list selectors, sub-pages, etc.).
- `filter_rules` — type (`enterprise`/`include_keyword`/`exclude_keyword`), name, purpose, active, `aliases` (JSON array of synonyms generated by LLM at add time).
- `industry_categories` — business-domain categories with keywords + aliases, used by the industry pre-filter.
- `insights` — processed cards: title, summary, url, publish_date, purposes, categories, keywords, source info.
- `tracker_settings` — key/value: lookback_hours, max_per_source, dedup threshold, required industry keywords, monitoring toggles.
- `filter_config` — semantic prompts (`type='semantic'`, per purpose) and AI interpretation presets (`type='ai_presets'`).
- `llm_prompts` — tunable LLM system prompts keyed by use case (`insight_extraction`, `screen_cards`, `clarify_cards`, `generate_manual_prompt`, `manual_prompt_fallback`, `feedback_suggestions`, `ai_interpret_zh`, `ai_interpret_en`). Defaults live in `server/services/promptStore.js` (`DEFAULT_PROMPTS`) and are seeded once at startup — DB edits are never overwritten. Read via `getPrompt(key)` + `fillPrompt(template, vars)` (`{{var}}` placeholders).

## Code style and conventions

- **File extensions:** React components `.jsx`; server/utilities `.js`. ES modules everywhere (`"type": "module"`).
- **Components:** functional + hooks; inline styles from `src/constants/theme.js` (`COLORS`, `FONT_SIZES`, `BORDER_RADIUS`, `TRANSITIONS`).
- **i18n:** user-facing strings in `src/constants/i18n.js` (`i18n.en` / `i18n.zh`), accessed via `const t = i18n[language]`.
- **Backend:** Express routers in `server/routes/`; business logic in `server/services/`; DB access via `better-sqlite3` prepared statements; JSON responses wrapped as `{ data: ... }` or `{ error: ... }`.
- **Keyword matching:** `matchesAnyKeyword` in `server/services/filterRules.js` expands each rule's `name` + `aliases` for substring matching. When adding/editing a keyword, aliases are generated via `server/lib/llmAlias.js` (best-effort; failure degrades to base keyword only).
- **Comments:** Mixed English and Chinese; UI labels/messages in Chinese for the zh locale.

## Testing

- Vitest: tests are `*.test.js` files colocated in `server/`. Run `npx vitest run`.
- The tracker is a multi-stage pipeline; a good smoke test is running a tracker run (`POST /api/tracker/run`) and checking the log/`tracker_runs` table.

## Deployment

- Production image: `Dockerfile` (builds frontend, runs `node server/index.js` with `NODE_ENV=production`).
- CI: `.github/workflows/` auto-deploys on push to `main` (Mac Mini runner pulls and does `docker compose up -d --force-recreate energy-insights-hub`).
- Live site: `eih.cmyself.cc`.

## Security considerations

- **LLM API keys live on the server** (env vars / Docker environment: `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`), NOT in the browser. The frontend selects among configured model records; keys are never sent to the client.
- `.env` is gitignored; do not commit real API keys.
- The user has explicitly stated: **do not delete any data from the database (especially config) without their approval.**
