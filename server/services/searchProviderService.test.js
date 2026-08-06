import { describe, it, expect, beforeEach } from "vitest";
import db, { initDb } from "../db.js";
import {
  listSearchProviders, createSearchProvider, updateSearchProvider, deleteSearchProvider,
  activateSearchProvider, getActiveSearchProvider, seedSearchProviders
} from "./searchProviderService.js";

describe("searchProviderService", () => {
  beforeEach(() => {
    initDb();
    db.prepare("DELETE FROM search_providers").run();
  });

  it("creates a provider and lists it with a masked key only", () => {
    const created = createSearchProvider({ name: "博查", providerType: "bocha", apiKey: "api-key-abc123" });
    expect(created.id).toBeGreaterThan(0);
    const rows = listSearchProviders();
    expect(rows).toHaveLength(1);
    expect(rows[0].api_key).toBeUndefined();
    expect(rows[0].api_key_masked).not.toContain("abc123");
    expect(rows[0].api_key_masked).toContain("…");
  });

  it("activates one provider at a time", () => {
    const a = createSearchProvider({ name: "A", providerType: "bocha", apiKey: "key-a" });
    const b = createSearchProvider({ name: "B", providerType: "tavily", apiKey: "key-b" });
    activateSearchProvider(a.id);
    activateSearchProvider(b.id);
    const active = getActiveSearchProvider();
    expect(active.id).toBe(b.id);
    expect(active.api_key).toBe("key-b");
  });

  it("keeps the existing key when updating without a new one", () => {
    const a = createSearchProvider({ name: "A", providerType: "bocha", apiKey: "secret-1" });
    activateSearchProvider(a.id);
    updateSearchProvider(a.id, { name: "A2" });
    const active = getActiveSearchProvider();
    expect(active.api_key).toBe("secret-1");
    expect(active.name).toBe("A2");
  });

  it("cannot delete the active provider", () => {
    const a = createSearchProvider({ name: "A", providerType: "bocha", apiKey: "key-a" });
    activateSearchProvider(a.id);
    expect(() => deleteSearchProvider(a.id)).toThrow(/active/i);
  });

  it("deletes an inactive provider", () => {
    const a = createSearchProvider({ name: "A", providerType: "bocha", apiKey: "key-a" });
    const b = createSearchProvider({ name: "B", providerType: "tavily", apiKey: "key-b" });
    deleteSearchProvider(a.id);
    expect(listSearchProviders().some(p => p.id === a.id)).toBe(false);
  });

  it("seeds bocha and tavily providers once from env keys", () => {
    process.env.BOCHA_API_KEY = "bocha-env";
    process.env.TAVILY_API_KEY = "tavily-env";
    seedSearchProviders();
    expect(listSearchProviders().length).toBeGreaterThanOrEqual(2);
    const bocha = getActiveSearchProvider();
    expect(bocha.provider_type).toBe("bocha");
    seedSearchProviders();
    expect(listSearchProviders().length).toBeGreaterThanOrEqual(2);
  });
});
