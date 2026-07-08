import { Router } from "express";
import db from "../db.js";

const router = Router();

const DEFAULTS = {
  lookback_hours: "24",
  max_per_source: "3",
  include_business_domains: "",
  include_enterprise_types: "",
  include_categories: "",
  exclude_keywords: "股票,证券,股市,行情,广告,推广,赞助"
};

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return [];
  return value.split(",").map(s => s.trim()).filter(Boolean);
}

function loadSettings() {
  const rows = db.prepare("SELECT key, value FROM tracker_settings").all();
  const map = { ...DEFAULTS };
  for (const row of rows) map[row.key] = row.value;

  return {
    lookbackHours: parseInt(map.lookback_hours, 10) || 24,
    maxPerSource: parseInt(map.max_per_source, 10) || 3,
    includeBusinessDomains: toArray(map.include_business_domains),
    includeEnterpriseTypes: toArray(map.include_enterprise_types),
    includeCategories: toArray(map.include_categories),
    excludeKeywords: toArray(map.exclude_keywords)
  };
}

router.get("/", (_req, res) => {
  try {
    res.json({ data: loadSettings() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/", (req, res) => {
  try {
    const {
      lookbackHours,
      maxPerSource,
      includeBusinessDomains,
      includeEnterpriseTypes,
      includeCategories,
      excludeKeywords
    } = req.body;

    if (typeof lookbackHours !== "number" || lookbackHours < 1 || lookbackHours > 168) {
      return res.status(400).json({ error: "lookbackHours must be between 1 and 168" });
    }
    if (typeof maxPerSource !== "number" || maxPerSource < 1 || maxPerSource > 50) {
      return res.status(400).json({ error: "maxPerSource must be between 1 and 50" });
    }

    const values = {
      lookback_hours: String(lookbackHours),
      max_per_source: String(maxPerSource),
      include_business_domains: toArray(includeBusinessDomains).join(","),
      include_enterprise_types: toArray(includeEnterpriseTypes).join(","),
      include_categories: toArray(includeCategories).join(","),
      exclude_keywords: toArray(excludeKeywords).join(",")
    };

    const update = db.prepare(
      "INSERT INTO tracker_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP"
    );
    const tx = db.transaction((vals) => {
      for (const [key, value] of Object.entries(vals)) update.run(key, value);
    });
    tx(values);

    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export { loadSettings };
export default router;
