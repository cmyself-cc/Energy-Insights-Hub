import { describe, it } from "node:test";
import assert from "node:assert";
import { extractArticleLinks, fetchArticles } from "./websiteCrawler.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const html = fs.readFileSync(path.join(__dirname, "__fixtures__/news-site.html"), "utf-8");

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
    assert.strictEqual(links.length, 2);
    assert.strictEqual(links[0].url, "https://example.com/article/solar-boom");
    assert.strictEqual(links[0].title, "Solar Boom Continues");
  });

  it("returns empty array for empty or invalid HTML without throwing", () => {
    assert.deepStrictEqual(extractArticleLinks("", "https://example.com", 10), []);
    assert.deepStrictEqual(extractArticleLinks("<html></html>", "https://example.com", 10), []);
    assert.deepStrictEqual(extractArticleLinks("not html", "https://example.com", 10), []);
  });

  it("uses custom list selectors when provided", () => {
    const links = extractArticleLinks(html, "https://example.com", 10, ["main article h2 a"]);
    assert.strictEqual(links.length, 2);
    assert.strictEqual(links[0].url, "https://example.com/article/solar-boom");
    assert.strictEqual(links[0].title, "Solar Boom Continues");
  });

  it("falls back to default selectors when custom list selectors produce no results", () => {
    const links = extractArticleLinks(html, "https://example.com", 10, [".no-match a"]);
    assert.strictEqual(links.length, 2);
    assert.strictEqual(links[0].url, "https://example.com/article/solar-boom");
  });
});

describe("fetchArticles", { concurrency: false }, () => {
  it("parses JSON-string config and applies articleLimit and selectors", withMockFetch(
    async (url) => {
      if (url === "https://example.com/news") {
        return { ok: true, status: 200, text: async () => `<!doctype html><html><body>
          <article><h2><a href="/article/one">One</a></h2></article>
          <article><h2><a href="/article/two">Two</a></h2></article>
        </body></html>` };
      }
      return { ok: true, status: 200, text: async () => `<!doctype html><html><body>
        <h1 class="article-title">Article Title</h1>
        <div class="post-content">Full content here.</div>
      </body></html>` };
    },
    async () => {
      const config = JSON.stringify({
        articleLimit: 1,
        selectors: { title: ".article-title", content: ".post-content" }
      });
      const articles = await fetchArticles({ url: "https://example.com/news", type: "website", config });
      assert.strictEqual(articles.length, 1);
      assert.strictEqual(articles[0].title, "Article Title");
      assert.strictEqual(articles[0].summary, "Full content here.");
    }
  ));

  it("falls back to empty config when config JSON string is invalid", withMockFetch(
    async () => ({ ok: true, status: 200, text: async () => "<html></html>" }),
    async () => {
      const articles = await fetchArticles({
        url: "https://example.com/news",
        type: "website",
        config: "not valid json"
      });
      assert.deepStrictEqual(articles, []);
    }
  ));

  it("throws an aggregate error when all article fetches fail", withMockFetch(
    async (url) => {
      if (url === "https://example.com/news") {
        return { ok: true, status: 200, text: async () => `<!doctype html><html><body>
          <article><h2><a href="/article/one">One</a></h2></article>
          <article><h2><a href="/article/two">Two</a></h2></article>
        </body></html>` };
      }
      return { ok: false, status: 500, text: async () => "Server Error" };
    },
    async () => {
      await assert.rejects(
        async () => fetchArticles({ url: "https://example.com/news", type: "website", config: {} }),
        /Article fetch failures: .*HTTP 500; .*HTTP 500/
      );
    }
  ));

  it("returns successful articles when some fetches fail", withMockFetch(
    async (url) => {
      if (url === "https://example.com/news") {
        return { ok: true, status: 200, text: async () => `<!doctype html><html><body>
          <article><h2><a href="/article/one">One</a></h2></article>
          <article><h2><a href="/article/two">Two</a></h2></article>
        </body></html>` };
      }
      if (url === "https://example.com/article/one") {
        return { ok: true, status: 200, text: async () => `<!doctype html><html><body>
          <article><h1>Success</h1><p>Content.</p></article>
        </body></html>` };
      }
      return { ok: false, status: 404, text: async () => "Not Found" };
    },
    async () => {
      const articles = await fetchArticles({ url: "https://example.com/news", type: "website", config: {} });
      assert.strictEqual(articles.length, 1);
      assert.strictEqual(articles[0].title, "Success");
    }
  ));
});
