import { Router } from "express";
import db from "../db.js";

const router = Router();

function parseRow(row) {
  if (!row) return row;
  return {
    ...row,
    entities: row.entities ? JSON.parse(row.entities) : [],
    features: row.features ? JSON.parse(row.features) : []
  };
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
      search
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

    const where = conditions.join(" AND ");
    const limit = parseInt(pageSize, 10);
    const offset = (parseInt(page, 10) - 1) * limit;

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM insights WHERE ${where}`).get(...params);
    const rows = db.prepare(
      `SELECT * FROM insights WHERE ${where} ORDER BY publish_date DESC, id DESC LIMIT ? OFFSET ?`
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

export default router;
