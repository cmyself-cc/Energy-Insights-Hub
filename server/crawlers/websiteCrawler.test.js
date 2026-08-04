import { describe, it, expect, vi } from "vitest";
import { extractArticleLinks, fetchArticles } from "./websiteCrawler.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// 禁止测试中意外启动真实浏览器：strategy 默认 "auto"，HTML 列表拿不到文章时会回退到 Playwright 并访问真实网络
vi.mock("playwright", () => ({
  chromium: { launch: async () => { throw new Error("browser disabled in tests"); } }
}));

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

// requireNewsPattern 默认 true（websiteCrawler.js parseConfig），会过滤标题 <10 字符的链接，
// 因此需要纯测试 mock 行为的用例显式关闭
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
        requireNewsPattern: false,
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
      // 空配置 + 空页面：所有策略均无结果，fetchArticles 抛出 "No articles found..."（不会返回 []）
      await expect(
        fetchArticles({ url: "https://example.com/news", type: "website", config: "not valid json" })
      ).rejects.toThrow(/No articles found/);
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
      const config = JSON.stringify({ strategy: "html", requireNewsPattern: false });
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
      const config = JSON.stringify({ requireNewsPattern: false });
      const articles = await fetchArticles({ url: "https://example.com/news", type: "website", config });
      expect(articles.length).toBe(1);
      expect(articles[0].title).toBe("Success");
    }
  ));
});
