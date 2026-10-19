import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
    expect(articles.length).toBe(2);
    expect(articles[0].title).toBe("Article 1");
    expect(articles[1].title).toBe("Article 2");
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
    expect(articles.length).toBe(20);
  });
});
