import { describe, it } from "node:test";
import assert from "node:assert";
import { parseArticleList } from "./wechatCrawler.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, "__fixtures__/sogou-articles.html"), "utf-8");

describe("parseArticleList", () => {
  it("extracts articles matching the account name and resolves relative URLs", () => {
    const articles = parseArticleList(html, "光伏们");
    assert.strictEqual(articles.length, 2);

    assert.strictEqual(articles[0].title, "光伏市场周报：组件价格企稳");
    assert.strictEqual(
      articles[0].url,
      "https://weixin.sogou.com/link?url=dn9a_-gY295K0Rci_xozVXfdMkSQTLW6EzDJysI4ql5M9OqeaXvX6-&type=2&query=%E5%85%89%E4%BC%8F%E4%BB%AC"
    );
    assert.strictEqual(articles[0].summary, "本周光伏产业链价格整体持稳，硅料环节库存压力有所缓解，组件排产逐步恢复。");
    assert.strictEqual(articles[0].publishDate, "2019-03-07T03:21:05.000Z");
    assert.strictEqual(articles[0].rawContent, articles[0].summary);

    assert.strictEqual(articles[1].title, "分布式光伏政策解读");
    assert.strictEqual(articles[1].publishDate, "2019-03-08T03:20:00.000Z");
  });

  it("parses timestamps from the script call inside .s-p", () => {
    const articles = parseArticleList(html, "光伏们");
    assert.strictEqual(articles[0].publishDate, "2019-03-07T03:21:05.000Z");
    assert.strictEqual(articles[1].publishDate, "2019-03-08T03:20:00.000Z");
  });

  it("includes all valid articles when account name is empty", () => {
    const articles = parseArticleList(html, "");
    assert.strictEqual(articles.length, 3);
    assert.ok(articles.some(a => a.title === "光伏市场周报：组件价格企稳"));
    assert.ok(articles.some(a => a.title === "分布式光伏政策解读"));
    assert.ok(articles.some(a => a.title.includes("irrelevant article")));
  });

  it("filters case-insensitively by publisher", () => {
    const inlineHtml = `
      <ul class="news-list">
        <li id="sogou_vr_11002601_0">
          <div class="txt-box"><h3><a href="/link?url=a">Title A</a></h3><p class="txt-info">Summary A</p></div>
          <div class="s-p"><span class="all-time-y2">Energy Daily</span><script>timeConvert('1551928865')</script></div>
        </li>
        <li id="sogou_vr_11002601_1">
          <div class="txt-box"><h3><a href="/link?url=b">Title B</a></h3><p class="txt-info">Summary B</p></div>
          <div class="s-p"><span class="all-time-y2">energy daily</span><script>timeConvert('1551928865')</script></div>
        </li>
      </ul>
    `;
    const articles = parseArticleList(inlineHtml, "ENERGY DAILY");
    assert.strictEqual(articles.length, 2);
  });

  it("returns an empty array for HTML without matching selectors", () => {
    assert.deepStrictEqual(parseArticleList("<html></html>", "光伏们"), []);
    assert.deepStrictEqual(parseArticleList("not html", "光伏们"), []);
  });
});
