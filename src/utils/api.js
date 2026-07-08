import { storage } from "./storage";

let _idCounter = 0;
const generateId = () => `insight_${Date.now()}_${++_idCounter}`;

/**
 * Build request options based on provider type.
 * Anthropic uses /messages with x-api-key header;
 * everything else uses /chat/completions with Bearer token (OpenAI-compatible).
 */
function buildRequest(config, messages, maxTokens = 2000, temperature = 0.7) {
  const isAnthropic = config.providerId === "anthropic";

  const url = isAnthropic
    ? `${config.baseUrl}/messages`
    : `${config.baseUrl}/chat/completions`;

  const headers = isAnthropic
    ? {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      }
    : {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      };

  const body = isAnthropic
    ? {
        model: config.modelId,
        messages,
        max_tokens: maxTokens,
        temperature
      }
    : {
        model: config.modelId,
        messages,
        max_tokens: maxTokens,
        temperature
      };

  return { url, headers, body };
}

/** Extract text from the response regardless of provider format. */
function extractContent(data, config) {
  if (config.providerId === "anthropic") {
    // Anthropic returns { content: [{ type: "text", text: "..." }] }
    return data.content?.[0]?.text || "";
  }
  // OpenAI-compatible
  return data.choices?.[0]?.message?.content || "";
}

export const api = {
  fetchInsights: async (filters, language = "en") => {
    const config = storage.getApiConfig();
    if (!config || !config.apiKey) {
      throw new Error("API_KEY_REQUIRED");
    }

    const {
      selectedFocus,
      selectedRegions,
      search,
      timeRange = "noLimit",
      dateRange,
      businessDomain,
      enterpriseType,
      sourceType
    } = filters;
    const focusStr = selectedFocus?.length ? selectedFocus.join(", ") : "all energy topics";
    const regionStr = selectedRegions?.length ? selectedRegions.join(", ") : "globally";
    const searchStr = search?.trim() ? ` specifically about "${search.trim()}"` : "";
    const businessDomainStr = businessDomain && businessDomain !== "all" ? ` in the business domain "${businessDomain}"` : "";
    const enterpriseTypeStr = enterpriseType && enterpriseType !== "all" ? ` involving enterprise type "${enterpriseType}"` : "";
    const sourceTypeStr = sourceType && sourceType !== "all" ? ` from source type "${sourceType}"` : "";

    // Map new dateRange values (from the Competitive Intelligence UI) to days / legacy timeRange.
    const dateRangeDays = {
      yesterday: 1,
      last7: 7,
      last30: 30,
      last90: 90,
      last180: 180
    };
    const effectiveDays = dateRange ? dateRangeDays[dateRange] : null;

    const now = new Date();
    const cutoffDate = (daysBack) => {
      const d = new Date(now);
      d.setDate(d.getDate() - daysBack);
      return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    };
    const timeRangeMap = {
      pastWeek:    `published on or after ${cutoffDate(7)}`,
      pastMonth:   `published on or after ${cutoffDate(30)}`,
      past3Months: `published on or after ${cutoffDate(90)}`,
      pastYear:    `published on or after ${cutoffDate(365)}`,
      noLimit:     "",
    };
    const timeConstraint = effectiveDays
      ? `published on or after ${cutoffDate(effectiveDays)}`
      : timeRangeMap[timeRange] || "";

    // Only search when there's a query
    let searchResults = "";
    if (search?.trim()) {
      try {
        const searchController = new AbortController();
        const timeoutId = setTimeout(() => searchController.abort(), 10000);
        searchResults = await api.search(search.trim(), language, searchController.signal);
        clearTimeout(timeoutId);
      } catch (error) {
        if (error.name === "AbortError") {
          console.log("Search request timed out");
        } else {
          console.log("Search API error:", error);
        }
        searchResults = "";
      }
    }

    const hasSearch = !!searchResults;
    const timeNote = timeConstraint ? ` (${timeConstraint})` : "";
    const prompt = `You are an energy industry analyst. Provide 8 of the latest and most important energy insights${searchStr} focused on: ${focusStr}, covering regions: ${regionStr}${businessDomainStr}${enterpriseTypeStr}${sourceTypeStr}${timeNote}.

${hasSearch ? `Relevant search results — use these as your primary sources. Extract titles, facts, and URLs directly from these results:
${searchResults}
` : ""}

Requirements:
1. Return ONLY a valid JSON array (no markdown, no explanation)
2. Exactly 8 objects with these fields:
   - title: string (in ${language === "zh" ? "Chinese" : "English"})
   - summary: string (2-3 sentences, data-driven, in ${language === "zh" ? "Chinese" : "English"})
   - source: string (publication name, e.g. Reuters, Bloomberg, IEA, S&P Global)
   - date: string (article publication date in "Month DD, YYYY"${timeConstraint ? `, ${timeConstraint}` : ", within last 30 days from March 2026"})
   - tags: array of 1-3 strings (in ${language === "zh" ? "Chinese" : "English"})
   - url: string${hasSearch ? ' (copy the exact URL from the matching search result above — must be a direct article link, not a homepage or category page)' : ' (leave as empty string ""; do NOT fabricate or guess any URL)'}
   - businessDomain: string (in ${language === "zh" ? "Chinese" : "English"}, e.g. 能源转型 / Energy Transition, 化工 / Chemicals, 收并购 / M&A)
   - enterpriseType: string (in ${language === "zh" ? "Chinese" : "English"}, e.g. 国有企业 / SOE, 民营企业 / Private, 中石油 / PetroChina, 宁德时代 / CATL)
   - sourceType: string (in ${language === "zh" ? "Chinese" : "English"}, e.g. 微信公众号 / WeChat Official Account, 新闻门户 / News Portal)
   - entities: array of 2-5 strings (key companies, organizations, or technologies mentioned, in ${language === "zh" ? "Chinese" : "English"})
   - features: array of 1-3 strings (category tags like 化工 / Chemicals, LNG, 电力/氢能 / Power & Hydrogen, in ${language === "zh" ? "Chinese" : "English"})
3. All content should be in ${language === "zh" ? "Chinese" : "English"}
4. CRITICAL for URLs: ${hasSearch ? 'Only use URLs that appear verbatim in the search results above. If a result has no matching URL, set url to "". Never construct or modify URLs.' : 'Always set url to "" — never invent URLs.'}`;

    const messages = [{ role: "user", content: prompt }];
    const { url, headers, body } = buildRequest(config, messages, 2500, 0.7);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `API_CALL_FAILED (HTTP ${response.status})`);
      }

      const data = await response.json();
      const txt = extractContent(data, config);

      // Clean markdown code block markers
      const cleanTxt = txt.replace(/```json\s*|\s*```/g, "").trim();

      let newItems;
      try {
        newItems = JSON.parse(cleanTxt);
      } catch (parseError) {
        console.error("JSON parse error:", parseError, "Raw text:", cleanTxt);
        throw new Error("INVALID_RESPONSE");
      }

      if (!Array.isArray(newItems)) {
        throw new Error("INVALID_RESPONSE_ARRAY");
      }

      // Validate, clean URLs, and assign unique IDs
      return newItems.map((item, index) => {
        if (!item || typeof item !== "object") {
          console.warn(`Item ${index} is not an object:`, item);
          return { id: generateId(), title: "Invalid Item", summary: "", source: "", date: "", tags: [], url: "" };
        }
        if (item.url && !item.url.startsWith("http")) {
          item.url = "";
        }
        return { ...item, id: item.id || generateId() };
      });
    } catch (error) {
      console.error("Fetch insights error:", error);
      throw error;
    }
  },

  generateNewsletter: async (cart, language = "en") => {
    const config = storage.getApiConfig();
    if (!config || !config.apiKey) {
      throw new Error("API_KEY_REQUIRED");
    }

    const itemsText = cart
      .map(
        (item, i) =>
          `${i + 1}. ${item.title}\n${item.summary}\nSource: ${item.source} | ${item.date}\nTags: ${item.tags?.join(", ")}\n${item.url ? `URL: ${item.url}` : ""}`
      )
      .join("\n\n");

    const isZh = language === "zh";
    const today = new Date().toLocaleDateString(isZh ? "zh-CN" : "en-US", {
      year: "numeric", month: "long", day: "numeric"
    });
    const titleLabel = isZh ? "执行摘要" : "Executive Summary";
    const insightsLabel = isZh ? "核心洞察" : "Key Insights";
    const happenedLabel = isZh ? "事件概述" : "What Happened";
    const policyLabel = isZh ? "政策与实施" : "Policy & Implementation";
    const milestonesLabel = isZh ? "关键里程碑" : "Key Milestones";
    const implicationsLabel = isZh ? "战略影响" : "Strategic Implications";
    const outlookLabel = isZh ? "建议关注点" : "Key Watchpoints";
    const dataLabel = isZh ? "数据汇总" : "Data Summary";
    const metricLabel = isZh ? "指标" : "Metric";
    const valueLabel = isZh ? "数值" : "Value";
    const contextLabel = isZh ? "背景" : "Context";
    const regionalLabel = isZh ? "区域焦点" : "Regional Focus";
    const technologyLabel = isZh ? "技术趋势" : "Technology Trends";
    const sourcesLabel = isZh ? "来源清单" : "Source List";

    const prompt = `You are a senior energy analyst writing an in-depth executive newsletter in ${isZh ? "Chinese" : "English"}. Your analysis must be comprehensive, data-rich, and actionable. You are writing for C-level executives and industry experts, so your analysis should be sophisticated yet accessible.

Based on these insights:
${itemsText}

Write a detailed executive newsletter with the following structure:

# Energy Insights — ${today}
> [Write a concise subtitle of 5-10 words in ${isZh ? "Chinese" : "English"} that captures the specific topic or theme of these insights, e.g. "${isZh ? "潍柴动力战略与业务布局" : "Global Clean Energy Investment Trends"}"]

## ${titleLabel}
[3-5 comprehensive sentences synthesizing key themes, critical market shifts, and strategic implications with specific data points.]

---

## ${insightsLabel}

For each insight, provide a structured analysis:

### [Title]

**${happenedLabel}:**
[2-3 sentences with specific data - capacity MW/GW, investment $, percentages, timelines, main actors, geographic scope.]

**${policyLabel}:**
[Policy mechanisms: subsidies, tariffs, regulations, incentives, implementation approach, governance structure.]

**${milestonesLabel}:**
- [Date/Period]: [Milestone description with specific details]
- [Date/Period]: [Milestone description with specific details]
- [Date/Period]: [Milestone description with specific details]

**${implicationsLabel}:**
[2-3 sentences on market positioning, competitive dynamics, supply chain implications, technology trajectory.]

---

## ${regionalLabel}
[Analyze regional trends and developments. Compare regions and highlight regional-specific opportunities and challenges.]

## ${technologyLabel}
[Identify and analyze key technology trends. Discuss technological advancements, innovation drivers, and impact on the energy sector.]

## ${outlookLabel}
[4-5 sentences covering near-term developments (6-12 months), medium-term shifts (1-3 years), key indicators to monitor, actionable recommendations.]

---

## ${dataLabel}
| ${metricLabel} | ${valueLabel} | ${contextLabel} |
|---|---|---|
| [Capacity/Investment/etc.] | [Value with unit] | [Project/Region/Company] |
| [Timeline] | [Date/Period] | [Milestone type] |
| [Percentage/Target] | [Value] | [Context] |
| [Policy Impact] | [Description] | [Region/Industry] |
| [Technology Adoption] | [Rate/Level] | [Market Segment] |

Formatting Requirements:
1. Write ONLY in ${isZh ? "Chinese" : "English"} - do not include both languages
2. Use clear, hierarchical section headers
3. Preserve ALL numbers, units, dates, and percentages exactly as provided
4. Use bullet points for milestones and structured lists
5. Bold key metrics and important findings using **text**
6. No redundant phrases or filler content
7. Professional energy industry terminology throughout
8. Include specific data points and concrete examples wherever possible
9. Provide balanced analysis that acknowledges both opportunities and challenges
10. End with actionable recommendations that executives can implement`;

    const messages = [{ role: "user", content: prompt }];
    const { url, headers, body } = buildRequest(config, messages, 6000, 0.7);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `API_CALL_FAILED (HTTP ${response.status})`);
      }

      const data = await response.json();
      const content = extractContent(data, config);

      // Append a sources section built directly from cart data (reliable, no LLM hallucination)
      const sourceLines = cart.map((item, i) => {
        const titlePart = item.url ? `[${item.title}](${item.url})` : item.title;
        const meta = [item.source, item.date].filter(Boolean).join(" | ");
        return `${i + 1}. ${titlePart}${meta ? " — " + meta : ""}`;
      }).join("\n");
      const sourcesSection = `\n\n---\n\n## ${sourcesLabel}\n\n${sourceLines}`;
      return content + sourcesSection;
    } catch (error) {
      console.error("Generate newsletter error:", error);
      throw error;
    }
  },

  interpretArticle: async (item, question = "", language = "en", history = [], signal = null) => {
    const config = storage.getApiConfig();
    if (!config || !config.apiKey) {
      throw new Error("API_KEY_REQUIRED");
    }

    const isZh = language === "zh";
    const systemPrompt = isZh
      ? "你是一位能源行业分析师。请基于提供的文章信息给出专业、简洁的解读。"
      : "You are an energy industry analyst. Provide a professional, concise interpretation based on the article information provided.";

    const articleContext = `Title: ${item.title}
Summary: ${item.summary || ""}
Source: ${item.source || ""}
Date: ${item.date || ""}
Business Domain: ${item.businessDomain || ""}
Enterprise Type: ${item.enterpriseType || ""}
Source Type: ${item.sourceType || ""}
Entities: ${item.entities?.join(", ") || ""}
Features: ${item.features?.join(", ") || ""}
URL: ${item.url || ""}`;

    let userPrompt;
    if (!question) {
      userPrompt = isZh
        ? `请解读以下文章，提炼核心观点、战略影响、涉及主体及关键数据：\n\n${articleContext}`
        : `Please interpret the following article, extracting key points, strategic implications, involved parties, and key data points:\n\n${articleContext}`;
    } else {
      const historyText = history.map(h => `Q: ${h.question}\nA: ${h.answer}`).join("\n\n");
      userPrompt = isZh
        ? `基于以下文章信息${historyText ? "和此前的问答" : ""}回答问题。\n\n${articleContext}\n\n${historyText ? "此前问答：\n" + historyText + "\n\n" : ""}问题：${question}`
        : `Based on the article information below${historyText ? " and previous Q&A" : ""}, answer the question.\n\n${articleContext}\n\n${historyText ? "Previous Q&A:\n" + historyText + "\n\n" : ""}Question: ${question}`;
    }

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ];

    const { url, headers, body } = buildRequest(config, messages, 2000, 0.7);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `API_CALL_FAILED (HTTP ${response.status})`);
      }

      const data = await response.json();
      return extractContent(data, config);
    } catch (error) {
      console.error("Interpret article error:", error);
      throw error;
    }
  },

  search: async (query, _language = "en", signal = null) => {
    const config = storage.getSearchConfig();
    if (!config || !config.apiKey) {
      return "";
    }

    try {
      let response, results;
      const fetchOptions = {
        method: "POST",
        headers: {},
        body: "",
        signal
      };

      if (config.providerId === "tavily") {
        fetchOptions.headers = {
          "Content-Type": "application/json",
          Authorization: config.apiKey
        };
        fetchOptions.body = JSON.stringify({
          query: query,
          search_depth: "basic",
          max_results: 5,
          include_answer: false
        });

        response = await fetch(config.baseUrl, fetchOptions);

        if (response.ok) {
          const data = await response.json();
          results =
            data.results
              ?.map((r) => `Title: ${r.title}\nSnippet: ${r.content || r.snippet}\nURL: ${r.url}`)
              .join("\n\n") || "";
        } else {
          console.error("Tavily API error:", response.status, await response.text());
          return "";
        }
      } else if (config.providerId === "serper") {
        fetchOptions.headers = {
          "Content-Type": "application/json",
          "X-API-KEY": config.apiKey
        };
        fetchOptions.body = JSON.stringify({
          q: query,
          num: 5
        });

        response = await fetch(config.baseUrl, fetchOptions);

        if (response.ok) {
          const data = await response.json();
          results =
            data.organic
              ?.map((r) => `Title: ${r.title}\nSnippet: ${r.snippet}\nURL: ${r.link}`)
              .join("\n\n") || "";
        } else {
          console.error("Serper API error:", response.status, await response.text());
          return "";
        }
      }

      return results || "";
    } catch (error) {
      if (error.name === "AbortError") {
        throw error;
      }
      console.error("Search error:", error);
      return "";
    }
  }
};
