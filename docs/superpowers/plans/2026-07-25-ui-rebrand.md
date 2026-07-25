# UI Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebrand the web UI to "混沌能源智库 — Energy Insight Hub" and rename "竞争情报" to "市场洞察 (Market Intelligence)", while simplifying the header navigation.

**Architecture:** Keep the existing React component structure. Only update labels, remove the API Config button and active-site indicator from Header, swap the emoji logo for an image asset, and update i18n strings.

**Tech Stack:** React, Vite, inline CSS-in-JS.

## Global Constraints

- Site title: `混沌能源智库 — Energy Insight Hub`
- Logo source file: `/Users/cmyself/Documents/IMG_0568 2.jpg`
- Keep language switch and user icon in header; remove everything else from the top-right.
- Rename "竞争情报" / "Competitive Intelligence" to "市场洞察" / "Market Intelligence" in all visible UI labels.
- Do not rename the `competitiveIntelligence` i18n object key.

---

### Task 1: Add logo asset

**Files:**
- Create: `public/logo.jpg`

**Interfaces:**
- Produces: `public/logo.jpg` served by Vite at `/logo.jpg`

- [ ] **Step 1: Copy logo file**

```bash
cp "/Users/cmyself/Documents/IMG_0568 2.jpg" "/Users/cmyself/Live Projects/Energy Insights Hub/public/logo.jpg"
```

- [ ] **Step 2: Verify file exists**

```bash
ls -la "/Users/cmyself/Live Projects/Energy Insights Hub/public/logo.jpg"
```

Expected: file exists with non-zero size.

---

### Task 2: Update Header component

**Files:**
- Modify: `src/components/Header.jsx`

**Interfaces:**
- Consumes: `language`, `darkMode`, `onLanguageToggle` props
- Produces: header with logo image, new title, no active-site pill, no API Config button

- [ ] **Step 1: Replace emoji logo with image and update title**

In `src/components/Header.jsx`, replace the emoji `<div>` and the title spans with:

```jsx
<img
  src="/logo.jpg"
  alt="logo"
  style={{
    width: 28,
    height: 28,
    borderRadius: 6,
    objectFit: "cover"
  }}
/>
<span>混沌能源智库 — Energy Insight Hub</span>
```

- [ ] **Step 2: Remove active-site indicator**

Delete the `<div>` immediately following the title that renders `t.competitiveIntelligence.moduleName` with the left border.

- [ ] **Step 3: Remove API Config button**

Delete the `<button onClick={onApiConfig}>` block.

- [ ] **Step 4: Remove unused prop**

Remove `onApiConfig` and `activeSite` from the function signature so it becomes:

```jsx
export default function Header({ darkMode, language, onLanguageToggle }) {
```

---

### Task 3: Update Sidebar component

**Files:**
- Modify: `src/components/Sidebar.jsx`

**Interfaces:**
- Consumes: `t.competitiveIntelligence.sidebarTitle`
- Produces: sidebar first item labeled "市场洞察" / "Market Intelligence", footer reads "混沌能源智库"

- [ ] **Step 1: Change footer text**

In `src/components/Sidebar.jsx`, change `Energy Insights Hub` to `混沌能源智库`.

- [ ] **Step 2: Verify label comes from i18n**

No code change needed here; the label is read from `t.competitiveIntelligence.sidebarTitle`, which will be updated in Task 4.

---

### Task 4: Update i18n labels

**Files:**
- Modify: `src/constants/i18n.js`

**Interfaces:**
- Produces: updated `competitiveIntelligence` strings

- [ ] **Step 1: Update English strings**

In the `en` section, under `competitiveIntelligence`:

```js
pageTitle: "Market Intelligence",
sidebarTitle: "Market Intelligence",
```

- [ ] **Step 2: Update Chinese strings**

In the `zh` section, under `competitiveIntelligence`:

```js
pageTitle: "市场洞察",
sidebarTitle: "市场洞察",
```

---

### Task 5: Update App.jsx wiring

**Files:**
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: updated `Header` signature
- Produces: `<Header />` call without `onApiConfig`

- [ ] **Step 1: Remove onApiConfig prop**

Change the `<Header />` JSX call to:

```jsx
<Header
  darkMode={darkMode}
  language={language}
  onLanguageToggle={handleLanguageToggle}
/>
```

Note: `showApiConfig` state and `<ApiConfig />` modal can remain in App because the configuration page still needs it; only the header shortcut is removed.

---

### Task 6: Verify in browser

- [ ] **Step 1: Ensure dev server is running**

Visit `http://localhost:5177`.

- [ ] **Step 2: Visual checks**

- Header shows logo image + "混沌能源智库 — Energy Insight Hub"
- Top-right only shows language toggle and user icon
- Sidebar first item reads "市场洞察" (zh) or "Market Intelligence" (en)
- Main page title reads "市场洞察" / "Market Intelligence"
- No console errors

---

## Spec Coverage

- Header logo and title: Task 2
- Remove active-site indicator and API Config: Task 2
- Sidebar footer and nav label: Tasks 3 + 4
- Page title rename: Task 4
- App wiring cleanup: Task 5
