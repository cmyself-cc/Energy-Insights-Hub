import { describe, it, beforeEach, expect } from "vitest";
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
    const result = importSources([{ name: "嘉实多", type: "wechat_mcp", identifier: "castrolchina", url: "" }], "append");
    expect(result.imported).toBe(1);
    expect(db.prepare("SELECT COUNT(*) as c FROM sources").get().c).toBe(1);
  });

  it("skips duplicates in append mode", () => {
    importSources([{ name: "嘉实多", type: "wechat_mcp", identifier: "castrolchina", url: "" }], "append");
    const result = importSources([{ name: "嘉实多", type: "wechat_mcp", identifier: "castrolchina", url: "" }], "append");
    expect(result.skipped).toBe(1);
  });

  it("defaults url to empty string when not provided", () => {
    importSources([{ name: "嘉实多", type: "wechat_mcp", identifier: "castrolchina", url: "" }], "append");
    const row = db.prepare("SELECT url FROM sources WHERE name = ?").get("嘉实多");
    expect(row.url).toBe("");
  });

  it("uses explicit url when provided", () => {
    importSources([{ name: "Example", type: "website", identifier: "", url: "https://example.com/feed" }], "append");
    const row = db.prepare("SELECT url FROM sources WHERE name = ?").get("Example");
    expect(row.url).toBe("https://example.com/feed");
  });

  it("replaces previously imported sources in replace mode", () => {
    importSources([{ name: "Old Source", type: "wechat_mcp", identifier: "old", url: "" }], "append");
    const result = importSources([{ name: "New Source", type: "wechat_mcp", identifier: "new", url: "" }], "replace");
    expect(result.imported).toBe(1);
    expect(db.prepare("SELECT COUNT(*) as c FROM sources").get().c).toBe(1);
    expect(db.prepare("SELECT COUNT(*) as c FROM source_imports").get().c).toBe(1);
    const names = db.prepare("SELECT name FROM sources").all().map(r => r.name);
    expect(names).toEqual(["New Source"]);
  });

  it("accepts supported source types", () => {
    expect(normalizeImportType({ name: "A", type: "wechat_mcp" })).toEqual({ name: "A", type: "wechat_mcp" });
    expect(normalizeImportType({ name: "B", type: "website" })).toEqual({ name: "B", type: "website" });
  });

  it("rejects unsupported source types", () => {
    expect(() => normalizeImportType({ name: "C", type: "rss" })).toThrow(ImportValidationError);
    expect(() => normalizeImportType({ name: "D", type: "api" })).toThrow(/Unsupported source type: api/);
  });
});
