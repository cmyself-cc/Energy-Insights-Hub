import { Router } from "express";
import db from "../db.js";
import { loadSettings, toArray } from "../lib/trackerSettings.js";

const router = Router();

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
