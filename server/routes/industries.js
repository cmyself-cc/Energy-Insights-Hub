import { Router } from "express";
import db from "../db.js";
import { fetchWithTimeout } from "../crawlers/utils.js";

const router = Router();

// List all industry categories
router.get("/", (_req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM industry_categories ORDER BY name ASC").all();
    // Parse keywords JSON for each row
    const data = rows.map(row => ({
      ...row,
      keywords: JSON.parse(row.keywords || "[]")
    }));
    res.json({ data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create new category
router.post("/", (req, res) => {
  try {
    const { name, keywords } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Name is required" });
    }
    const keywordArray = Array.isArray(keywords) ? keywords : [];
    const result = db.prepare(
      "INSERT INTO industry_categories (name, keywords, active) VALUES (?, ?, 1)"
    ).run(name.trim(), JSON.stringify(keywordArray));
    res.json({ data: { id: result.lastInsertRowid, name: name.trim(), keywords: keywordArray } });
  } catch (e) {
    if (e.message.includes("UNIQUE")) {
      return res.status(409).json({ error: "Category name already exists" });
    }
    res.status(500).json({ error: e.message });
  }
});

// Update category
router.put("/:id", (req, res) => {
  try {
    const { name, keywords, active } = req.body;
    const existing = db.prepare("SELECT * FROM industry_categories WHERE id = ?").get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: "Category not found" });
    }

    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push("name = ?");
      values.push(name.trim());
    }
    if (keywords !== undefined) {
      updates.push("keywords = ?");
      values.push(JSON.stringify(Array.isArray(keywords) ? keywords : []));
    }
    if (active !== undefined) {
      updates.push("active = ?");
      values.push(active ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    updates.push("updated_at = CURRENT_TIMESTAMP");
    values.push(req.params.id);

    db.prepare(`UPDATE industry_categories SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    res.json({ data: { success: true } });
  } catch (e) {
    if (e.message.includes("UNIQUE")) {
      return res.status(409).json({ error: "Category name already exists" });
    }
    res.status(500).json({ error: e.message });
  }
});

// Delete category
router.delete("/:id", (req, res) => {
  try {
    const existing = db.prepare("SELECT * FROM industry_categories WHERE id = ?").get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: "Category not found" });
    }
    db.prepare("DELETE FROM industry_categories WHERE id = ?").run(req.params.id);
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Suggest keywords via LLM
router.post("/suggest-keywords", async (req, res) => {
  try {
    const { keyword } = req.body;
    if (!keyword || !keyword.trim()) {
      return res.status(400).json({ error: "keyword is required" });
    }

    const config = {
      providerId: process.env.LLM_PROVIDER || "openai",
      baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
      modelId: process.env.LLM_MODEL || "gpt-4o-mini",
      apiKey: process.env.LLM_API_KEY
    };

    if (!config.apiKey) {
      return res.status(500).json({ error: "LLM_API_KEY is not configured" });
    }

    const isAnthropic = config.providerId === "anthropic";
    const url = isAnthropic
      ? `${config.baseUrl}/messages`
      : `${config.baseUrl}/chat/completions`;

    const headers = isAnthropic
      ? {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01"
        }
      : {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`
        };

    const prompt = `你是能源行业分析师。请为"${keyword.trim()}"这个业务方向，列出10个语义最相近或最相关的行业关键词，用于文章内容筛选。要求：每个关键词2-8字，中文，具体且实用。只返回JSON数组，不要其他内容。`;

    const body = {
      model: config.modelId,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
      temperature: 0.7
    };

    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    }, 60000);

    if (!response.ok) {
      throw new Error(`LLM API failed: ${response.status}`);
    }

    const data = await response.json();
    let txt;
    if (isAnthropic) {
      txt = data.content?.[0]?.text || "";
    } else {
      txt = data.choices?.[0]?.message?.content || "";
    }

    const cleanTxt = txt.replace(/```json\s*|\s*```/g, "").trim();
    const keywords = JSON.parse(cleanTxt);

    if (!Array.isArray(keywords)) {
      throw new Error("LLM did not return an array");
    }

    res.json({ data: { keywords } });
  } catch (e) {
    console.error("Suggest keywords failed:", e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
