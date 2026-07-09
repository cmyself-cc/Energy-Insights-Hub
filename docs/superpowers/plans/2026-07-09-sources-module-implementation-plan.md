# Sources 模块重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将数据来源拆分为 RSS / 网站 / 微信公众号三类独立 crawler，并把 `sources.md` 接入配置，实现启动自动导入与配置页手动导入。

**Architecture:** 新增 `server/crawlers/` 目录，每个 crawler 实现统一 `fetchArticles(source)` 接口；`sourceRegistry` 按 `source.type` 调度。`sources.md` 由 `server/lib/sourcesMdLoader.js` 解析后写入 `sources` 表。前端 `SourcesPage` 增加类型化表单与导入按钮。

**Tech Stack:** Node.js 22, Express, better-sqlite3, cheerio, rss-parser, React 18, Vite 5

## Global Constraints

- 不引入 Python 或外部 WeChat API 服务。
- 不修改 `sources` 表 schema，通过 `type` + `config` JSON 区分来源类型。
- 每类 crawler 必须返回统一结构：`{ title, summary, url, publishDate, rawContent }`。
- 单篇文章失败不得影响同来源其他文章。
- 反爬失败必须记录到 `tracker_runs.message`。

---

### Task 1: Crawler Registry & Shared Utilities

**Files:**
- Create: `server/crawlers/index.js`

**Interfaces:**
- Consumes: nothing
- Produces: `registerCrawler(type, crawler)`, `fetchArticles(source)`, `sleep(ms)`, `fetchWithTimeout(url, options, timeout)`, `resolveUrl(base, relative)`

- [ ] **Step 1: Write the registry**

Create `server/crawlers/index.js`:

```js
const registry = new Map();

export function registerCrawler(type, crawler) {
  registry.set(type, crawler);
}

export async function fetchArticles(source) {
  const crawler = registry.get(source.type);
  if (!crawler) {
    throw new Error(`No crawler registered for type: ${source.type}`);
  }
  return crawler.fetchArticles(source);
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

export function resolveUrl(base, relative) {
  if (!relative) return "";
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

const DESKTOP_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
];

export function randomUserAgent() {
  return DESKTOP_AGENTS[Math.floor(Math.random() * DESKTOP_AGENTS.length)];
}
```

- [ ] **Step 2: Verify syntax**

Run:

```bash
node --check server/crawlers/index.js
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add server/crawlers/index.js
git commit -m "feat(crawler): add registry and shared utilities"
```

---

### Task 2: RSS Crawler

**Files:**
- Create: `server/crawlers/rssCrawler.js`
- Delete: `server/services/rssFetcher.js` (after tracker migration in Task 8)

**Interfaces:**
- Consumes: `fetchWithTimeout` from `server/crawlers/index.js`
- Produces: `fetchArticles(source)` returning `Promise<Article[]>`

- [ ] **Step 1: Implement RSS crawler**

Create `server/crawlers/rssCrawler.js`:

```js
import Parser from "rss-parser";
import { registerCrawler } from "./index.js";

const parser = new Parser({
  timeout: 20000,
  headers: { "User-Agent": "EnergyInsightsHub/1.0" }
});

async function fetchArticles(source) {
  const config = source.config || {};
  const limit = config.articleLimit || 20;
  const feed = await parser.parseURL(source.url);
  return (feed.items || []).slice(0, limit).map(item => ({
    title: item.title || "",
    summary: item.contentSnippet || item.content || "",
    url: item.link || "",
    publishDate: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
    rawContent: item["content:encoded"] || item.content || ""
  }));
}

registerCrawler("rss", { fetchArticles });
```

- [ ] **Step 2: Verify with a real RSS feed**

Create a temporary script `tmp/test-rss.js`:

```js
import { fetchArticles } from "../server/crawlers/rssCrawler.js";

fetchArticles({
  type: "rss",
  url: "https://www.pv-magazine.com/feed/",
  config: { articleLimit: 2 }
}).then(items => {
  console.log("count:", items.length);
  console.log(items[0]);
}).catch(console.error);
```

Run:

```bash
node tmp/test-rss.js
```

Expected: prints 2 articles with title/url.

- [ ] **Step 3: Clean up temp file and commit**

```bash
rm tmp/test-rss.js
git add server/crawlers/rssCrawler.js
git commit -m "feat(crawler): add RSS crawler"
```

---

### Task 3: Website Crawler

**Files:**
- Create: `server/crawlers/websiteCrawler.js`
- Create: `server/crawlers/__fixtures__/news-site.html`
- Create: `server/crawlers/websiteCrawler.test.js`
- Delete: `server/services/scraper.js` (after tracker migration in Task 8)

**Interfaces:**
- Consumes: `fetchWithTimeout`, `resolveUrl`, `sleep`, `randomUserAgent` from `server/crawlers/index.js`
- Produces: `fetchArticles(source)` returning `Promise<Article[]>`

- [ ] **Step 1: Create fixture HTML**

Create `server/crawlers/__fixtures__/news-site.html`:

```html
<!doctype html>
<html>
<head><title>Energy News</title></head>
<body>
  <main>
    <article>
      <h2><a href="/article/solar-boom">Solar Boom Continues</a></h2>
      <p>New solar installations hit record highs.</p>
    </article>
    <article>
      <h2><a href="/article/oil-prices">Oil Prices Stable</a></h2>
      <p>Crude oil remains steady amid supply concerns.</p>
    </article>
  </main>
</body>
</html>
```

Create fixture article page `server/crawlers/__fixtures__/article-solar-boom.html`:

```html
<!doctype html>
<html>
<head><title>Solar Boom Continues</title></head>
<body>
  <article>
    <h1>Solar Boom Continues</h1>
    <p>New solar installations hit record highs across the globe.</p>
  </article>
</body>
</html>
```

- [ ] **Step 2: Write failing test**

Create `server/crawlers/websiteCrawler.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert";
import { extractArticleLinks } from "./websiteCrawler.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const html = fs.readFileSync(path.join(__dirname, "__fixtures__/news-site.html"), "utf-8");

describe("extractArticleLinks", () => {
  it("extracts relative article links", () => {
    const links = extractArticleLinks(html, "https://example.com", 10);
    assert.strictEqual(links.length, 2);
    assert.strictEqual(links[0].url, "https://example.com/article/solar-boom");
    assert.strictEqual(links[0].title, "Solar Boom Continues");
  });
});
```

Run:

```bash
node --test server/crawlers/websiteCrawler.test.js
```

Expected: FAIL — `extractArticleLinks` not found.

- [ ] **Step 3: Implement website crawler**

Create `server/crawlers/websiteCrawler.js`:

```js
import * as cheerio from "cheerio";
import { registerCrawler, fetchWithTimeout, resolveUrl, sleep, randomUserAgent } from "./index.js";

const DEFAULT_LIST_SELECTORS = [
  "article h2 a",
  "article h3 a",
  ".post-title a",
  ".entry-title a",
  ".news-list a",
  ".list-item a"
];

const DEFAULT_DETAIL_SELECTORS = {
  title: "h1, .article-title, .post-title, title",
  content: "article, .article, .post-content, .entry-content, main"
};

export function extractArticleLinks(html, baseUrl, limit = 10) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const results = [];

  for (const selector of DEFAULT_LIST_SELECTORS) {
    $(selector).each((_i, el) => {
      if (results.length >= limit) return false;
      const $el = $(el);
      const href = $el.attr("href");
      const title = $el.text().trim();
      const url = resolveUrl(baseUrl, href);
      if (!url || !title || seen.has(url)) return;
      seen.add(url);
      results.push({ url, title });
    });
  }

  return results;
}

async function fetchArticlePage(url, selectors = {}) {
  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": randomUserAgent() }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const title = $(selectors.title || DEFAULT_DETAIL_SELECTORS.title).first().text().trim();
  const content = $(selectors.content || DEFAULT_DETAIL_SELECTORS.content).first().text().trim();
  return {
    title,
    summary: content.slice(0, 500),
    url,
    publishDate: new Date().toISOString(),
    rawContent: content.slice(0, 5000)
  };
}

async function fetchArticles(source) {
  const config = source.config || {};
  const limit = config.articleLimit || 5;
  const selectors = config.selectors || {};

  const res = await fetchWithTimeout(source.url, {
    headers: { "User-Agent": randomUserAgent() }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const links = extractArticleLinks(html, source.url, limit);

  const articles = [];
  for (const link of links) {
    try {
      const article = await fetchArticlePage(link.url, selectors);
      if (!article.title) article.title = link.title;
      articles.push(article);
      await sleep(500);
    } catch (e) {
      console.error(`[website] Failed to fetch ${link.url}:`, e.message);
    }
  }

  return articles;
}

registerCrawler("website", { fetchArticles });
```

- [ ] **Step 4: Run test**

```bash
node --test server/crawlers/websiteCrawler.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/crawlers/websiteCrawler.js server/crawlers/websiteCrawler.test.js server/crawlers/__fixtures__
git commit -m "feat(crawler): add website crawler with tests"
```

---

### Task 4: WeChat Crawler

**Files:**
- Create: `server/crawlers/wechatCrawler.js`

**Interfaces:**
- Consumes: `fetchWithTimeout`, `sleep`, `randomUserAgent` from `server/crawlers/index.js`
- Produces: `fetchArticles(source)` returning `Promise<Article[]>`

- [ ] **Step 1: Implement WeChat crawler**

Create `server/crawlers/wechatCrawler.js`:

```js
import * as cheerio from "cheerio";
import { registerCrawler, fetchWithTimeout, sleep, randomUserAgent } from "./index.js";

function buildSearchUrl(accountName) {
  return `https://weixin.sogou.com/weixin?type=1&query=${encodeURIComponent(accountName)}&ie=utf8`;
}

export function parseArticleList(html) {
  const $ = cheerio.load(html);
  const articles = [];

  $("li[id^='sogou_vr_']").each((_i, el) => {
    const $el = $(el);
    const titleEl = $el.find(".txt-box h3 a").first();
    const title = titleEl.text().trim();
    const href = titleEl.attr("href");
    const summary = $el.find(".txt-box p").first().text().trim();
    const timeText = $el.find(".s-p").attr("t") || "";
    const publishDate = timeText ? new Date(parseInt(timeText, 10) * 1000).toISOString() : new Date().toISOString();

    if (title && href) {
      articles.push({ title, summary, url: href, publishDate, rawContent: summary });
    }
  });

  return articles;
}

async function fetchArticles(source) {
  const config = source.config || {};
  const accountName = config.accountName || source.name;
  const limit = config.articleLimit || 3;
  const lookbackHours = config.lookbackHours || 24;

  const searchUrl = buildSearchUrl(accountName);
  const res = await fetchWithTimeout(searchUrl, {
    headers: { "User-Agent": randomUserAgent(), "Referer": "https://weixin.sogou.com/" }
  });
  if (!res.ok) throw new Error(`Sogou search failed: HTTP ${res.status}`);

  const html = await res.text();
  let articles = parseArticleList(html).slice(0, limit);

  const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;
  articles = articles.filter(a => new Date(a.publishDate).getTime() >= cutoff);

  await sleep(500);
  return articles;
}

registerCrawler("wechat", { fetchArticles });
```

- [ ] **Step 2: Add a smoke test script**

Create `tmp/test-wechat.js`:

```js
import { fetchArticles } from "../server/crawlers/wechatCrawler.js";

fetchArticles({
  type: "wechat",
  name: "光伏们",
  config: { articleLimit: 2 }
}).then(items => {
  console.log("count:", items.length);
  console.log(items[0]);
}).catch(console.error);
```

Run:

```bash
node tmp/test-wechat.js
```

Expected: either returns articles or logs an anti-bot error. If anti-bot, note it in commit message.

- [ ] **Step 3: Clean up temp file and commit**

```bash
rm tmp/test-wechat.js
git add server/crawlers/wechatCrawler.js
git commit -m "feat(crawler): add WeChat crawler via Sogou search"
```

---

### Task 5: sources.md Parser

**Files:**
- Create: `server/lib/sourcesMdLoader.js`
- Create: `server/lib/sourcesMdLoader.test.js`

**Interfaces:**
- Consumes: `fs`, project root `sources.md`
- Produces: `parseMarkdown(md): SourceDraft[]`, `loadSourcesFromMd(): SourceDraft[]`, where `SourceDraft = { name, url, type, active, config }`

- [ ] **Step 1: Create fixture and failing test**

Create `server/lib/sourcesMdLoader.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert";
import { parseMarkdown } from "./sourcesMdLoader.js";

const sample = `
## 官方网站/定向网站（可直接抓取）
- https://www.iea.org - 国际能源署
- https://oilprice.com - OilPrice

## 微信公众号（需人工监测/参考标题）
- 光伏们
- 高工锂电
`;

describe("parseMarkdown", () => {
  it("parses website and wechat sources", () => {
    const sources = parseMarkdown(sample);
    assert.strictEqual(sources.length, 4);
    assert.deepStrictEqual(sources[0], {
      name: "国际能源署",
      url: "https://www.iea.org",
      type: "website",
      active: 1,
      config: JSON.stringify({})
    });
    assert.deepStrictEqual(sources[2], {
      name: "光伏们",
      url: "",
      type: "wechat",
      active: 1,
      config: JSON.stringify({ accountName: "光伏们" })
    });
  });
});
```

Run:

```bash
node --test server/lib/sourcesMdLoader.test.js
```

Expected: FAIL — `parseMarkdown` not found.

- [ ] **Step 2: Implement parser**

Create `server/lib/sourcesMdLoader.js`:

```js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_MD_PATH = process.env.SOURCES_MD_PATH || path.join(__dirname, "..", "..", "sources.md");

export function parseMarkdown(md) {
  const sources = [];
  const lines = md.split(/\r?\n/);
  let currentType = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("## ")) {
      if (line.includes("官方网站") || line.includes("网站")) {
        currentType = "website";
      } else if (line.includes("微信") || line.includes("公众号")) {
        currentType = "wechat";
      } else {
        currentType = null;
      }
      continue;
    }

    if (!currentType || !line.startsWith("- ")) continue;

    const content = line.slice(2).trim();

    if (currentType === "website") {
      const match = content.match(/^(https?:\/\/\S+)\s*[-–—]\s*(.+)$/);
      if (match) {
        sources.push({
          name: match[2].trim(),
          url: match[1].trim(),
          type: "website",
          active: 1,
          config: JSON.stringify({})
        });
      }
    } else if (currentType === "wechat") {
      const name = content.replace(/^[-\s]+/, "").trim();
      if (name) {
        sources.push({
          name,
          url: "",
          type: "wechat",
          active: 1,
          config: JSON.stringify({ accountName: name })
        });
      }
    }
  }

  return sources;
}

export function loadSourcesFromMd() {
  if (!fs.existsSync(SOURCES_MD_PATH)) {
    console.warn(`[sources-md] File not found: ${SOURCES_MD_PATH}`);
    return [];
  }
  const md = fs.readFileSync(SOURCES_MD_PATH, "utf-8");
  return parseMarkdown(md);
}
```

- [ ] **Step 3: Run test**

```bash
node --test server/lib/sourcesMdLoader.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/lib/sourcesMdLoader.js server/lib/sourcesMdLoader.test.js
git commit -m "feat(sources): parse sources.md into source drafts"
```

---

### Task 6: Sources API Updates

**Files:**
- Modify: `server/routes/sources.js`

**Interfaces:**
- Consumes: `sourcesMdLoader.loadSourcesFromMd`, `db`
- Produces: `POST /api/sources/import-md` returning `{ inserted, existed, failed }`

- [ ] **Step 1: Add import-md endpoint and type validation**

Modify `server/routes/sources.js`:

- Add import at top:

```js
import { loadSourcesFromMd } from "../lib/sourcesMdLoader.js";
```

- Add allowed types constant:

```js
const ALLOWED_TYPES = ["rss", "website", "wechat", "api"];
```

- In `POST /`, validate `type`:

```js
if (!ALLOWED_TYPES.includes(type)) {
  return res.status(400).json({ error: `type must be one of ${ALLOWED_TYPES.join(", ")}` });
}
```

- Add new route:

```js
router.post("/import-md", (_req, res) => {
  try {
    const drafts = loadSourcesFromMd();
    let inserted = 0;
    let existed = 0;
    const failed = [];

    const insert = db.prepare(
      "INSERT OR IGNORE INTO sources (name, url, type, active, config) VALUES (?, ?, ?, ?, ?)"
    );

    for (const draft of drafts) {
      try {
        const result = insert.run(draft.name, draft.url, draft.type, draft.active, draft.config);
        if (result.changes > 0) inserted++;
        else existed++;
      } catch (e) {
        failed.push({ name: draft.name, reason: e.message });
      }
    }

    res.json({ data: { inserted, existed, failed } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 2: Test the endpoint**

Run dev stack:

```bash
npm run dev:server
```

In another shell:

```bash
curl -s -X POST http://localhost:3003/api/sources/import-md | python3 -m json.tool
```

Expected: returns counts like `{ inserted: 90, existed: 0, failed: [] }`.

- [ ] **Step 3: Commit**

```bash
git add server/routes/sources.js
git commit -m "feat(api): add sources.md import endpoint and validate source types"
```

---

### Task 7: Startup Auto-Import of sources.md

**Files:**
- Modify: `server/index.js`
- Modify: `server/migrations/002_seed_sources.js`

**Interfaces:**
- Consumes: `loadSourcesFromMd`
- Produces: database records on startup

- [ ] **Step 1: Replace default seed sources with sources.md import**

Modify `server/migrations/002_seed_sources.js` to:

```js
import db from "../db.js";
import { loadSourcesFromMd } from "../lib/sourcesMdLoader.js";

export function seedSources() {
  const existing = db.prepare("SELECT COUNT(*) as count FROM sources").get();
  if (existing.count > 0) return;

  const drafts = loadSourcesFromMd();
  if (drafts.length === 0) {
    console.log("[seed] No sources found in sources.md");
    return;
  }

  const insert = db.prepare(
    "INSERT INTO sources (name, url, type, active, config) VALUES (?, ?, ?, ?, ?)"
  );
  const insertMany = db.transaction((sources) => {
    for (const s of sources) insert.run(s.name, s.url, s.type, s.active, s.config);
  });
  insertMany(drafts);
  console.log(`[seed] Inserted ${drafts.length} sources from sources.md`);
}

export default seedSources;
```

- [ ] **Step 2: Verify startup import**

Stop and restart the server:

```bash
npm run dev:server
```

Expected log: `[seed] Inserted N sources from sources.md`.

Check DB:

```bash
curl -s http://localhost:3003/api/sources | python3 -m json.tool | head -40
```

Expected: list includes website and wechat sources.

- [ ] **Step 3: Commit**

```bash
git add server/migrations/002_seed_sources.js
git commit -m "feat(seed): import sources.md on startup instead of hardcoded RSS urls"
```

---

### Task 8: Refactor Tracker to Use Crawler Registry

**Files:**
- Modify: `server/services/tracker.js`
- Delete: `server/services/rssFetcher.js`
- Delete: `server/services/scraper.js`

**Interfaces:**
- Consumes: `fetchArticles` from `server/crawlers/index.js`
- Produces: same tracker behavior, now type-agnostic

- [ ] **Step 1: Update tracker imports and dispatch**

Modify `server/services/tracker.js`:

- Replace:

```js
import { fetchRss } from "./rssFetcher.js";
import { fetchScrape } from "./scraper.js";
```

with:

```js
import { fetchArticles } from "../crawlers/index.js";
```

- Replace `fetchSourceItems(source)` switch with:

```js
async function fetchSourceItems(source) {
  return fetchArticles(source);
}
```

- [ ] **Step 2: Remove obsolete fetcher files**

```bash
rm server/services/rssFetcher.js server/services/scraper.js
```

- [ ] **Step 3: Run tracker end-to-end**

Start dev stack and trigger tracker:

```bash
curl -s -X POST http://localhost:3003/api/tracker/run | python3 -m json.tool
```

Poll until completed. Expect RSS/website sources to succeed or fail with clear messages; wechat sources may fail due to anti-bot.

- [ ] **Step 4: Commit**

```bash
git add server/services/tracker.js
git rm server/services/rssFetcher.js server/services/scraper.js
git commit -m "refactor(tracker): dispatch sources through crawler registry"
```

---

### Task 9: Frontend API Client Update

**Files:**
- Modify: `src/utils/backendApi.js`

**Interfaces:**
- Produces: `backendApi.importSourcesMd()`

- [ ] **Step 1: Add import method**

Add to `backendApi` object:

```js
importSourcesMd: () => request("/sources/import-md", { method: "POST" }),
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/backendApi.js
git commit -m "feat(api-client): add importSourcesMd method"
```

---

### Task 10: Update SourcesPage UI

**Files:**
- Modify: `src/components/SourcesPage.jsx`

**Interfaces:**
- Consumes: `backendApi.importSourcesMd`
- Produces: type-aware add-source form + import button

- [ ] **Step 1: Add type-aware form fields**

Changes in `SourcesPage.jsx`:

- Update initial form state:

```js
const [form, setForm] = useState({ name: "", url: "", type: "rss", active: true, accountName: "" });
```

- Update `saveSource` to build config:

```js
const saveSource = async (e) => {
  e.preventDefault();
  if (!form.name) return;
  if (form.type === "website" && !form.url) return;

  const payload = {
    name: form.name,
    url: form.type === "wechat" ? "" : form.url,
    type: form.type,
    active: form.active,
    config: form.type === "wechat" ? { accountName: form.accountName || form.name } : {}
  };

  try {
    await backendApi.createSource(payload);
    setForm({ name: "", url: "", type: "rss", active: true, accountName: "" });
    loadSources();
    setMessage({ type: "success", text: language === "zh" ? "来源已添加" : "Source added" });
  } catch (err) {
    setMessage({ type: "error", text: err.message });
  }
};
```

- Render conditional fields after type select:

```jsx
{form.type === "wechat" && (
  <input
    type="text"
    value={form.accountName}
    onChange={(e) => setForm({ ...form, accountName: e.target.value })}
    placeholder={language === "zh" ? "公众号名称" : "WeChat account name"}
    style={{ ...inputStyle, minWidth: 180 }}
  />
)}
```

- Update type select options:

```jsx
<select value={form.type} onChange={...}>
  <option value="rss">RSS</option>
  <option value="website">Website</option>
  <option value="wechat">WeChat</option>
</select>
```

- [ ] **Step 2: Add import-md button and handler**

Add after the run tracker button:

```jsx
<button
  onClick={importFromMd}
  disabled={loading}
  style={{...}}
>
  {language === "zh" ? "从 sources.md 导入" : "Import from sources.md"}
</button>
```

Add handler:

```js
const importFromMd = async () => {
  setLoading(true);
  try {
    const res = await backendApi.importSourcesMd();
    const { inserted, existed, failed } = res.data;
    loadSources();
    setMessage({
      type: failed.length ? "warning" : "success",
      text: language === "zh"
        ? `导入完成：新增 ${inserted} 条，已存在 ${existed} 条，失败 ${failed.length} 条`
        : `Imported: ${inserted} new, ${existed} existed, ${failed.length} failed`
    });
  } catch (err) {
    setMessage({ type: "error", text: err.message });
  }
  setLoading(false);
};
```

- [ ] **Step 3: Update source list display**

Inside the source list map, add type badge and account name:

```jsx
<div style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#888" : COLORS.text.light, marginTop: 2 }}>
  {source.url ? `${source.url} · ` : ""}{source.type}
  {source.config?.accountName ? ` · ${source.config.accountName}` : ""}
</div>
```

- [ ] **Step 4: Verify in browser**

Open `http://localhost:5177/`, navigate to Configuration > Sources:

- Confirm type select has Website / WeChat / RSS.
- Confirm “从 sources.md 导入” button imports sources.
- Confirm list shows type badge and account name.

- [ ] **Step 5: Commit**

```bash
git add src/components/SourcesPage.jsx
git commit -m "feat(ui): support website/wechat sources and sources.md import"
```

---

### Task 11: End-to-End Verification

- [ ] **Step 1: Lint and build**

```bash
npm run lint
npm run build
```

Expected: lint passes (or only pre-existing warnings), build succeeds.

- [ ] **Step 2: Run tests**

```bash
node --test server/crawlers/websiteCrawler.test.js server/lib/sourcesMdLoader.test.js
```

Expected: both PASS.

- [ ] **Step 3: Manual tracker run**

```bash
curl -s -X POST http://localhost:3003/api/tracker/run | python3 -m json.tool
```

Poll `/api/tracker/runs/:id` until finished. Confirm:

- RSS source succeeds and creates insights.
- Website source attempts to fetch and logs per-article errors if any.
- WeChat source either succeeds or fails with a clear message.

- [ ] **Step 4: Final commit (if not already committed)**

```bash
git status
```

Commit any remaining changes.

---

## Spec Coverage Check

| Spec Requirement | Implementing Task |
|---|---|
| 三类来源统一接口 | Task 1, 2, 3, 4 |
| RSS crawler | Task 2 |
| Website crawler（首页 → 列表 → 详情） | Task 3 |
| WeChat crawler（搜狗搜索） | Task 4 |
| sources.md 自动导入 | Task 5, 7 |
| sources.md 手动导入 | Task 5, 6, 10 |
| Tracker 按类型调度 | Task 8 |
| 前端类型化表单 | Task 10 |
| 错误处理与日志 | Task 1, 3, 4, 8 |

## Placeholder Scan

- No `TBD`, `TODO`, or vague steps.
- Each code step includes the actual file path and code content.
- Each test step includes exact command and expected output.
