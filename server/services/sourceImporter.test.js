import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import db, { initDb } from "../db.js";
import { importSources, normalizeImportType, ImportValidationError } from "./sourceImporter.js";

describe("sourceImporter", () => {
  beforeEach(() => {
    initDb();
    db.prepare("DELETE FROM insights").run();
    db.prepare("DELETE FROM sources").run();
    db.prepare("DELETE FROM source_imports").run();
  });

  it("imports new sources", () => {
    const result = importSources([{ name: "嘉实多", type: "wechat", identifier: "castrolchina", url: "" }], "append");
    assert.strictEqual(result.imported, 1);
    assert.strictEqual(db.prepare("SELECT COUNT(*) as c FROM sources").get().c, 1);
  });

  it("skips duplicates in append mode", () => {
    importSources([{ name: "嘉实多", type: "wechat", identifier: "castrolchina", url: "" }], "append");
    const result = importSources([{ name: "嘉实多", type: "wechat", identifier: "castrolchina", url: "" }], "append");
    assert.strictEqual(result.skipped, 1);
  });

  it("builds wechat url from identifier when url is empty", () => {
    importSources([{ name: "嘉实多", type: "wechat", identifier: "castrolchina", url: "" }], "append");
    const row = db.prepare("SELECT url FROM sources WHERE name = ?").get("嘉实多");
    assert.strictEqual(row.url, "https://mp.weixin.qq.com/s/castrolchina");
  });

  it("uses explicit url when provided", () => {
    importSources([{ name: "Example", type: "website", identifier: "", url: "https://example.com/feed" }], "append");
    const row = db.prepare("SELECT url FROM sources WHERE name = ?").get("Example");
    assert.strictEqual(row.url, "https://example.com/feed");
  });

  it("replaces previously imported sources in replace mode", () => {
    importSources([{ name: "Old Source", type: "wechat", identifier: "old", url: "" }], "append");
    const result = importSources([{ name: "New Source", type: "wechat", identifier: "new", url: "" }], "replace");
    assert.strictEqual(result.imported, 1);
    assert.strictEqual(db.prepare("SELECT COUNT(*) as c FROM sources").get().c, 1);
    assert.strictEqual(db.prepare("SELECT COUNT(*) as c FROM source_imports").get().c, 1);
    const names = db.prepare("SELECT name FROM sources").all().map(r => r.name);
    assert.deepStrictEqual(names, ["New Source"]);
  });

  it("accepts supported source types", () => {
    assert.deepStrictEqual(normalizeImportType({ name: "A", type: "wechat" }), { name: "A", type: "wechat" });
    assert.deepStrictEqual(normalizeImportType({ name: "B", type: "website" }), { name: "B", type: "website" });
  });

  it("rejects unsupported source types", () => {
    assert.throws(
      () => normalizeImportType({ name: "C", type: "rss" }),
      ImportValidationError
    );
    assert.throws(
      () => normalizeImportType({ name: "D", type: "api" }),
      /Unsupported source type: api/
    );
  });
});
