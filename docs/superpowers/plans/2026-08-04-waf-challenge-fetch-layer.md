# WAF 挑战感知 Fetch 层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 website 爬虫能抓取被 Aliyun WAF（`acw_sc__v2` JS 挑战）保护的站点（首个目标：北极星能源网 `energy.bjx.com.cn`），并修复子页 GBK 乱码、无重试、maxAgeDays 不生效、正文选择器落空等覆盖率 bug。

**Architecture:** 新增 `server/crawlers/challenge.js` 提供统一的 `fetchHtmlSmart(url)`：常规抓取 → 检测挑战页 → Node `vm` 沙箱执行挑战脚本解出 cookie → 失败降级 Playwright 解锁 → cookie 按可注册域名内存缓存（1 小时 TTL）复用。websiteCrawler 的所有 HTTP 抓取（首页/子页/详情/sitemap）改走此层。

**Tech Stack:** Node.js（内置 `vm`）、cheerio、playwright（已有依赖）、vitest。

**Spec:** `docs/superpowers/specs/2026-08-04-waf-challenge-fetch-layer-design.md`

## Global Constraints

- 后端代码一律 ES modules（`"type": "module"`）。
- 新增/修改的测试必须用 vitest API（`import { describe, it, expect } from "vitest"`）。**不要用 `node:test`** —— 现有 11 个 node:test 文件在 `npx vitest run` 下报 "No test suite found"，属于历史遗留，不在本计划范围内修复。
- 验证命令基线：`npx vitest run server/crawlers/websiteCrawler.test.js server/crawlers/challenge.test.js` 必须全绿；`npm run build` 与 `npm run lint` 必须通过。不要运行全量 `npx vitest run` 并期望全绿（历史遗留 node:test 文件会失败）。
- 日志前缀统一 `[website]`。
- **禁止删除数据库中任何数据**（用户明确要求）。只允许 INSERT 新 source 记录。
- `fetchHtmlSmart` 抓到的 buffer 必须经过 `decodeHtmlBuffer` 解码（GBK/GB2312/GB18030）。
- cookie 缓存只在内存，不落库，不改 schema。

---

### Task 1: 修复 websiteCrawler 测试基线（node:test → vitest + 过期 mock）

**背景：** `server/crawlers/websiteCrawler.test.js` 目前用 `node:test` 编写，vitest 无法识别；且 mock 的响应对象只提供 `text()`，而现行 `fetchHtml` 调用 `res.arrayBuffer()`（GBK 解码引入后），导致 5 个 fetchArticles 用例全部失败。本任务把该文件迁移到 vitest 并修正 mock，得到绿色基线。

**Files:**
- Modify: `server/crawlers/websiteCrawler.test.js`（整体重写）

**Interfaces:**
- Produces: `htmlResponse(html, status)` mock 辅助函数模式（后续任务的测试沿用）

- [ ] **Step 1: 整体重写测试文件**

用以下内容完整替换 `server/crawlers/websiteCrawler.test.js`：

```javascript
import { describe, it, expect } from "vitest";
import { extractArticleLinks, fetchArticles } from "./websiteCrawler.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const html = fs.readFileSync(path.join(__dirname, "__fixtures__/news-site.html"), "utf-8");

// fetchHtml 通过 res.arrayBuffer() 读取响应体（GBK 解码需要 buffer），mock 必须提供 arrayBuffer 与 headers.get
function htmlResponse(body, status = 200, contentType = "text/html; charset=utf-8") {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => Buffer.from(body, "utf-8"),
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) }
  };
}

function withMockFetch(mockFn, testFn) {
  return async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFn;
    try {
      await testFn();
    } finally {
      global.fetch = originalFetch;
    }
  };
}

describe("extractArticleLinks", () => {
  it("extracts relative article links", () => {
    const links = extractArticleLinks(html, "https://example.com", 10);
    expect(links.length).toBe(2);
    expect(links[0].url).toBe("https://example.com/article/solar-boom");
    expect(links[0].title).toBe("Solar Boom Continues");
  });

  it("returns empty array for empty or invalid HTML without throwing", () => {
    expect(extractArticleLinks("", "https://example.com", 10)).toEqual([]);
    expect(extractArticleLinks("<html></html>", "https://example.com", 10)).toEqual([]);
    expect(extractArticleLinks("not html", "https://example.com", 10)).toEqual([]);
  });

  it("uses custom list selectors when provided", () => {
    const links = extractArticleLinks(html, "https://example.com", 10, ["main article h2 a"]);
    expect(links.length).toBe(2);
    expect(links[0].url).toBe("https://example.com/article/solar-boom");
    expect(links[0].title).toBe("Solar Boom Continues");
  });

  it("falls back to default selectors when custom list selectors produce no results", () => {
    const links = extractArticleLinks(html, "https://example.com", 10, [".no-match a"]);
    expect(links.length).toBe(2);
    expect(links[0].url).toBe("https://example.com/article/solar-boom");
  });
});

describe("fetchArticles", { concurrency: false }, () => {
  it("parses JSON-string config and applies articleLimit and selectors", withMockFetch(
    async (url) => {
      if (url === "https://example.com/news") {
        return htmlResponse(`<!doctype html><html><body>
          <article><h2><a href="/article/one">One</a></h2></article>
          <article><h2><a href="/article/two">Two</a></h2></article>
        </body></html>`);
      }
      return htmlResponse(`<!doctype html><html><body>
        <h1 class="article-title">Article Title</h1>
        <div class="post-content">Full content here.</div>
      </body></html>`);
    },
    async () => {
      const config = JSON.stringify({
        articleLimit: 1,
        selectors: { title: ".article-title", content: ".post-content" }
      });
      const articles = await fetchArticles({ url: "https://example.com/news", type: "website", config });
      expect(articles.length).toBe(1);
      expect(articles[0].title).toBe("Article Title");
      expect(articles[0].summary).toBe("Full content here.");
    }
  ));

  it("normalizes a string selectors.list into an array", withMockFetch(
    async (url) => {
      if (url === "https://example.com/news") {
        return htmlResponse(`<!doctype html><html><body>
          <div class="headline"><a href="/article/one">Headline One</a></h2></div>
        </body></html>`);
      }
      return htmlResponse(`<!doctype html><html><body>
        <h1 class="article-title">Headline Article</h1>
        <div class="post-content">Headline content.</div>
      </body></html>`);
    },
    async () => {
      const config = JSON.stringify({
        selectors: { list: ".headline a", title: ".article-title", content: ".post-content" }
      });
      const articles = await fetchArticles({ url: "https://example.com/news", type: "website", config });
      expect(articles.length).toBe(1);
      expect(articles[0].title).toBe("Headline Article");
      expect(articles[0].summary).toBe("Headline content.");
    }
  ));

  it("falls back to empty config when config JSON string is invalid", withMockFetch(
    async () => htmlResponse("<html></html>"),
    async () => {
      const articles = await fetchArticles({
        url: "https://example.com/news",
        type: "website",
        config: "not valid json"
      });
      expect(articles).toEqual([]);
    }
  ));

  it("throws when all article fetches fail (html strategy skips browser fallback)", withMockFetch(
    async (url) => {
      if (url === "https://example.com/news") {
        return htmlResponse(`<!doctype html><html><body>
          <article><h2><a href="/article/one">One</a></h2></article>
          <article><h2><a href="/article/two">Two</a></h2></article>
        </body></html>`);
      }
      return htmlResponse("Server Error", 500);
    },
    async () => {
      const config = JSON.stringify({ strategy: "html" });
      await expect(
        fetchArticles({ url: "https://example.com/news", type: "website", config })
      ).rejects.toThrow(/No articles found/);
    }
  ));

  it("returns successful articles when some fetches fail", withMockFetch(
    async (url) => {
      if (url === "https://example.com/news") {
        return htmlResponse(`<!doctype html><html><body>
          <article><h2><a href="/article/one">One</a></h2></article>
          <article><h2><a href="/article/two">Two</a></h2></article>
        </body></html>`);
      }
      if (url === "https://example.com/article/one") {
        return htmlResponse(`<!doctype html><html><body>
          <article><h1>Success</h1><p>Content.</p></article>
        </body></html>`);
      }
      return htmlResponse("Not Found", 404);
    },
    async () => {
      const articles = await fetchArticles({ url: "https://example.com/news", type: "website", config: {} });
      expect(articles.length).toBe(1);
      expect(articles[0].title).toBe("Success");
    }
  ));
});
```

注意两处与旧文件的差异（均为对齐现行代码行为）：
- 全部响应 mock 改用 `htmlResponse`（提供 `arrayBuffer` 和 `headers.get`）。
- 原 "throws an aggregate error" 用例改为 `strategy: "html"` + 期望 `/No articles found/`：现行代码没有聚合错误，且 `strategy: "html"` 避免测试误触 Playwright 分支启动真实浏览器。

- [ ] **Step 2: 运行测试确认绿**

Run: `npx vitest run server/crawlers/websiteCrawler.test.js`
Expected: PASS（9 个用例全过；"throws when all article fetches fail" 用例因 5xx 重试会多花约 1–2 秒，属预期）

- [ ] **Step 3: Commit**

```bash
git add server/crawlers/websiteCrawler.test.js
git commit -m "test(crawler): migrate websiteCrawler tests to vitest, fix stale arrayBuffer mocks"
```

---

### Task 2: 移动 decodeHtmlBuffer 到 utils.js 并声明 iconv-lite 依赖

**背景：** `challenge.js`（Task 3 起）需要复用 `decodeHtmlBuffer`，而它目前定义在 `websiteCrawler.js`。若 `challenge.js` 反向 import 会形成循环依赖，因此先移到 `utils.js`。同时 `iconv-lite` 目前是可解析的间接依赖但未在 `package.json` 声明，补声明。

**Files:**
- Modify: `server/crawlers/utils.js`
- Modify: `server/crawlers/websiteCrawler.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `decodeHtmlBuffer(buffer, contentType)` 从 `./utils.js` 导出；`websiteCrawler.js` 保持 re-export（兼容任何外部引用）

- [ ] **Step 1: 在 utils.js 顶部添加 iconv import 并移入函数**

`server/crawlers/utils.js` 第 1–2 行 import 区改为：

```javascript
import { URL } from "url";
import zlib from "zlib";
import iconv from "iconv-lite";
```

在文件末尾（`cleanText` 之后）追加：

```javascript
/**
 * Decode an HTML response buffer, handling GBK/GB2312/GB18030 pages that
 * declare their charset in the Content-Type header or a <meta> tag.
 * Falls back to UTF-8.
 */
export function decodeHtmlBuffer(buffer, contentType = "") {
  // 1) charset from Content-Type header
  const headerCharset = (contentType || "").match(/charset=([\w-]+)/i)?.[1];
  // 2) charset from <meta charset=...> / <meta http-equiv="Content-Type" ... charset=...>
  let html = buffer.toString("utf-8");
  const metaCharset = html.match(/<meta[^>]+charset=["']?\s*([\w-]+)/i)?.[1];
  const charset = headerCharset || metaCharset;
  if (charset && /^gbk$|^gb2312$|^gb18030$/i.test(charset)) {
    try {
      return iconv.decode(buffer, charset.toLowerCase());
    } catch {
      // fall through to utf-8
    }
  }
  return html;
}
```

- [ ] **Step 2: websiteCrawler.js 改为从 utils 导入并 re-export**

`server/crawlers/websiteCrawler.js` 顶部 import 块（第 5–16 行）改为：

```javascript
import {
  fetchWithTimeout,
  resolveUrl,
  sleep,
  randomUserAgent,
  isNewsUrl,
  isNewsTitle,
  extractPublishedDate,
  cleanText,
  decompressIfNeeded,
  normalizeUrl,
  decodeHtmlBuffer
} from "./utils.js";
```

删除文件中 `decodeHtmlBuffer` 的函数定义（含 JSDoc，约第 193–213 行），在原位置替换为 re-export：

```javascript
// Re-exported for backward compatibility; implementation lives in utils.js
export { decodeHtmlBuffer };
```

同时删除 websiteCrawler.js 第 4 行的 `import iconv from "iconv-lite";`（移入 utils 后此处不再使用）。

- [ ] **Step 3: package.json 声明 iconv-lite**

```bash
npm install iconv-lite --save
```

Expected: `package.json` dependencies 中出现 `iconv-lite`，版本与 node_modules 中已安装一致，不引入新版本升级冲突。

- [ ] **Step 4: 运行测试与构建确认无回归**

Run: `npx vitest run server/crawlers/websiteCrawler.test.js && npm run build`
Expected: PASS + build 成功

- [ ] **Step 5: Commit**

```bash
git add server/crawlers/utils.js server/crawlers/websiteCrawler.js package.json package-lock.json
git commit -m "refactor(crawler): move decodeHtmlBuffer to utils, declare iconv-lite dependency"
```

---

### Task 3: challenge.js 基础组件 —— 挑战检测、域名归并、cookie 缓存

**Files:**
- Create: `server/crawlers/challenge.js`
- Test: `server/crawlers/challenge.test.js`

**Interfaces:**
- Produces（后续任务依赖）:
  - `isChallengePage(html): boolean`
  - `getRegistrableDomain(hostname): string`
  - `setCachedCookie(domain, value, maxAgeMs = null): void`
  - `getCachedCookie(domain): string | null`
  - `clearCachedCookie(domain = null): void`

- [ ] **Step 1: 写失败测试**

创建 `server/crawlers/challenge.test.js`：

```javascript
import { describe, it, expect, beforeEach } from "vitest";
import {
  isChallengePage,
  getRegistrableDomain,
  setCachedCookie,
  getCachedCookie,
  clearCachedCookie
} from "./challenge.js";

describe("isChallengePage", () => {
  it("detects Aliyun WAF challenge page markers", () => {
    const html = `<textarea id="renderData">{"l1":"var arg1='abc';"}</textarea>
      <script name="aliyunwaf_x">setCookie("acw_sc__v2",e)</script>`;
    expect(isChallengePage(html)).toBe(true);
  });

  it("returns false for normal pages and empty input", () => {
    expect(isChallengePage("<html><body><h1>News</h1></body></html>")).toBe(false);
    expect(isChallengePage("")).toBe(false);
    expect(isChallengePage(null)).toBe(false);
  });

  it("returns false when only one marker is present", () => {
    expect(isChallengePage("var arg1='abc'")).toBe(false);
  });
});

describe("getRegistrableDomain", () => {
  it("collapses multi-label public suffixes", () => {
    expect(getRegistrableDomain("news.bjx.com.cn")).toBe("bjx.com.cn");
    expect(getRegistrableDomain("guangfu.bjx.com.cn")).toBe("bjx.com.cn");
  });

  it("falls back to last two labels for common TLDs", () => {
    expect(getRegistrableDomain("www.example.com")).toBe("example.com");
    expect(getRegistrableDomain("a.b.example.org")).toBe("example.org");
  });

  it("returns input for degenerate hosts", () => {
    expect(getRegistrableDomain("localhost")).toBe("localhost");
    expect(getRegistrableDomain("")).toBe("");
  });
});

describe("cookie cache", () => {
  beforeEach(() => clearCachedCookie());

  it("stores and retrieves a cookie by domain", () => {
    setCachedCookie("bjx.com.cn", "abc123");
    expect(getCachedCookie("bjx.com.cn")).toBe("abc123");
    expect(getCachedCookie("other.com")).toBeNull();
  });

  it("clears a single domain or the whole cache", () => {
    setCachedCookie("a.com", "1");
    setCachedCookie("b.com", "2");
    clearCachedCookie("a.com");
    expect(getCachedCookie("a.com")).toBeNull();
    expect(getCachedCookie("b.com")).toBe("2");
    clearCachedCookie();
    expect(getCachedCookie("b.com")).toBeNull();
  });

  it("ignores empty domain or value", () => {
    setCachedCookie("", "x");
    setCachedCookie("a.com", "");
    expect(getCachedCookie("")).toBeNull();
    expect(getCachedCookie("a.com")).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/crawlers/challenge.test.js`
Expected: FAIL（Cannot find module ./challenge.js）

- [ ] **Step 3: 实现**

创建 `server/crawlers/challenge.js`：

```javascript
// Challenge-aware fetch layer for sites protected by JS cookie challenges
// (e.g. Aliyun WAF "acw_sc__v2"). See spec 2026-08-04-waf-challenge-fetch-layer-design.md.

const cookieCache = new Map(); // domain -> { value, expiresAt }
const DEFAULT_COOKIE_TTL_MS = 55 * 60 * 1000; // slightly under the typical 1h cookie lifetime

// Common multi-label public suffixes; anything not matched falls back to last two labels.
const MULTI_LABEL_SUFFIXES = [
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn",
  "co.uk", "com.au", "com.hk", "com.tw"
];

/**
 * Detect Aliyun WAF-style JS challenge pages: they embed `var arg1='...'`
 * and reference the acw_sc__v2 cookie / aliyunwaf script.
 */
export function isChallengePage(html) {
  if (!html || typeof html !== "string") return false;
  return /var arg1=/.test(html) && (/acw_sc__v2/.test(html) || /aliyunwaf/.test(html));
}

/**
 * Collapse a hostname to its registrable domain so cookies solved on one
 * subdomain can be reused on siblings (verified: bjx.com.cn accepts a cookie
 * solved on news.bjx.com.cn for guangfu.bjx.com.cn).
 */
export function getRegistrableDomain(hostname) {
  const labels = String(hostname || "").toLowerCase().split(".").filter(Boolean);
  if (labels.length < 2) return String(hostname || "");
  for (const suffix of MULTI_LABEL_SUFFIXES) {
    const suffixLabels = suffix.split(".");
    if (labels.length > suffixLabels.length &&
        labels.slice(-suffixLabels.length).join(".") === suffix) {
      return labels.slice(-suffixLabels.length - 1).join(".");
    }
  }
  return labels.slice(-2).join(".");
}

export function setCachedCookie(domain, value, maxAgeMs = null) {
  if (!domain || !value) return;
  const ttl = maxAgeMs && maxAgeMs > 60000 ? Math.min(maxAgeMs, 24 * 3600 * 1000) : DEFAULT_COOKIE_TTL_MS;
  cookieCache.set(domain, { value, expiresAt: Date.now() + ttl });
}

export function getCachedCookie(domain) {
  if (!domain) return null;
  const entry = cookieCache.get(domain);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cookieCache.delete(domain);
    return null;
  }
  return entry.value;
}

export function clearCachedCookie(domain = null) {
  if (domain) cookieCache.delete(domain);
  else cookieCache.clear();
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/crawlers/challenge.test.js`
Expected: PASS（9 用例）

- [ ] **Step 5: Commit**

```bash
git add server/crawlers/challenge.js server/crawlers/challenge.test.js
git commit -m "feat(crawler): challenge detection, registrable domain, cookie cache"
```

---

### Task 4: vm 沙箱挑战求解器 + bjx 挑战页 fixture

**Files:**
- Modify: `server/crawlers/challenge.js`
- Modify: `server/crawlers/challenge.test.js`
- Create: `server/crawlers/__fixtures__/bjx-challenge.html`

**Interfaces:**
- Produces: `solveChallengeInVm(html, pageUrl): { value: string, maxAgeMs: number | null } | null`

- [ ] **Step 1: 保存 bjx 挑战页 fixture**

若 `/tmp/bjx_challenge.html` 仍存在则直接复制；否则重新抓取：

```bash
cd "/Users/cmyself/Live Projects/Energy Insights Hub"
if [ -f /tmp/bjx_challenge.html ]; then
  cp /tmp/bjx_challenge.html server/crawlers/__fixtures__/bjx-challenge.html
else
  curl -s -m 15 -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" \
    "https://news.bjx.com.cn/html/20260727/1505924.shtml" -o server/crawlers/__fixtures__/bjx-challenge.html
fi
grep -c "var arg1=" server/crawlers/__fixtures__/bjx-challenge.html
```

Expected: 输出 ≥1（确认 fixture 是挑战页）

- [ ] **Step 2: 写失败测试**

在 `server/crawlers/challenge.test.js` 顶部 import 中补 `solveChallengeInVm`，并补：

```javascript
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bjxChallengeHtml = fs.readFileSync(path.join(__dirname, "__fixtures__/bjx-challenge.html"), "utf-8");
```

追加测试：

```javascript
describe("solveChallengeInVm", () => {
  it("extracts acw_sc__v2 cookie from a real bjx challenge page", () => {
    const solved = solveChallengeInVm(bjxChallengeHtml, "https://news.bjx.com.cn/html/20260727/1505924.shtml");
    expect(solved).not.toBeNull();
    // 实测观察到的 cookie 形态：10 位 hex + '-' + 40 位 hex
    expect(solved.value).toMatch(/^[0-9a-f]{10}-[0-9a-f]{40}$/);
    expect(solved.maxAgeMs).toBe(3600 * 1000);
  });

  it("is deterministic for a fixed challenge page", () => {
    const a = solveChallengeInVm(bjxChallengeHtml, "https://news.bjx.com.cn/");
    const b = solveChallengeInVm(bjxChallengeHtml, "https://news.bjx.com.cn/");
    expect(a.value).toBe(b.value);
  });

  it("returns null for non-challenge HTML", () => {
    expect(solveChallengeInVm("<html><body>hello</body></html>", "https://example.com/")).toBeNull();
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run server/crawlers/challenge.test.js`
Expected: FAIL（solveChallengeInVm is not a function / not exported）

- [ ] **Step 4: 实现**

`server/crawlers/challenge.js` 顶部加 `import vm from "vm";`，文件末尾追加：

```javascript
/**
 * Solve an Aliyun WAF-style JS challenge by executing the page's scripts in a
 * Node vm sandbox and intercepting the document.cookie assignment.
 * The sandbox exposes no file/network/process capabilities; each script runs
 * with a 5s timeout. Errors after the cookie is captured are tolerated.
 *
 * Returns { value, maxAgeMs } or null when no acw_sc__v2 cookie was produced.
 */
export function solveChallengeInVm(html, pageUrl = "") {
  if (!isChallengePage(html)) return null;

  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1])
    .filter(s => s.trim());
  const renderData = html.match(/<textarea id="renderData"[^>]*>([\s\S]*?)<\/textarea>/i)?.[1] || "";

  let captured = null;
  const locationShim = { href: pageUrl, reload() {}, replace() {} };
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout: () => 0,
    setInterval: () => 0,
    clearTimeout: () => {},
    clearInterval: () => {},
    document: {
      getElementById: (id) => (id === "renderData" ? { innerHTML: renderData } : null),
      get cookie() { return captured || ""; },
      set cookie(v) {
        if (typeof v === "string" && v.includes("acw_sc__v2")) captured = v;
      },
      referrer: "",
      location: locationShim
    },
    navigator: { userAgent: "Mozilla/5.0", language: "zh-CN" },
    location: locationShim
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.top = sandbox;

  const ctx = vm.createContext(sandbox);
  for (const script of scripts) {
    try {
      vm.runInContext(script, ctx, { timeout: 5000 });
    } catch {
      // Challenge scripts often end with a reload/navigation we cannot honor;
      // keep going as long as we have not captured the cookie.
    }
    if (captured) break;
  }
  if (!captured) return null;

  const first = captured.split(";")[0];
  const eq = first.indexOf("=");
  const value = eq >= 0 ? first.slice(eq + 1).trim() : first.trim();
  if (!value) return null;
  const maxAge = captured.match(/max-age=(\d+)/i);
  return { value, maxAgeMs: maxAge ? Number(maxAge[1]) * 1000 : null };
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run server/crawlers/challenge.test.js`
Expected: PASS（12 用例）

- [ ] **Step 6: Commit**

```bash
git add server/crawlers/challenge.js server/crawlers/challenge.test.js server/crawlers/__fixtures__/bjx-challenge.html
git commit -m "feat(crawler): vm sandbox solver for Aliyun WAF acw_sc__v2 challenge"
```

---

### Task 5: fetchHtmlSmart —— 带重试与挑战流程的统一抓取入口

**Files:**
- Modify: `server/crawlers/challenge.js`
- Modify: `server/crawlers/challenge.test.js`

**Interfaces:**
- Consumes: `fetchWithTimeout`, `sleep`, `decodeHtmlBuffer`（来自 `./utils.js`）；Task 3/4 的缓存与求解函数
- Produces: `fetchHtmlSmart(url, options = {}, timeoutMs = 20000, { retryDelayMs = 1000 } = {}): Promise<string>`（解码后的 HTML；挑战无法解开时抛错）；`solveChallengeWithPlaywright(url): Promise<{ value, maxAgeMs } | null>`

- [ ] **Step 1: 写失败测试**

`server/crawlers/challenge.test.js` import 中补 `fetchHtmlSmart`、`clearCachedCookie`（已有）、`setCachedCookie`（已有），追加：

```javascript
function htmlResponse(body, status = 200, contentType = "text/html; charset=utf-8") {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => Buffer.from(body, "utf-8"),
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) }
  };
}

function withMockFetch(mockFn, testFn) {
  return async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFn;
    try {
      await testFn();
    } finally {
      global.fetch = originalFetch;
    }
  };
}

const REAL_ARTICLE_HTML = "<!doctype html><html><head><title>Real Article</title></head><body><div class=\"cc-article\">这是真实正文内容。</div></body></html>";

describe("fetchHtmlSmart", { concurrency: false }, () => {
  beforeEach(() => clearCachedCookie());

  it("returns decoded HTML for normal pages", withMockFetch(
    async () => htmlResponse(REAL_ARTICLE_HTML),
    async () => {
      const html = await fetchHtmlSmart("https://example.com/a", {}, 20000, { retryDelayMs: 1 });
      expect(html).toContain("Real Article");
    }
  ));

  it("retries once on network error then succeeds", withMockFetch(
    (() => {
      let calls = 0;
      return async () => {
        calls += 1;
        if (calls === 1) throw new TypeError("fetch failed");
        return htmlResponse(REAL_ARTICLE_HTML);
      };
    })(),
    async () => {
      const html = await fetchHtmlSmart("https://example.com/a", {}, 20000, { retryDelayMs: 1 });
      expect(html).toContain("Real Article");
    }
  ));

  it("retries once on HTTP 500 then succeeds", withMockFetch(
    (() => {
      let calls = 0;
      return async () => {
        calls += 1;
        if (calls === 1) return htmlResponse("err", 500);
        return htmlResponse(REAL_ARTICLE_HTML);
      };
    })(),
    async () => {
      const html = await fetchHtmlSmart("https://example.com/a", {}, 20000, { retryDelayMs: 1 });
      expect(html).toContain("Real Article");
    }
  ));

  it("does not retry on HTTP 404", withMockFetch(
    (() => {
      let calls = 0;
      return async () => {
        calls += 1;
        return htmlResponse("Not Found", 404);
      };
    })(),
    async () => {
      await expect(
        fetchHtmlSmart("https://example.com/a", {}, 20000, { retryDelayMs: 1 })
      ).rejects.toThrow(/HTTP 404/);
      expect(calls).toBe(1);
    }
  ));

  it("solves a challenge via vm, caches the cookie, and retries with it", withMockFetch(
    (() => {
      const calls = [];
      const fn = async (url, options) => {
        calls.push(options?.headers?.Cookie || "");
        return htmlResponse(calls.length === 1 ? bjxChallengeHtml : REAL_ARTICLE_HTML);
      };
      fn.calls = calls;
      return Object.assign(fn, { calls });
    })(),
    async () => {
      const html = await fetchHtmlSmart("https://news.bjx.com.cn/html/x.shtml", {}, 20000, { retryDelayMs: 1 });
      expect(html).toContain("Real Article");
      expect(getCachedCookie("bjx.com.cn")).not.toBeNull();
    }
  ));

  it("uses cached cookie on subsequent requests within TTL", withMockFetch(
    (() => {
      const calls = [];
      const fn = async (url, options) => {
        calls.push(options?.headers?.Cookie || "");
        return htmlResponse(REAL_ARTICLE_HTML);
      };
      return Object.assign(fn, { calls });
    })(),
    async () => {
      setCachedCookie("example.com", "seeded-cookie");
      const html = await fetchHtmlSmart("https://sub.example.com/a", {}, 20000, { retryDelayMs: 1 });
      expect(html).toContain("Real Article");
    }
  ));
});
```

注意：两个 challenge/cache 用例还需断言请求确实携带了 Cookie 头 —— 由于 mock 函数闭包在 `withMockFetch` 里，实现时把断言简化为行为断言（拿到真实页面 + 缓存被写入/命中）。若要在用例内直接检查 `calls`，可将 mock 定义为用例内变量并在 `withMockFetch` 外声明数组，二者取一即可，但必须至少验证：挑战用例后 `getCachedCookie("bjx.com.cn")` 非空。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/crawlers/challenge.test.js`
Expected: FAIL（fetchHtmlSmart is not exported）

- [ ] **Step 3: 实现**

`server/crawlers/challenge.js` import 区补：

```javascript
import vm from "vm";
import { chromium } from "playwright";
import { fetchWithTimeout, sleep, decodeHtmlBuffer } from "./utils.js";
```

文件末尾追加：

```javascript
const RETRYABLE_STATUS = (status) => status === 429 || status >= 500;

async function fetchOnceWithRetry(url, options, timeoutMs, retryDelayMs) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetchWithTimeout(url, options, timeoutMs);
    } catch (e) {
      if (attempt === 0) {
        console.error(`[website] fetch error for ${url}, retrying: ${e.message}`);
        await sleep(retryDelayMs);
        continue;
      }
      throw e;
    }
    if (RETRYABLE_STATUS(res.status) && attempt === 0) {
      console.error(`[website] HTTP ${res.status} for ${url}, retrying`);
      await sleep(retryDelayMs);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }
}

async function fetchDecoded(url, options, timeoutMs, retryDelayMs) {
  const res = await fetchOnceWithRetry(url, options, timeoutMs, retryDelayMs);
  return decodeHtmlBuffer(Buffer.from(await res.arrayBuffer()), res.headers.get("content-type") || "");
}

function withCookieHeader(options, cookieValue) {
  if (!cookieValue) return options;
  return { ...(options || {}), headers: { ...((options || {}).headers || {}), "Cookie": `acw_sc__v2=${cookieValue}` } };
}

/**
 * Solve the challenge by letting a real headless browser execute the JS and
 * reload; then harvest the cookie. Used only when the vm solver fails.
 */
export async function solveChallengeWithPlaywright(url, timeoutMs = 20000) {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-infobars",
        "--disable-dev-shm-usage"
      ]
    });
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai"
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load", timeout: timeoutMs });

    // The challenge script computes the cookie and reloads; poll for it.
    const deadline = Date.now() + 10000;
    let cookie = null;
    while (Date.now() < deadline) {
      cookie = (await context.cookies(url)).find(c => c.name === "acw_sc__v2");
      if (cookie) break;
      await sleep(500);
    }
    await context.close();
    if (!cookie) return null;

    const maxAgeMs = cookie.expires && cookie.expires > 0
      ? Math.max(cookie.expires * 1000 - Date.now(), 60000)
      : null;
    return { value: cookie.value, maxAgeMs };
  } catch (e) {
    console.error(`[website] Playwright challenge solve failed for ${url}:`, e.message);
    return null;
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

/**
 * Challenge-aware fetch. Flow: cached cookie -> fetch -> challenge detected?
 * -> vm solve -> Playwright solve -> re-fetch with cookie. Cookie is cached
 * per registrable domain.
 */
export async function fetchHtmlSmart(url, options = {}, timeoutMs = 20000, { retryDelayMs = 1000 } = {}) {
  let domain = "";
  try {
    domain = getRegistrableDomain(new URL(url).hostname);
  } catch {}

  let html = await fetchDecoded(url, withCookieHeader(options, getCachedCookie(domain)), timeoutMs, retryDelayMs);
  if (!isChallengePage(html)) return html;

  console.log(`[website] WAF challenge detected for ${url}`);
  clearCachedCookie(domain);

  // 1) vm sandbox solver
  const vmSolved = solveChallengeInVm(html, url);
  if (vmSolved) {
    setCachedCookie(domain, vmSolved.value, vmSolved.maxAgeMs);
    html = await fetchDecoded(url, withCookieHeader(options, vmSolved.value), timeoutMs, retryDelayMs);
    if (!isChallengePage(html)) {
      console.log(`[website] Challenge solved via vm for ${domain || url}`);
      return html;
    }
    clearCachedCookie(domain);
  }

  // 2) Playwright fallback solver
  const pwSolved = await solveChallengeWithPlaywright(url);
  if (pwSolved) {
    setCachedCookie(domain, pwSolved.value, pwSolved.maxAgeMs);
    html = await fetchDecoded(url, withCookieHeader(options, pwSolved.value), timeoutMs, retryDelayMs);
    if (!isChallengePage(html)) {
      console.log(`[website] Challenge solved via Playwright for ${domain || url}`);
      return html;
    }
    clearCachedCookie(domain);
  }

  throw new Error(`WAF challenge could not be solved for ${url}`);
}
```

注意 `new URL(url)` 需要 `URL` 全局（Node 环境已有全局 URL，无需 import）。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/crawlers/challenge.test.js`
Expected: PASS（全部用例；vm 挑战用例不触发 Playwright，因为 vm 已解出）

- [ ] **Step 5: Commit**

```bash
git add server/crawlers/challenge.js server/crawlers/challenge.test.js
git commit -m "feat(crawler): fetchHtmlSmart with retry, challenge detection and cookie cache"
```

---

### Task 6: websiteCrawler 接入挑战层 + 修复子页 GBK 乱码

**Files:**
- Modify: `server/crawlers/websiteCrawler.js`
- Modify: `server/crawlers/websiteCrawler.test.js`

**Interfaces:**
- Consumes: `fetchHtmlSmart(url, options, timeoutMs)`（Task 5）
- Produces: `fetchHtml` 签名不变；子列表页抓取改走 `fetchHtmlSmart`

- [ ] **Step 1: 写失败测试（挑战详情页 + GBK 子页）**

在 `server/crawlers/websiteCrawler.test.js` 顶部 import 补 `beforeEach` 和 `clearCachedCookie`：

```javascript
import { describe, it, expect, beforeEach } from "vitest";
import { clearCookieCache } from "./challenge.js";
```

在 `describe("fetchArticles", ...)` 块内第一行加 `beforeEach(() => clearCookieCache());`，并追加两个用例：

```javascript
  it("solves a WAF challenge protecting article detail pages", withMockFetch(
    (() => {
      const detailCalls = [];
      return Object.assign(
        async (url) => {
          if (url === "https://example.com/news") {
            return htmlResponse(`<!doctype html><html><body>
              <article><h2><a href="/article/one">能源行业新闻标题测试</a></h2></article>
            </body></html>`);
          }
          detailCalls.push(url);
          const challengeHtml = fs.readFileSync(path.join(__dirname, "__fixtures__/bjx-challenge.html"), "utf-8");
          // 首次返回挑战页，带 cookie 后返回真实页面
          const cookieSent = detailCalls.length > 1;
          return htmlResponse(cookieSent
            ? `<!doctype html><html><body>
                <h1 class="article-title">真实文章标题</h1>
                <div class="post-content">${"真实正文内容。".repeat(50)}</div>
              </body></html>`
            : challengeHtml);
        },
        { detailCalls }
      );
    })(),
    async () => {
      const config = JSON.stringify({ strategy: "html", requireNewsPattern: false, articleLimit: 1 });
      const articles = await fetchArticles({ url: "https://example.com/news", type: "website", config });
      expect(articles.length).toBe(1);
      expect(articles[0].rawContent).toContain("真实正文内容");
    }
  ));

  it("decodes GBK-encoded sub-pages", withMockFetch(
    async (url) => {
      const iconv = (await import("iconv-lite")).default;
      const gbkResponse = (body) => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => iconv.encode(body, "gbk"),
        headers: { get: (name) => (name.toLowerCase() === "content-type" ? "text/html; charset=gbk" : null) }
      });
      if (url === "https://example.com/news") {
        return gbkResponse("<!doctype html><html><body><p>首页无列表</p></body></html>");
      }
      if (url === "https://example.com/list") {
        return gbkResponse(`<!doctype html><html><body>
          <article><h2><a href="/article/one">煤炭价格变动情况分析</a></h2></article>
        </body></html>`);
      }
      return gbkResponse(`<!doctype html><html><body>
        <h1 class="article-title">煤炭文章标题</h1>
        <div class="post-content">${"中文正文内容测试。".repeat(40)}</div>
      </body></html>`);
    },
    async () => {
      const config = JSON.stringify({
        strategy: "html",
        requireNewsPattern: false,
        articleLimit: 1,
        subPages: [{ url: "https://example.com/list", active: true }]
      });
      const articles = await fetchArticles({ url: "https://example.com/news", type: "website", config });
      expect(articles.length).toBe(1);
      expect(articles[0].title).toBe("煤炭文章标题");
      expect(articles[0].rawContent).toContain("中文正文内容测试");
    }
  ));
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/crawlers/websiteCrawler.test.js`
Expected: FAIL —— 挑战用例 rawContent 为空（fetchHtml 不带 cookie 重取）；GBK 用例标题乱码或链接为空（子页走 `.text()` 不解码）

- [ ] **Step 3: 修改 websiteCrawler.js**

3a. import 区（Task 2 已改过的 utils import 块之后）补：

```javascript
import { fetchHtmlSmart } from "./challenge.js";
```

3b. `fetchHtml` 函数体替换为（函数签名不变）：

```javascript
async function fetchHtml(url, timeoutMs = 20000) {
  return fetchHtmlSmart(
    url,
    {
      headers: {
        "User-Agent": randomUserAgent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache"
      }
    },
    timeoutMs
  );
}
```

3c. `fetchArticles` 内子列表页抓取段（`// Also crawl discovered sub-pages` 下方 for 循环内）替换为：

```javascript
      try {
        const spHtml = await fetchHtmlSmart(sp.url, {
          headers: { "User-Agent": randomUserAgent(), "Accept": "text/html" }
        }, 20000);
        const selector = sp.listSelectors?.length ? sp.listSelectors : (config.listSelectors || undefined);
        const spLinks = extractArticleLinks(spHtml, sp.url, config.articleLimit * 2, selector);
        for (const link of spLinks) {
          if (!allLinks.find(l => l.url === link.url)) allLinks.push(link);
        }
      } catch (e) {
        console.error(`[website] Failed to fetch sub-page ${sp.url}:`, e.message);
      }
      await sleep(500);
```

（唯一变化：`(await fetchWithTimeout(...)).text()` → `fetchHtmlSmart(...)`；若此后 `fetchWithTimeout` 在 websiteCrawler.js 中不再被引用，则从 utils import 块中移除以免 lint 报错 —— 先 grep 确认：sitemap 抓取仍在使用，保留。）

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/crawlers/websiteCrawler.test.js server/crawlers/challenge.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/crawlers/websiteCrawler.js server/crawlers/websiteCrawler.test.js
git commit -m "feat(crawler): route website crawler fetches through challenge-aware layer, fix GBK sub-pages"
```

---

### Task 7: maxAgeDays 全路径生效 + publishDate 空值处理

**Files:**
- Modify: `server/crawlers/websiteCrawler.js`
- Modify: `server/crawlers/websiteCrawler.test.js`

**Interfaces:**
- Consumes: `extractPublishedDate($)` 返回 `string | null`（utils.js 现状）
- Produces: `fetchArticleDetail` 的 `publishDate` 可为 null；HTML 列表与 Playwright DOM 分支负责回退为当前时间；超龄文章被跳过

- [ ] **Step 1: 写失败测试**

在 `websiteCrawler.test.js` 的 fetchArticles 块内追加：

```javascript
  it("skips articles older than maxAgeDays in the HTML list path", withMockFetch(
    async (url) => {
      const oldDate = new Date(Date.now() - 10 * 86400000).toISOString();
      const newDate = new Date(Date.now() - 1 * 86400000).toISOString();
      if (url === "https://example.com/news") {
        return htmlResponse(`<!doctype html><html><body>
          <article><h2><a href="/article/old">旧文章标题测试</a></h2></article>
          <article><h2><a href="/article/new">新文章标题测试</a></h2></article>
        </body></html>`);
      }
      if (url === "https://example.com/article/old") {
        return htmlResponse(`<!doctype html><html><head>
          <meta property="article:published_time" content="${oldDate}">
        </head><body><h1 class="article-title">旧文章</h1><div class="post-content">${"旧文内容。".repeat(40)}</div></body></html>`);
      }
      return htmlResponse(`<!doctype html><html><head>
        <meta property="article:published_time" content="${newDate}">
      </head><body><h1 class="article-title">新文章</h1><div class="post-content">${"新文内容。".repeat(40)}</div></body></html>`);
    },
    async () => {
      const config = JSON.stringify({ strategy: "html", requireNewsPattern: false, articleLimit: 5, maxAgeDays: 7 });
      const articles = await fetchArticles({ url: "https://example.com/news", type: "website", config });
      expect(articles.length).toBe(1);
      expect(articles[0].url).toBe("https://example.com/article/new");
    }
  ));

  it("keeps articles without a detectable date and falls back to now", withMockFetch(
    async (url) => {
      if (url === "https://example.com/news") {
        return htmlResponse(`<!doctype html><html><body>
          <article><h2><a href="/article/undated">无日期文章标题</a></h2></article>
        </body></html>`);
      }
      return htmlResponse(`<!doctype html><html><body>
        <h1 class="article-title">无日期文章</h1><div class="post-content">${"内容。".repeat(60)}</div>
      </body></html>`);
    },
    async () => {
      const config = JSON.stringify({ strategy: "html", requireNewsPattern: false, articleLimit: 5, maxAgeDays: 7 });
      const articles = await fetchArticles({ url: "https://example.com/news", type: "website", config });
      expect(articles.length).toBe(1);
      const age = Date.now() - new Date(articles[0].publishDate).getTime();
      expect(age).toBeLessThan(60000); // 回退为抓取时刻
    }
  ));
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/crawlers/websiteCrawler.test.js`
Expected: FAIL —— 第一个用例返回 2 篇（旧文章未被过滤）

- [ ] **Step 3: 实现**

3a. `websiteCrawler.js` 在 `scoreAndLimit` 函数附近新增：

```javascript
function isTooOld(publishDate, maxAgeDays) {
  if (!publishDate || !maxAgeDays || maxAgeDays <= 0) return false;
  const t = new Date(publishDate).getTime();
  if (isNaN(t)) return false;
  return (Date.now() - t) / 86400000 > maxAgeDays;
}
```

3b. `fetchArticleDetail` 中：

```javascript
  const publishDate = extractPublishedDate($) || new Date().toISOString();
```

改为：

```javascript
  // Keep null when no date is found; callers apply the fallback so that
  // maxAgeDays filtering can distinguish real dates from missing ones.
  const publishDate = extractPublishedDate($);
```

3c. HTML 列表分支（`fetchArticles` 中 `for (const link of scored)` 循环）：

```javascript
        const article = await fetchArticleDetail(link.url, config.detailSelectors);
        if (!article.title) article.title = link.title;
        articles.push(article);
```

改为：

```javascript
        const article = await fetchArticleDetail(link.url, config.detailSelectors);
        if (isTooOld(article.publishDate, config.maxAgeDays)) {
          console.log(`[website] Skipping article older than ${config.maxAgeDays}d: ${link.url}`);
          continue;
        }
        if (!article.title) article.title = link.title;
        if (!article.publishDate) article.publishDate = new Date().toISOString();
        articles.push(article);
```

3d. Playwright DOM 分支（`fetchWithPlaywright` 尾部 `for (const link of scored.slice(...))` 循环）做同样处理：

```javascript
        const article = await fetchArticleDetail(link.url, config.detailSelectors);
        if (isTooOld(article.publishDate, config.maxAgeDays)) continue;
        if (!article.title) article.title = link.title;
        if (!article.publishDate) article.publishDate = new Date().toISOString();
        articles.push(article);
```

3e. Playwright API 分支两处 `publishDate: detail.publishDate || new Date().toISOString()` 已兼容 null，无需改动；检查确认即可。

3f. `fetchSitemapArticles` 中 `articles.push({ ...detail, publishDate: candidate.publishDate || detail.publishDate });` 改为：

```javascript
      articles.push({ ...detail, publishDate: candidate.publishDate || detail.publishDate || new Date().toISOString() });
```

3g. `fetchRssArticles`：RSS 条目自带 pubDate（map 阶段已回退为当前时间），在 `requireNewsPattern` 过滤之后追加：

```javascript
    items = items.filter(item => !isTooOld(item.publishDate, config.maxAgeDays));
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/crawlers/websiteCrawler.test.js server/crawlers/challenge.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/crawlers/websiteCrawler.js server/crawlers/websiteCrawler.test.js
git commit -m "feat(crawler): enforce maxAgeDays on HTML/RSS paths, preserve null publishDate"
```

---

### Task 8: 正文容器兜底启发式（选择器落空时取最长文本块）

**Files:**
- Modify: `server/crawlers/websiteCrawler.js`
- Modify: `server/crawlers/websiteCrawler.test.js`

**Interfaces:**
- Produces: `fetchArticleDetail` 在选择器命中内容 < 200 字时，回退到 body 内最长块级文本（剔除 nav/header/footer 等）

- [ ] **Step 1: 写失败测试**

追加用例：

```javascript
  it("falls back to the largest text block when detail selectors miss", withMockFetch(
    async (url) => {
      if (url === "https://example.com/news") {
        return htmlResponse(`<!doctype html><html><body>
          <article><h2><a href="/article/one">正文兜底测试标题</a></h2></article>
        </body></html>`);
      }
      // 正文在 cc-article（不在默认 detail 选择器内）
      return htmlResponse(`<!doctype html><html><body>
        <h1>正文兜底测试标题</h1>
        <div class="cc-article">${"北极星能源网正文内容段落。".repeat(40)}</div>
      </body></html>`);
    },
    async () => {
      const config = JSON.stringify({ strategy: "html", requireNewsPattern: false, articleLimit: 1 });
      const articles = await fetchArticles({ url: "https://example.com/news", type: "website", config });
      expect(articles.length).toBe(1);
      expect(articles[0].rawContent).toContain("北极星能源网正文内容段落");
    }
  ));
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/crawlers/websiteCrawler.test.js`
Expected: FAIL —— rawContent 为空（默认选择器不命中 `cc-article`）

- [ ] **Step 3: 实现**

`websiteCrawler.js` 在 `fetchArticleDetail` 上方新增：

```javascript
/**
 * Last-resort content extraction: pick the largest block-level text region
 * after stripping navigation/boilerplate containers. Only used when the
 * configured/default detail selectors yield almost nothing.
 */
function extractLargestTextBlock($) {
  const bodyHtml = $("body").html();
  if (!bodyHtml) return "";
  const $clone = cheerio.load(bodyHtml);
  $clone("nav, header, footer, aside, form, iframe, noscript, script, style").remove();
  let best = "";
  $clone("div, section, article, td").each((_i, el) => {
    const text = cleanText($clone(el).text());
    if (text.length > best.length) best = text;
  });
  return best;
}
```

`fetchArticleDetail` 中：

```javascript
  const contentEl = $(detailSelectors.content || DEFAULT_DETAIL_SELECTORS.content).first();
  contentEl.find("script,style,nav,header,footer,aside,.advertisement,.ads,.social-share,.comments").remove();
  const content = cleanText(contentEl.text());
```

改为：

```javascript
  const contentEl = $(detailSelectors.content || DEFAULT_DETAIL_SELECTORS.content).first();
  contentEl.find("script,style,nav,header,footer,aside,.advertisement,.ads,.social-share,.comments").remove();
  let content = cleanText(contentEl.text());
  if (content.length < 200) {
    const fallback = extractLargestTextBlock($);
    if (fallback.length > content.length) content = fallback;
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/crawlers/websiteCrawler.test.js server/crawlers/challenge.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/crawlers/websiteCrawler.js server/crawlers/websiteCrawler.test.js
git commit -m "feat(crawler): largest-text-block fallback when detail selectors miss"
```

---

### Task 9: routes/sources.js 发现端点接入挑战层

**Files:**
- Modify: `server/routes/sources.js`

**Interfaces:**
- Consumes: `fetchHtmlSmart(url, options, timeoutMs)`

- [ ] **Step 1: 修改 import 与两处抓取**

`server/routes/sources.js` 第 7 行：

```javascript
import { fetchWithTimeout, randomUserAgent } from "../crawlers/utils.js";
```

改为：

```javascript
import { randomUserAgent } from "../crawlers/utils.js";
import { fetchHtmlSmart } from "../crawlers/challenge.js";
```

`POST /:id/discover-subpages` 中：

```javascript
    const html = await (await fetchWithTimeout(source.url, {
      headers: { "User-Agent": randomUserAgent(), "Accept": "text/html" }
    }, 20000)).text();
```

改为：

```javascript
    const html = await fetchHtmlSmart(source.url, {
      headers: { "User-Agent": randomUserAgent(), "Accept": "text/html" }
    }, 20000);
```

`POST /:id/confirm-subpages` 中同样的结构：

```javascript
          const html = await (await fetchWithTimeout(sp.url, {
            headers: { "User-Agent": randomUserAgent(), "Accept": "text/html" }
          }, 20000)).text();
```

改为：

```javascript
          const html = await fetchHtmlSmart(sp.url, {
            headers: { "User-Agent": randomUserAgent(), "Accept": "text/html" }
          }, 20000);
```

改完后确认 `fetchWithTimeout` 在该文件已无引用（grep 验证），否则保留 import。

- [ ] **Step 2: lint + build 验证**

Run: `npm run lint && npm run build`
Expected: 均通过

- [ ] **Step 3: Commit**

```bash
git add server/routes/sources.js
git commit -m "fix: route source discovery endpoints through challenge-aware fetch"
```

---

### Task 10: 新增 bjx source + 端到端活体冒烟 + 最终验证

**Files:**
- Modify: `data/energy_insights.db`（仅 INSERT 一行）
- Create: `scripts/smoke-bjx.mjs`

**Interfaces:**
- Consumes: 全部前置任务产物

- [ ] **Step 1: 插入 bjx source（先查重，只 INSERT）**

```bash
cd "/Users/cmyself/Live Projects/Energy Insights Hub"
sqlite3 data/energy_insights.db "SELECT id, url FROM sources WHERE url = 'https://energy.bjx.com.cn';"
```

Expected: 无输出（不存在）。若已存在则跳过本步。不存在则执行：

```bash
sqlite3 data/energy_insights.db "INSERT INTO sources (name, url, type, active, purpose, config) VALUES ('北极星能源网', 'https://energy.bjx.com.cn', 'website', 1, '', '{\"strategy\":\"auto\",\"articleLimit\":10,\"detailSelectors\":{\"title\":\"h1\",\"content\":\".cc-article\"}}');"
sqlite3 data/energy_insights.db "SELECT id, name, url, config FROM sources WHERE url = 'https://energy.bjx.com.cn';"
```

Expected: 返回新插入的行，config JSON 完整。

- [ ] **Step 2: 创建冒烟脚本**

创建 `scripts/smoke-bjx.mjs`：

```javascript
// Live smoke test: crawl the bjx source end-to-end and verify coverage.
// Usage: node scripts/smoke-bjx.mjs
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { fetchArticles } from "../server/crawlers/websiteCrawler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, "..", "data", "energy_insights.db"), { readonly: true });
const source = db.prepare("SELECT * FROM sources WHERE url = ?").get("https://energy.bjx.com.cn");
if (!source) {
  console.error("FAIL: bjx source not found in database");
  process.exit(1);
}

const t0 = Date.now();
const articles = await fetchArticles(source);
console.log(`Fetched ${articles.length} articles in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const failures = [];
if (articles.length < 5) failures.push(`expected >=5 articles, got ${articles.length}`);
for (const a of articles) {
  if ((a.rawContent || "").length < 100) failures.push(`thin content (${(a.rawContent || "").length} chars): ${a.url}`);
  const ageMs = Date.now() - new Date(a.publishDate).getTime();
  if (isNaN(ageMs) || ageMs > 8 * 86400000) failures.push(`bad publishDate ${a.publishDate}: ${a.url}`);
  console.log(`- [${(a.publishDate || "").slice(0, 10)}] ${(a.title || "").slice(0, 50)} | content:${(a.rawContent || "").length}字`);
}

if (failures.length > 0) {
  console.error("FAIL:");
  failures.forEach(f => console.error("  - " + f));
  process.exit(1);
}
console.log("PASS");
```

- [ ] **Step 3: 运行活体冒烟**

Run: `node scripts/smoke-bjx.mjs`
Expected: 输出 `PASS`；文章 ≥5 篇、正文均 ≥100 字、日期均在近 8 天内。首次运行会打印 `[website] WAF challenge detected ... Challenge solved via vm`。若某次因网络抖动失败，重跑一次；连续两次失败则按 systematic-debugging 排查，不得带病进入下一步。

- [ ] **Step 4: 全量验证**

```bash
npx vitest run server/crawlers/websiteCrawler.test.js server/crawlers/challenge.test.js
npm run lint
npm run build
```

Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-bjx.mjs
git commit -m "feat: add bjx energy source, live smoke script for challenge-aware crawler"
```

（数据库 INSERT 无法 git 提交；source 配置已在 Step 1 写入 `data/energy_insights.db`。该文件在 .gitignore 内，属运行时数据，符合项目惯例。）

---

## 验收标准（对应 spec）

1. `npx vitest run server/crawlers/websiteCrawler.test.js server/crawlers/challenge.test.js` 全绿；`npm run lint`、`npm run build` 通过。
2. `node scripts/smoke-bjx.mjs` 输出 PASS：bjx 端到端产出正文非空、日期正确的文章。
3. 既有 website 源行为不回归（websiteCrawler 测试全部场景覆盖通过）。
