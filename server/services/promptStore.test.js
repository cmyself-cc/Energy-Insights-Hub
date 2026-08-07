import { describe, it, expect, beforeEach } from "vitest";
import db, { initDb } from "../db.js";
import {
  DEFAULT_PROMPTS, getPrompt, setPrompt, seedLlmPrompts, fillPrompt, PROMPT_KEYS
} from "./promptStore.js";

describe("promptStore", () => {
  beforeEach(() => {
    initDb();
    // Self-heal: an interrupted drop/rename test in a previous run may have left
    // the table missing (migrations are already recorded, so initDb skips it).
    db.exec("CREATE TABLE IF NOT EXISTS llm_prompts (key TEXT PRIMARY KEY, content TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    db.prepare("DELETE FROM llm_prompts").run();
  });

  it("fillPrompt replaces placeholders and leaves unknown ones untouched", () => {
    const out = fillPrompt("A {{x}} B {{x}} C {{y}}", { x: "1" });
    expect(out).toBe("A 1 B 1 C {{y}}");
  });

  it("getPrompt falls back to the code default when no DB row exists", () => {
    expect(getPrompt("insight_extraction")).toBe(DEFAULT_PROMPTS.insight_extraction.content);
    expect(getPrompt("feedback_suggestions")).toBe(DEFAULT_PROMPTS.feedback_suggestions.content);
  });

  it("getPrompt returns null for an unknown key", () => {
    expect(getPrompt("no_such_key")).toBeNull();
  });

  it("seedLlmPrompts inserts all defaults exactly once", () => {
    seedLlmPrompts();
    seedLlmPrompts();
    const rows = db.prepare("SELECT key FROM llm_prompts").all().map(r => r.key).sort();
    expect(rows).toEqual([...PROMPT_KEYS].sort());
  });

  it("seed never overwrites user-edited prompts", () => {
    seedLlmPrompts();
    db.prepare("UPDATE llm_prompts SET content = '已手工调优' WHERE key = 'insight_extraction'").run();
    seedLlmPrompts();
    expect(getPrompt("insight_extraction")).toBe("已手工调优");
  });

  it("setPrompt upserts and getPrompt prefers the DB row", () => {
    setPrompt("screen_cards", "版本A");
    expect(getPrompt("screen_cards")).toBe("版本A");
    setPrompt("screen_cards", "版本B");
    expect(getPrompt("screen_cards")).toBe("版本B");
    const rows = db.prepare("SELECT * FROM llm_prompts WHERE key = 'screen_cards'").all();
    expect(rows).toHaveLength(1);
  });

  it("getPrompt falls back to defaults when the table does not exist yet", () => {
    db.exec("ALTER TABLE llm_prompts RENAME TO llm_prompts_bak");
    try {
      expect(getPrompt("insight_extraction")).toBe(DEFAULT_PROMPTS.insight_extraction.content);
      expect(getPrompt("no_such_key")).toBeNull();
    } finally {
      db.exec("ALTER TABLE llm_prompts_bak RENAME TO llm_prompts");
    }
  });

  it("has a default prompt for every documented key", () => {
    for (const key of PROMPT_KEYS) {
      expect(DEFAULT_PROMPTS[key]?.content?.length, key).toBeGreaterThan(20);
    }
  });
});
