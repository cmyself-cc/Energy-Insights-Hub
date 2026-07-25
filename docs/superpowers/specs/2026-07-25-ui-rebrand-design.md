# UI Rebrand Design — 混沌能源智库 Energy Insight Hub

Date: 2026-07-25
Scope: Header, sidebar, and page labels

## Goal

Rebrand the web UI from "Energy Insights Hub / 竞争情报" to "混沌能源智库 — Energy Insight Hub / 市场洞察 (Market Intelligence)", and simplify the top-right navigation.

## Changes

### 1. Header (`src/components/Header.jsx`)

- Replace the ⚡ emoji logo with the image at `/Users/cmyself/Documents/IMG_0568 2.jpg`.
  - Copy the image into `public/logo.jpg` so Vite can serve it.
  - Display it as a 28×28 px rounded square in the header.
- Change site title to: `混沌能源智库 — Energy Insight Hub`.
- Remove the "active site" indicator (the green-dot pill showing "Competitive Intelligence").
- Remove the **API Config** button from the top-right.
- Keep the language toggle button and the user icon circle.

### 2. Sidebar (`src/components/Sidebar.jsx`)

- Change footer text from `Energy Insights Hub` to `混沌能源智库`.
- Change the first navigation item label from "竞争情报" / "Competitive Intelligence" to "市场洞察" / "Market Intelligence".

### 3. Internationalization (`src/constants/i18n.js`)

Update `competitiveIntelligence` keys (keep the key name, only change values):

| Key | Old (zh) | New (zh) | Old (en) | New (en) |
|---|---|---|---|---|
| `pageTitle` | 竞争情报 | 市场洞察 | Competitive Intelligence | Market Intelligence |
| `sidebarTitle` | 竞争情报 | 市场洞察 | Competitive Intelligence | Market Intelligence |
| `cockpitTitle` | 管理驾驶舱 | 管理驾驶舱 | Management Cockpit | Management Cockpit |
| `moduleName` | 洞察 | 洞察 | Insights | Insights |

### 4. App wiring (`src/App.jsx`)

- Remove the `onApiConfig` prop passed to `<Header />` since the API Config button is removed.
- The page title is already read from `t.competitiveIntelligence.pageTitle`, so no extra change is needed beyond the i18n update.

## Out of Scope

- No changes to tracker, backend, filters, or insight cards.
- No behavior changes to language switching, dark mode, or user icon.
- No rename of the `competitiveIntelligence` i18n object key (to keep the diff small).

## Files to Modify

1. `public/logo.jpg` — new asset (copied from `/Users/cmyself/Documents/IMG_0568 2.jpg`)
2. `src/components/Header.jsx`
3. `src/components/Sidebar.jsx`
4. `src/constants/i18n.js`
5. `src/App.jsx`

## Acceptance Criteria

- [ ] Header shows the new logo image and site title.
- [ ] Top-right only has language toggle and user icon; API Config button is gone.
- [ ] Sidebar first item reads "市场洞察" / "Market Intelligence".
- [ ] Main page title reads "市场洞察" / "Market Intelligence".
- [ ] No console errors or broken references after changes.
