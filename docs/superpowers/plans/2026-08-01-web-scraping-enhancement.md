# Web Scraping Enhancement Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance website crawler with sub-page discovery, auto CSS selector detection, and improved time extraction.

**Architecture:** Add `discoverSubPages()` and `discoverListSelectors()` to `websiteCrawler.js`, enhance `extractPublishedDate()` in `crawlers/utils.js`, add discovery API endpoints in `routes/sources.js`, and add sub-page management UI to `SourcesPage.jsx`.

**Tech Stack:** Node.js with cheerio, React

## Global Constraints
- All backend code uses ES modules
- Crawler functions in `server/crawlers/`
- Routes in `server/routes/`
- Frontend components in `src/components/`
- Source config stored as JSON in `sources.config` column
- Build must pass: `npm run build`

---

### Task 1: Sub-Page Discovery Function

**Files:**
- Modify: `server/crawlers/websiteCrawler.js`
- Create: `server/crawlers/websiteCrawler.test.js` (optional)

**Interfaces:**
- Produces: `discoverSubPages(html, baseUrl)` → `[{ url, title, score }]`

- [ ] **Step 1: Add `discoverSubPages` function**

Add after the `discoverRssFeeds` function in `server/crawlers/websiteCrawler.js`:

```javascript
export function discoverSubPages(html, baseUrl) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const candidates = [];
  const pathPatterns = [/\/news/, /\/xwzx/, /\/article/, /\/post/, /\/blog/, /\/info/, /\/category/, /\/list/, /\/column/, /\/channel/];
  const textPatterns = /新闻|资讯|动态|全部|更多|列表|目录|要闻/;

  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (!href || href === "#" || href === "/" || href.startsWith("javascript:") || href.startsWith("mailto:")) return;
    const url = resolveUrl(baseUrl, href);
    if (!url || seen.has(url)) return;
    seen.add(url);

    let score = 0;
    const urlLower = url.toLowerCase();
    for (const pattern of pathPatterns) {
      if (pattern.test(urlLower)) { score += 5; break; }
    }
    if (textPatterns.test(text)) score += 3;

    if (score > 0) {
      candidates.push({ url, title: text || url, score });
    }
  });

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ url, title }) => ({ url, title }));
}
```

- [ ] **Step 2: Export the new function**

Verify `discoverSubPages` is exported (it already is via `export function`).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/crawlers/websiteCrawler.js
git commit -m "feat(crawler): add sub-page discovery function"
```

---

### Task 2: Auto Selector Detection

**Files:**
- Modify: `server/crawlers/websiteCrawler.js`

**Interfaces:**
- Consumes: `cheerio` instance
- Produces: `discoverListSelectors(html)` → `[selector: string]`

- [ ] **Step 1: Add `discoverListSelectors` function**

Add after `discoverSubPages`:

```javascript
export function discoverListSelectors(html) {
  const $ = cheerio.load(html);
  const groupScores = new Map();

  $("a[href]").each((_i, el) => {
    const $el = $(el);
    const href = $el.attr("href");
    const text = $el.text().trim();
    if (!href || !text || text.length < 5 || text.length > 200) return;

    // Find closest list-like parent
    let parent = $el.parent();
    for (let depth = 0; depth < 5 && parent.length; depth++) {
      const tag = parent.prop("tagName").toLowerCase();
      if (["li", "article", "div"].includes(tag)) {
        // Build selector for this <a> within the parent
        const parentTag = parent.prop("tagName").toLowerCase();
        let parentClass = parent.attr("class")?.split(/\s+/)[0] || "";
        const aTag = $el.prop("tagName").toLowerCase();
        let aClass = $el.attr("class")?.split(/\s+/)[0] || "";

        let selector;
        if (parentClass) {
          selector = `${parentTag}.${parentClass} ${aTag}` + (aClass ? `.${aClass}` : "");
        } else {
          selector = `${parentTag} ${aTag}`;
        }

        const score = groupScores.get(selector) || 0;
        let newScore = score + 1;
        const parentHtml = parent.html() || "";
        if (parentHtml.includes("time") || parentHtml.includes("date") || parentHtml.includes("span")) newScore += 2;
        if (isNewsUrl(href)) newScore += 3;
        if (isNewsTitle(text)) newScore += 2;
        groupScores.set(selector, newScore);
        break;
      }
      parent = parent.parent();
    }
  });

  return Array.from(groupScores.entries())
    .filter(([, score]) => score >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([sel]) => sel);
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/crawlers/websiteCrawler.js
git commit -m "feat(crawler): add auto CSS selector detection"
```

---

### Task 3: Enhanced Time Extraction

**Files:**
- Modify: `server/crawlers/utils.js`

**Interfaces:**
- Consumes: `cheerio` instance (`$`)
- Produces: `extractPublishedDate($)` → ISO date string (enhanced)

- [ ] **Step 1: Enhance `extractPublishedDate`**

Read current `extractPublishedDate` in `server/crawlers/utils.js`, then replace with:

```javascript
export function extractPublishedDate($) {
  const now = Date.now();

  // 1) <time> tag
  const timeEl = $("time[datetime]").first();
  if (timeEl.length) {
    const d = new Date(timeEl.attr("datetime"));
    if (!isNaN(d.getTime()) && (now - d.getTime()) < 30 * 24 * 60 * 60 * 1000) return d.toISOString();
  }

  // 2) meta tags
  const metaSelectors = [
    'meta[property="article:published_time"]',
    'meta[name="pubdate"]',
    'meta[name="publishdate"]',
    'meta[name="DC.date"]',
    'meta[name="date"]'
  ];
  for (const sel of metaSelectors) {
    const content = $(sel).attr("content");
    if (content) {
      const d = new Date(content);
      if (!isNaN(d.getTime()) && (now - d.getTime()) < 30 * 24 * 60 * 60 * 1000) return d.toISOString();
    }
  }

  // 3) Common CSS class patterns
  const classSelectors = [
    ".date", ".publish-date", ".article-date", ".post-date", ".pub-date",
    ".time", ".publish-time", ".article-time", ".post-time",
    "[class*='date']", "[class*='time']", "[class*='publish']"
  ];
  const datePattern = /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/;
  for (const sel of classSelectors) {
    const text = $(sel).first().text().trim();
    const match = text.match(datePattern);
    if (match) {
      const d = new Date(match[1]);
      if (!isNaN(d.getTime()) && (now - d.getTime()) < 30 * 24 * 60 * 60 * 1000) return d.toISOString();
    }
  }

  // 4) Text pattern matching in body
  const bodyText = $("body").text().slice(0, 2000);
  const patterns = [
    /发布时间[：:]\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s*\d{1,2}:\d{2})/,
    /发布日期[：:]\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s*\d{1,2}:\d{2})/,
    /(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s*\d{1,2}:\d{2})/
  ];
  for (const pattern of patterns) {
    const match = bodyText.match(pattern);
    if (match) {
      const d = new Date(match[1]);
      if (!isNaN(d.getTime()) && (now - d.getTime()) < 30 * 24 * 60 * 60 * 1000) return d.toISOString();
    }
  }

  return new Date().toISOString();
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/crawlers/utils.js
git commit -m "feat(crawler): enhance date extraction from detail pages"
```

---

### Task 4: Backend Discovery API

**Files:**
- Modify: `server/routes/sources.js`
- Modify: `server/crawlers/websiteCrawler.js` (export new functions to routes)

**Interfaces:**
- Consumes: `discoverSubPages`, `discoverListSelectors` from `websiteCrawler.js`
- Produces: `POST /api/sources/:id/discover-subpages`, `POST /api/sources/:id/confirm-subpages`

- [ ] **Step 1: Add import**

In `server/routes/sources.js`, add:

```javascript
import { discoverSubPages, discoverListSelectors } from "../crawlers/websiteCrawler.js";
import { fetchWithTimeout, randomUserAgent } from "../crawlers/utils.js";
```

- [ ] **Step 2: Add discover-subpages endpoint**

```javascript
router.post("/:id/discover-subpages", async (req, res) => {
  try {
    const source = db.prepare("SELECT * FROM sources WHERE id = ?").get(req.params.id);
    if (!source) return res.status(404).json({ error: "Source not found" });

    const html = await (await fetchWithTimeout(source.url, {
      headers: { "User-Agent": randomUserAgent(), "Accept": "text/html" }
    }, 20000)).text();

    const subPages = discoverSubPages(html, source.url);
    res.json({ data: subPages });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 3: Add confirm-subpages endpoint**

```javascript
router.post("/:id/confirm-subpages", async (req, res) => {
  try {
    const { subPages } = req.body;
    if (!Array.isArray(subPages)) return res.status(400).json({ error: "subPages must be an array" });

    const source = db.prepare("SELECT * FROM sources WHERE id = ?").get(req.params.id);
    if (!source) return res.status(404).json({ error: "Source not found" });

    let config = {};
    try { config = JSON.parse(source.config || "{}"); } catch {}

    // For each confirmed sub-page, detect list selectors
    for (const sp of subPages) {
      if (!sp.listSelectors) {
        try {
          const html = await (await fetchWithTimeout(sp.url, {
            headers: { "User-Agent": randomUserAgent(), "Accept": "text/html" }
          }, 20000)).text();
          sp.listSelectors = discoverListSelectors(html);
        } catch { sp.listSelectors = []; }
      }
    }

    config.subPages = subPages;
    config.discoveredAt = new Date().toISOString();
    config.listSelectors = config.listSelectors || [];
    for (const sp of subPages) {
      for (const sel of (sp.listSelectors || [])) {
        if (!config.listSelectors.includes(sel)) config.listSelectors.push(sel);
      }
    }

    db.prepare("UPDATE sources SET config = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(JSON.stringify(config), req.params.id);

    res.json({ data: { success: true, subPages: config.subPages.length, selectors: config.listSelectors.length } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/routes/sources.js
git commit -m "feat: add sub-page discovery and confirmation API endpoints"
```

---

### Task 5: Tracker integration - crawl sub-pages

**Files:**
- Modify: `server/crawlers/websiteCrawler.js`

**Interfaces:**
- Consumes: source config with `subPages`
- Produces: `fetchArticles` uses sub-pages in HTML list phase

- [ ] **Step 1: Integrate sub-pages into fetchArticles**

In `fetchArticles`, replace the HTML article list section (Step 3, around line 372-399) to also crawl sub-pages:

```javascript
  // 3) HTML article list - include sub-pages
  if ((strategy === "auto" || strategy === "html") && homeHtml) {
    const mainLinks = extractArticleLinks(homeHtml, source.url, config.articleLimit * 3, config.listSelectors);
    const allLinks = [...mainLinks];
    
    // Also crawl discovered sub-pages
    const subPages = (config.subPages || []).filter(sp => sp.active !== false);
    for (const sp of subPages) {
      try {
        const spHtml = await (await fetchWithTimeout(sp.url, {
          headers: { "User-Agent": randomUserAgent(), "Accept": "text/html" }
        }, 20000)).text();
        const selector = sp.listSelectors?.length ? sp.listSelectors : (config.listSelectors || undefined);
        const spLinks = extractArticleLinks(spHtml, sp.url, config.articleLimit * 2, selector);
        for (const link of spLinks) {
          if (!allLinks.find(l => l.url === link.url)) allLinks.push(link);
        }
      } catch (e) {
        console.error(`[website] Failed to fetch sub-page ${sp.url}:`, e.message);
      }
      await sleep(500);
    }

    const scored = scoreAndLimit(allLinks, config);
    console.log(`[website] HTML list found ${scored.length} candidate links (incl. sub-pages)`);
    // ... rest of article fetching loop ...
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/crawlers/websiteCrawler.js
git commit -m "feat(crawler): crawl discovered sub-pages during HTML list phase"
```

---

### Task 6: Frontend Sub-Page Management UI

**Files:**
- Modify: `src/components/SourcesPage.jsx`
- Modify: `src/utils/backendApi.js`

**Interfaces:**
- Consumes: backendApi methods
- Produces: UI for discovering and managing sub-pages

- [ ] **Step 1: Add backendApi methods**

In `src/utils/backendApi.js`, add:

```javascript
discoverSubPages: (id) => request(`/sources/${id}/discover-subpages`, { method: "POST" }),
confirmSubPages: (id, subPages) => request(`/sources/${id}/confirm-subpages`, { method: "POST", body: JSON.stringify({ subPages }) }),
```

- [ ] **Step 2: Add sub-pages management section**

In `SourcesPage.jsx`, inside the edit-source form (after existing fields), add a section for sub-pages. This requires adding state:

```javascript
const [discoveringSubPages, setDiscoveringSubPages] = useState(false);
const [subPageCandidates, setSubPageCandidates] = useState([]);
const [showSubPageDialog, setShowSubPageDialog] = useState(false);
```

Add a button and dialog in the edit form:

```jsx
{/* Sub-page discovery */}
<div style={{ marginTop: 12, padding: "12px", background: darkMode ? "#1c1f2b" : "#f9f9f9", borderRadius: BORDER_RADIUS.md }}>
  <div style={{ fontSize: 13, fontWeight: 600, color: text, marginBottom: 6 }}>
    {language === "zh" ? "子列表页" : "Sub Pages"}
  </div>
  <div style={{ fontSize: 11, color: darkMode ? "#888" : "#999", marginBottom: 8 }}>
    {language === "zh" ? "检测网站的全部新闻/资讯列表页，抓取更多文章" : "Detect news list sub-pages for more articles"}
  </div>
  <button
    onClick={async () => {
      setDiscoveringSubPages(true);
      try {
        const res = await backendApi.discoverSubPages(editingId);
        setSubPageCandidates(res.data || []);
        setShowSubPageDialog(true);
      } catch (e) { showMessage("error", e.message); }
      setDiscoveringSubPages(false);
    }}
    disabled={discoveringSubPages}
    style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${COLORS.primary}`, background: "transparent", color: COLORS.primary, fontSize: 12, cursor: "pointer" }}
  >🔍 {discoveringSubPages ? (language === "zh" ? "检测中..." : "Detecting...") : (language === "zh" ? "自动检测子列表页" : "Auto-detect sub pages")}</button>

  {showSubPageDialog && (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: cardBg, borderRadius: BORDER_RADIUS.lg, padding: 24, maxWidth: 500, width: "90%", maxHeight: "80vh", overflow: "auto" }}>
        <h3 style={{ margin: "0 0 12px", color: text }}>{language === "zh" ? "发现子列表页" : "Discovered Sub Pages"}</h3>
        {subPageCandidates.length === 0 ? (
          <div style={{ color: darkMode ? "#888" : "#999" }}>{language === "zh" ? "未发现子列表页" : "No sub pages found"}</div>
        ) : (
          subPageCandidates.map((sp, i) => (
            <label key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 0", borderBottom: `1px solid ${border}`, cursor: "pointer" }}>
              <input type="checkbox" defaultChecked onChange={e => {
                const next = [...subPageCandidates];
                next[i] = { ...sp, selected: e.target.checked };
                setSubPageCandidates(next);
              }} />
              <div>
                <div style={{ fontSize: 13, color: text }}>{sp.title}</div>
                <div style={{ fontSize: 11, color: darkMode ? "#888" : "#999" }}>{sp.url}</div>
              </div>
            </label>
          ))
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button onClick={() => setShowSubPageDialog(false)} style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${border}`, background: "transparent", color: text, fontSize: 12, cursor: "pointer" }}>{language === "zh" ? "取消" : "Cancel"}</button>
          <button onClick={async () => {
            const selected = subPageCandidates.filter(s => s.selected !== false);
            if (selected.length === 0) { setShowSubPageDialog(false); return; }
            try {
              await backendApi.confirmSubPages(editingId, selected);
              setShowSubPageDialog(false);
              showMessage("success", language === "zh" ? "子列表页已保存" : "Sub pages saved");
            } catch (e) { showMessage("error", e.message); }
          }} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: COLORS.primary, color: "#fff", fontSize: 12, cursor: "pointer" }}>{language === "zh" ? "确认添加" : "Confirm"}</button>
        </div>
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/SourcesPage.jsx src/utils/backendApi.js
git commit -m "feat: add sub-page discovery UI in source editor"
```

---

### Task 7: Integration Test & Final Verification

- [ ] **Step 1: Full build and test**

```bash
npm run build
```

Expected: PASS

- [ ] **Step 2: Manual test**

1. Start backend: make sure server is running
2. Open a source edit form
3. Click "🔍 自动检测子列表页"
4. Verify candidates appear
5. Confirm and check source config in DB:
   ```bash
   sqlite3 data/energy_insights.db "SELECT config FROM sources WHERE id=X;"
   ```
6. Run tracker and verify sub-pages are crawled

- [ ] **Step 3: Commit and push**

```bash
git add -A
git commit -m "feat: web scraping enhancement - sub-pages, auto selectors, better dates"
git push origin main
```
