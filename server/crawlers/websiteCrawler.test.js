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
