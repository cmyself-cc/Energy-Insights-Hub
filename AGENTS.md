# AGENTS.md — Energy Insights Hub

This file is a quick reference for AI coding agents working on this project. It describes the project's purpose, technology stack, layout, conventions, and how to build/test/deploy it.

## Project overview

**Energy Insights Hub** is a single-page React application that helps users discover energy-industry news and generate a newsletter-style executive summary.

Key features:

- Filterable insight feed (focus areas, regions, time ranges, free-text search).
- "Cart" for selecting insights and generating a synthesized newsletter via an LLM.
- Bookmarking, dark mode, and English/Chinese language switching.
- Client-side persistence of settings, bookmarks, cart, and API keys in `localStorage`.
- Direct browser calls to LLM providers (OpenAI-compatible, Anthropic, SiliconFlow) and optional search providers (Tavily, Serper).
- PDF export of the generated newsletter, rendered with `html2canvas` + `jsPDF` loaded from a CDN at runtime.

There is **no backend server** in this repo; the app runs entirely in the browser and calls third-party APIs directly.

## Technology stack

- **Framework / UI library:** React 18 (`react`, `react-dom`)
- **Build tool:** Vite 5 with the `@vitejs/plugin-react` plugin
- **Language:** JavaScript (ES modules), JSX
- **Styling:** Inline styles + a small global CSS file (`src/index.css`, `src/styles/responsive.css`)
- **State management:** React hooks (`useState`, `useEffect`, `useCallback`, `useRef`)
- **Persistence:** Browser `localStorage` via `src/utils/storage.js`
- **External runtime dependencies:** `html2canvas` and `jspdf` are fetched from CDN when PDF export is used
- **Linting:** ESLint 8 with `eslint:recommended`, `plugin:react/recommended`, `plugin:react/jsx-runtime`, `plugin:react-hooks/recommended`, and `plugin:react-refresh`

## Build and run commands

Commands are defined in `package.json`:

```bash
# Install dependencies
npm install

# Start the Vite dev server (defaults to port 5176, strictPort: true)
npm run dev

# Production build; output goes to ./dist
npm run build

# Preview the production build locally
npm run preview

# Lint all .js and .jsx files
npm run lint
```

The dev server is configured in `vite.config.js` to run on port `5176`.

## Project structure

```text
.
├── index.html                 # SPA entry point
├── package.json               # Dependencies and scripts
├── vite.config.js             # Vite configuration (React plugin, port 5176)
├── .eslintrc.cjs              # ESLint rules
├── dist/                      # Production build output (pre-built)
└── src/
    ├── App.jsx                # Main application shell, state, and feed UI
    ├── main.jsx               # Mounts <App /> inside <ErrorBoundary> with StrictMode
    ├── index.css              # Global CSS / reset
    ├── styles/
    │   └── responsive.css     # Breakpoints, touch/print/reduced-motion styles
    ├── components/
    │   ├── ApiConfig.jsx      # Modal for configuring LLM + search API keys
    │   ├── InsightsGenerator.jsx   # Newsletter viewer, language switcher, PDF export
    │   ├── ErrorBoundary.jsx  # Class component error boundary
    │   ├── Toast.jsx          # Toast notifications and ToastContainer
    │   ├── SearchConfig.jsx   # Standalone search config modal (currently unused by App.jsx)
    │   ├── InsightCard.jsx    # Reusable insight card (currently unused; App.jsx defines its own)
    │   └── Chip.jsx           # Reusable filter chip (currently unused; App.jsx defines its own)
    ├── constants/
    │   ├── theme.js           # Colors, spacing, font sizes, border radius, transitions
    │   └── i18n.js            # English/Chinese copy, focus areas, regions, time ranges
    └── utils/
        ├── api.js             # LLM and search API calls, prompt construction
        └── storage.js         # localStorage helpers for config/bookmarks/cart/preferences
```

Notes on current organization:

- `App.jsx` currently defines its own inline `Chip` and `InsightCard` components rather than importing the standalone files in `src/components/`.
- `SearchConfig.jsx` is present but not imported by `App.jsx`; the search UI lives inside `ApiConfig.jsx`.
- `InsightsGenerator.jsx` renders newsletter markdown as HTML using `dangerouslySetInnerHTML` after escaping; it also dynamically injects CDN scripts for PDF export.

## Runtime architecture

1. `index.html` loads `src/main.jsx` as an ES module.
2. `main.jsx` creates a React root, wraps `<App />` in `<ErrorBoundary>` and `<React.StrictMode>`.
3. `App.jsx` holds most global state (filters, feed results, cart, bookmarks, UI preferences, toasts).
4. On mount, preferences and saved data are loaded from `localStorage` via `src/utils/storage.js`.
5. Fetching insights (`src/utils/api.js#fetchInsights`) builds a prompt and calls the configured LLM endpoint directly from the browser.
6. If a search API key is configured and a free-text query is present, the app calls Tavily or Serper and includes the results in the LLM prompt.
7. The LLM is expected to return a JSON array of insight objects; the app parses, validates, and assigns IDs.
8. Generating a newsletter (`api.js#generateNewsletter`) sends the cart items to the LLM and appends a reliable source list derived from the cart data.
9. `InsightsGenerator.jsx` renders the markdown response, allows language switching, and can generate a multi-page PDF.

## Code style and conventions

- **File extensions:** React components use `.jsx`; utilities/constants use `.js`.
- **Modules:** ES modules (`import`/`export`) throughout; `package.json` sets `"type": "module"`.
- **Component style:** Functional components with hooks. One class component (`ErrorBoundary`) for error catching.
- **Naming:**
  - Components: `PascalCase` (e.g., `InsightsGenerator`)
  - Utilities/constants: `camelCase` or `UPPER_SNAKE_CASE` for constant collections (e.g., `COLORS`, `TIME_RANGE_KEYS`)
  - Prefix unused variables with `_` to satisfy ESLint's `no-unused-vars` rule
- **Styling pattern:** Inline `style` objects referencing `src/constants/theme.js` (`COLORS`, `FONT_SIZES`, `BORDER_RADIUS`, `TRANSITIONS`). Global responsive/print/accessibility rules live in `src/styles/responsive.css`.
- **i18n pattern:** All user-facing strings live in `src/constants/i18n.js` under `i18n.en` and `i18n.zh`. Component code accesses them through `const t = i18n[language]`.
- **Comments:** Mixed English and Chinese; many UI labels and user messages are in Chinese for the Chinese locale.

## ESLint configuration

`.eslintrc.cjs` key settings:

- Extends recommended React, React Hooks, and React Refresh rules.
- `react/prop-types` is turned off (the project does not use PropTypes).
- `react-refresh/only-export-components` warns, with `allowConstantExport: true`.
- `no-unused-vars` is a warning and ignores identifiers prefixed with `_`.
- `dist` and `.eslintrc.cjs` are ignored.

## Testing instructions

There is **no test framework** installed in this project (no Jest, Vitest, Cypress, etc.).

Recommended verification steps:

1. `npm run lint` — checks JavaScript/JSX style and React hook dependencies.
2. `npm run build` — confirms the Vite production bundle compiles.
3. Manual browser testing:
   - Configure an LLM API key via the "API Config" button.
   - Optionally configure a search API key.
   - Select filters, click "Get Energy Insights", select cards, and generate a newsletter.
   - Test dark mode, language toggle, bookmarking, and PDF export.

> As of the latest check, `npm run lint` reports one ESLint error (`no-useless-escape` in `src/components/InsightsGenerator.jsx`) and one React Hooks dependency warning (`react-hooks/exhaustive-deps` in `src/App.jsx`). `npm run build` succeeds.

## Backend runtime requirements

The project includes an Express/SQLite backend under `server/`. For Excel configuration uploads (`Key Config.xlsx` via `/api/tracker/import-config` or `/api/sources/import`), `server/lib/configParser.js` shells out to `python3` with the `pandas` package. Ensure both are available in the deployment environment. JSON config uploads do not require Python.

## Deployment

This is a static SPA.

1. Run `npm run build`.
2. Serve the contents of the generated `./dist` folder from any static host (e.g., Nginx, Vercel, Netlify, GitHub Pages, S3).
3. Configure the host to serve `index.html` for all unmatched routes (SPA fallback).

`dist/` is already present in the repo as a pre-built artifact, but it should be regenerated after source changes.

## Security considerations

Because this app has no backend, several security points are worth keeping in mind:

- **API keys are stored in `localStorage`.** Any XSS vulnerability could leak LLM and search API keys. Avoid adding untrusted scripts or rendering unsanitized user input.
- **Direct browser API calls.** Keys are sent directly from the browser to third-party providers. This exposes keys to users and relies on the providers' CORS policies.
- **Anthropic direct-browser header.** `src/utils/api.js` sends `anthropic-dangerous-direct-browser-access: true` so Anthropic can be called from the browser.
- **Dynamic CDN script injection.** `InsightsGenerator.jsx` loads `html2canvas` and `jspdf` from `cdnjs.cloudflare.com` at runtime. A CSP or CDN compromise could affect PDF generation.
- **`dangerouslySetInnerHTML`.** Newsletter content is escaped via `escapeHtml()` before rendering, but any change to that path risks XSS.
- **URL validation.** `api.js` strips non-HTTP URLs from parsed LLM responses, but the LLM may still produce inaccurate or fabricated URLs.

Do not commit real API keys to the repository.

## External service endpoints

Configured in code:

- LLM providers: OpenAI (`https://api.openai.com/v1`), Anthropic (`https://api.anthropic.com/v1`), SiliconFlow (`https://api.siliconflow.cn/v1`)
- Search providers: Tavily (`https://api.tavily.com/search`), Serper (`https://google.serper.dev/search`)
- PDF libraries: `https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js` and `https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js`
