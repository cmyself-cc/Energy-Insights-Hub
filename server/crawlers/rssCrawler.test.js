import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import Parser from "rss-parser";
import { fetchArticles } from "./rssCrawler.js";

describe("fetchArticles", () => {
  let originalParseURL;

  beforeEach(() => {
    originalParseURL = Parser.prototype.parseURL;
  });

  afterEach(() => {
    Parser.prototype.parseURL = originalParseURL;
  });

  it("parses JSON-string config and respects articleLimit", async () => {
    Parser.prototype.parseURL = async () => ({
      items: Array.from({ length: 5 }, (_, i) => ({
        title: `Article ${i + 1}`,
        link: `https://example.com/article-${i + 1}`,
        pubDate: new Date().toISOString(),
        contentSnippet: `Summary ${i + 1}`
      }))
    });

    const config = JSON.stringify({ articleLimit: 2 });
    const articles = await fetchArticles({ url: "https://example.com/rss", type: "rss", config });
    assert.strictEqual(articles.length, 2);
    assert.strictEqual(articles[0].title, "Article 1");
    assert.strictEqual(articles[1].title, "Article 2");
  });

  it("falls back to default limit when config is not provided", async () => {
    Parser.prototype.parseURL = async () => ({
      items: Array.from({ length: 25 }, (_, i) => ({
        title: `Article ${i + 1}`,
        link: `https://example.com/article-${i + 1}`,
        pubDate: new Date().toISOString()
      }))
    });

    const articles = await fetchArticles({ url: "https://example.com/rss", type: "rss" });
    assert.strictEqual(articles.length, 20);
  });
});
