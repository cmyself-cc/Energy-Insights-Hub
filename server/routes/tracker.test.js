import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import express from "express";
import db, { initDb } from "../db.js";
import trackerRouter from "./tracker.js";

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/tracker", trackerRouter);
  return app;
}

function base64Json(payload) {
  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
}

async function startServer(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", (err) => {
      if (err) return reject(err);
      resolve(server);
    });
  });
}

async function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function importConfig(server, payload, mode = "append") {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/tracker/import-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file: base64Json(payload),
      filename: "config.json",
      mode
    })
  });
  return res.json();
}

function resetTables() {
  db.prepare("DELETE FROM filter_rules").run();
  db.prepare("DELETE FROM business_categories").run();
  db.prepare("DELETE FROM filter_config").run();
  db.prepare("DELETE FROM sources").run();
  db.prepare("DELETE FROM source_imports").run();
  db.prepare("DELETE FROM tracker_runs").run();
}

describe("tracker router /import-config", () => {
  let server;

  beforeEach(async () => {
    initDb();
    resetTables();
    server = await startServer(buildApp());
  });

  afterEach(async () => {
    if (server) await stopServer(server);
  });

  it("append mode skips duplicate categories and rules", async () => {
    const payload = {
      excludeKeywords: ["duplicate"],
      compositeRules: [
        { name: "composite", mustInclude: ["a", "b"], mustExclude: ["c"] }
      ],
      categories: [
        { name: "UniqueCategory", description: "d", inclusionPrompt: "p" }
      ],
      sources: []
    };

    const first = await importConfig(server, payload, "append");
    assert.strictEqual(first.data.rulesImported, 2);
    assert.strictEqual(first.data.categoriesImported, 1);
    assert.strictEqual(first.data.sourcesImported, 0);

    const second = await importConfig(server, payload, "append");
    assert.strictEqual(second.data.rulesImported, 0);
    assert.strictEqual(second.data.categoriesImported, 0);
    assert.strictEqual(second.data.sourcesImported, 0);

    assert.strictEqual(db.prepare("SELECT COUNT(*) AS c FROM filter_rules").get().c, 2);
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS c FROM business_categories").get().c, 1);
  });

  it("append mode counts reflect actual inserts for partial duplicates", async () => {
    const firstPayload = {
      excludeKeywords: ["dup"],
      compositeRules: [{ mustInclude: ["x"], mustExclude: [] }],
      categories: [{ name: "A", description: "d", inclusionPrompt: "p" }],
      sources: []
    };

    const first = await importConfig(server, firstPayload, "append");
    assert.strictEqual(first.data.rulesImported, 2);
    assert.strictEqual(first.data.categoriesImported, 1);

    const secondPayload = {
      excludeKeywords: ["dup", "new"],
      compositeRules: [
        { mustInclude: ["x"], mustExclude: [] },
        { mustInclude: ["y"], mustExclude: [] }
      ],
      categories: [
        { name: "A", description: "d", inclusionPrompt: "p" },
        { name: "B", description: "d", inclusionPrompt: "p" }
      ],
      sources: []
    };

    const second = await importConfig(server, secondPayload, "append");
    assert.strictEqual(second.data.rulesImported, 2);
    assert.strictEqual(second.data.categoriesImported, 1);

    assert.strictEqual(db.prepare("SELECT COUNT(*) AS c FROM filter_rules").get().c, 4);
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS c FROM business_categories").get().c, 2);
  });

  it("append mode updates existing categories with new description and prompt", async () => {
    db.prepare(
      "INSERT INTO business_categories (name, description, inclusion_prompt, active) VALUES (?, ?, ?, 1)"
    ).run("ExistingCategory", "old description", "old prompt");

    const result = await importConfig(
      server,
      {
        excludeKeywords: [],
        categories: [{ name: "ExistingCategory", description: "new description", inclusionPrompt: "new prompt" }],
        sources: []
      },
      "append"
    );

    assert.strictEqual(result.data.categoriesImported, 0);

    const row = db.prepare("SELECT description, inclusion_prompt FROM business_categories WHERE name = ?").get("ExistingCategory");
    assert.strictEqual(row.description, "new description");
    assert.strictEqual(row.inclusion_prompt, "new prompt");
  });

  it("append mode preserves the active flag of an existing disabled category", async () => {
    db.prepare(
      "INSERT INTO business_categories (name, description, inclusion_prompt, active) VALUES (?, ?, ?, 0)"
    ).run("DisabledCategory", "old description", "old prompt");

    const result = await importConfig(
      server,
      {
        excludeKeywords: [],
        categories: [{ name: "DisabledCategory", description: "new description", inclusionPrompt: "new prompt" }],
        sources: []
      },
      "append"
    );

    assert.strictEqual(result.data.categoriesImported, 0);

    const row = db.prepare("SELECT description, inclusion_prompt, active FROM business_categories WHERE name = ?").get("DisabledCategory");
    assert.strictEqual(row.description, "new description");
    assert.strictEqual(row.inclusion_prompt, "new prompt");
    assert.strictEqual(row.active, 0);
  });

  it("replace mode clears existing rules and categories before inserting", async () => {
    await importConfig(
      server,
      {
        excludeKeywords: ["old"],
        categories: [{ name: "OldCategory", description: "d", inclusionPrompt: "p" }],
        sources: []
      },
      "append"
    );

    const replace = await importConfig(
      server,
      {
        excludeKeywords: ["new"],
        compositeRules: [{ mustInclude: ["z"], mustExclude: [] }],
        categories: [{ name: "NewCategory", description: "d", inclusionPrompt: "p" }],
        sources: []
      },
      "replace"
    );

    assert.strictEqual(replace.data.rulesImported, 2);
    assert.strictEqual(replace.data.categoriesImported, 1);
    assert.strictEqual(replace.data.sourcesImported, 0);

    const categories = db.prepare("SELECT name FROM business_categories").all().map((r) => r.name);
    assert.deepStrictEqual(categories, ["NewCategory"]);

    const ruleNames = db.prepare("SELECT name FROM filter_rules").all().map((r) => r.name);
    assert.strictEqual(ruleNames.length, 2);
    assert.ok(ruleNames.includes("new"));
    assert.ok(ruleNames.includes(null));
  });
});
