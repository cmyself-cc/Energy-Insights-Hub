import { Router } from "express";
import db from "../db.js";
import { recordFeedback } from "../services/feedbackService.js";

const router = Router();

function safeJson(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseRow(row) {
  if (!row) return row;
  const purposes = safeJson(row.purpose);
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    url: row.url,
    date: row.publish_date,
    publishDate: row.publish_date,
    sourceId: row.source_id,
    source: row.source_name || row.config_source_name || row.source_id,
    sourceType: row.source_type,
    businessDomain: row.business_domain,
    enterpriseType: row.enterprise_type,
    entities: safeJson(row.entities),
    features: safeJson(row.features),
    keywords: safeJson(row.keywords),
    categories: safeJson(row.categories),
    rawContent: row.raw_content,
    hidden: row.hidden,
    purposes: purposes.length > 0 ? purposes : ["competitor"]
  };
}

function buildPurposeCondition(purposeList) {
  const orConditions = [];
  const orParams = [];
  for (const p of purposeList) {
    orConditions.push("i.purpose LIKE ?");
    orParams.push(`%"${p}"%`);
    orConditions.push("i.purpose = ?");
    orParams.push(p);
  }
  // Empty/NULL purpose defaults to competitor for backward compatibility
  if (purposeList.includes("competitor")) {
    orConditions.push("(i.purpose = '' OR i.purpose IS NULL)");
  }
  return { condition: `(${orConditions.join(" OR ")})`, params: orParams };
}

router.get("/", (req, res) => {
  try {
    const {
      page = 1,
      pageSize = 24,
      hidden = "0",
      dateFrom,
      dateTo,
      businessDomain,
      enterpriseType,
      sourceType,
      search,
      purposes,
      businessCategory,
      subjectCategory
    } = req.query;

    const conditions = ["1=1"];
    const params = [];

    if (hidden === "0") {
      conditions.push("hidden = 0");
    } else if (hidden === "1") {
      conditions.push("hidden = 1");
    }

    if (dateFrom) {
      conditions.push("publish_date >= ?");
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push("publish_date <= ?");
      params.push(dateTo);
    }
    if (businessDomain) {
      conditions.push("business_domain = ?");
      params.push(businessDomain);
    }
    if (enterpriseType) {
      conditions.push("enterprise_type = ?");
      params.push(enterpriseType);
    }
    if (sourceType) {
      conditions.push("source_type = ?");
      params.push(sourceType);
    }
    if (search) {
      conditions.push("(title LIKE ? OR summary LIKE ? OR source_type LIKE ?)");
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    if (req.query.purpose) {
      const singlePurpose = req.query.purpose.trim();
      const { condition, params: pParams } = buildPurposeCondition([singlePurpose]);
      conditions.push(condition);
      params.push(...pParams);
    }

    // Multi-purpose filter: purposes=competitor,policy,tech
    if (purposes) {
      const purposeList = purposes.split(",").map(s => s.trim()).filter(Boolean);
      if (purposeList.length > 0) {
        const { condition, params: pParams } = buildPurposeCondition(purposeList);
        conditions.push(condition);
        params.push(...pParams);
      }
    }

    // Business category filter: categories JSON array contains the value
    if (businessCategory) {
      conditions.push("categories LIKE ?");
      params.push(`%"${businessCategory}"%`);
    }

    // Subject category filter: categories JSON array contains the value
    if (subjectCategory) {
      conditions.push("categories LIKE ?");
      params.push(`%"${subjectCategory}"%`);
    }

    const where = conditions.join(" AND ");
    const limit = parseInt(pageSize, 10);
    const offset = (parseInt(page, 10) - 1) * limit;

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM insights i WHERE ${where}`).get(...params);
    const rows = db.prepare(
      `SELECT i.*, s.name as config_source_name FROM insights i LEFT JOIN sources s ON i.source_id = s.id WHERE ${where} ORDER BY i.publish_date DESC, i.id DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({
      data: rows.map(parseRow),
      pagination: {
        page: parseInt(page, 10),
        pageSize: limit,
        total: countRow.total
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id", (req, res) => {
  try {
    const row = db.prepare("SELECT * FROM insights WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Insight not found" });
    res.json({ data: parseRow(row) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/hide", (req, res) => {
  try {
    db.prepare("UPDATE insights SET hidden = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/unhide", (req, res) => {
  try {
    db.prepare("UPDATE insights SET hidden = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 归类：把卡片的监控类别调整到新 purpose，并记录到反馈（用于自学习权重）
router.post("/:id/reclassify", (req, res) => {
  try {
    const { toPurpose } = req.body || {};
    const valid = ["competitor", "policy", "tech", "industry"];
    if (!valid.includes(toPurpose)) {
      return res.status(400).json({ error: `toPurpose must be one of ${valid.join(", ")}` });
    }
    const row = db.prepare("SELECT * FROM insights WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Insight not found" });

    const fromPurposes = safeJson(row.purpose);
    const fromPurpose = Array.isArray(fromPurposes) && fromPurposes.length > 0 ? fromPurposes[0] : null;
    if (fromPurpose === toPurpose) {
      return res.json({ data: parseRow(row), unchanged: true });
    }

    db.prepare("UPDATE insights SET purpose = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(JSON.stringify([toPurpose]), req.params.id);
    recordFeedback({ insightId: row.id, action: "reclassify", fromPurpose, toPurpose });

    const updated = db.prepare("SELECT * FROM insights WHERE id = ?").get(req.params.id);
    res.json({ data: parseRow(updated), fromPurpose });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
