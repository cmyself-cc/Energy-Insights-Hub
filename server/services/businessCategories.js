import db from "../db.js";

export function loadCategories() {
  return db.prepare("SELECT * FROM business_categories ORDER BY name ASC").all();
}

export function loadActiveCategories() {
  return db.prepare("SELECT * FROM business_categories WHERE active = 1 ORDER BY name ASC").all();
}

export function buildCategoryPrompt(categories) {
  return categories.map(c => `- ${c.name}: ${c.inclusion_prompt}`).join("\n");
}

export function matchesEnabledCategory(insight, enabledCategories) {
  if (!enabledCategories || enabledCategories.length === 0) return true;
  const names = new Set(enabledCategories.map(c => c.name));
  const insightCategories = insight.categories || [];
  return insightCategories.some(name => names.has(name));
}
