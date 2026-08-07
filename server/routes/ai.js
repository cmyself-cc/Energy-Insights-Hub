import { Router } from "express";
import db from "../db.js";
import { fetchWithTimeout } from "../crawlers/utils.js";
import { getPrompt } from "../services/promptStore.js";

const router = Router();

/**
 * AI 解读代理：浏览器把文章上下文+问题发给服务器，服务器用配置好的模型
 * （前端只传模型 id，baseUrl/apiKey 留在服务器）调用 LLM 并返回结果。
 */
router.post("/interpret", async (req, res) => {
  try {
    const { item, question, language, history, modelId } = req.body;
    if (!item || !item.title) {
      return res.status(400).json({ error: "item is required" });
    }

    // 模型：优先 modelId，否则用 active
    let model = null;
    if (modelId) model = db.prepare("SELECT * FROM model_configs WHERE id = ?").get(modelId);
    if (!model) model = db.prepare("SELECT * FROM model_configs WHERE is_active = 1 LIMIT 1").get();
    if (!model) return res.status(400).json({ error: "No model configured" });

    const isZh = language === "zh";
    const systemPrompt = getPrompt(isZh ? "ai_interpret_zh" : "ai_interpret_en");

    const articleContext = `Title: ${item.title}
Summary: ${item.summary || ""}
Source: ${item.source || ""}
Date: ${item.date || ""}
Business Domain: ${item.businessDomain || ""}
Enterprise Type: ${item.enterpriseType || ""}
Source Type: ${item.sourceType || ""}
Entities: ${(item.entities || []).join(", ")}
Features: ${(item.features || []).join(", ")}
URL: ${item.url || ""}`;

    let userPrompt;
    if (!question) {
      userPrompt = isZh
        ? `请解读以下文章，提炼核心观点、战略影响、涉及主体及关键数据：\n\n${articleContext}`
        : `Please interpret the following article, extracting key points, strategic implications, involved parties, and key data points:\n\n${articleContext}`;
    } else {
      const historyText = (history || []).map(h => `Q: ${h.question}\nA: ${h.answer}`).join("\n\n");
      userPrompt = isZh
        ? `基于以下文章信息${historyText ? "和此前的问答" : ""}回答问题。\n\n${articleContext}\n\n${historyText ? "此前问答：\n" + historyText + "\n\n" : ""}问题：${question}`
        : `Based on the article information below${historyText ? " and previous Q&A" : ""}, answer the question.\n\n${articleContext}\n\n${historyText ? "Previous Q&A:\n" + historyText + "\n\n" : ""}Question: ${question}`;
    }

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ];

    const url = `${model.base_url.replace(/\/$/, "")}/chat/completions`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${model.api_key}`
    };
    const body = {
      model: model.model_id,
      messages,
      max_tokens: 2000,
      temperature: 0.7
    };

    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    }, 120000);

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return res.status(response.status).json({ error: `LLM API failed: ${response.status} ${errText.slice(0, 200)}` });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || data.content?.[0]?.text || "";
    res.json({ data: { content } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
