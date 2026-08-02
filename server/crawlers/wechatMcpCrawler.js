import * as cheerio from "cheerio";
import { loadSettings } from "../lib/trackerSettings.js";

const DEFAULT_ARTICLE_LIMIT = 20;
const DEFAULT_LOOKBACK_HOURS = 720; // default 30 days to match tracker lookback

/**
 * 计算每个公众号的抓取上限。优先级：
 * 1. 源 config.perFeedLimit（跟踪设置保存时同步写入）
 * 2. 指定了 feedId 时用 articleLimit
 * 3. 全局 tracker_settings.wechat_mcp_per_feed_limit（未同步到源 config 时的兜底）
 * 4. 兜底：articleLimit 按 feed 数量平均分配
 */
export function resolvePerFeedLimit({ configPerFeedLimit, feedId, articleLimit, feedCount, globalPerFeedLimit }) {
  if (configPerFeedLimit) return Math.max(1, parseInt(configPerFeedLimit, 10) || 1);
  if (feedId) return articleLimit;
  if (globalPerFeedLimit) return Math.max(1, Number(globalPerFeedLimit) || 1);
  return Math.max(1, Math.ceil(articleLimit / Math.max(1, feedCount)));
}

function parseConfig(source) {
  let config = source.config || {};
  if (typeof config === "string") {
    try {
      config = JSON.parse(config);
    } catch {
      config = {};
    }
  }
  return config;
}

function stripHtml(html) {
  if (!html) return "";
  const $ = cheerio.load(html);
  $("style, script, noscript").remove();
  return $.text().replace(/\s+/g, " ").trim();
}

async function connectSse(sseUrl) {
  const res = await fetch(sseUrl);
  if (!res.ok) {
    throw new Error(`MCP SSE connection failed: HTTP ${res.status}`);
  }
  if (!res.body) {
    throw new Error("MCP SSE response has no body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let endpoint = null;
  let buffer = "";

  while (!endpoint) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("event: endpoint")) {
        const dataLine = lines[i + 1];
        if (dataLine && dataLine.startsWith("data:")) {
          endpoint = dataLine.slice(5).trim();
          i++;
        }
      }
    }
  }

  if (!endpoint) {
    throw new Error("MCP SSE did not return an endpoint");
  }

  return { endpoint, reader, decoder };
}

function getPostUrl(sseUrl, endpoint) {
  if (endpoint.startsWith("http")) return endpoint;
  const base = new URL(sseUrl);
  if (endpoint.startsWith("/")) {
    return `${base.protocol}//${base.host}${endpoint}`;
  }
  const path = base.pathname.replace(/\/[^/]*$/, "/");
  return `${base.protocol}//${base.host}${path}${endpoint}`;
}

async function sendMessage(postUrl, message) {
  const res = await fetch(postUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MCP POST failed: HTTP ${res.status} ${text}`);
  }
  return res;
}

async function readMessages(reader, decoder, predicate, timeoutMs = 15000) {
  let buffer = "";
  const start = Date.now();
  let currentMessage = null;

  while (Date.now() - start < timeoutMs) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (currentMessage) {
          try {
            const msg = JSON.parse(currentMessage);
            if (predicate(msg)) return msg;
          } catch (e) {
            console.error("[wechat_mcp] Failed to parse MCP message:", e.message);
          }
          currentMessage = null;
        }
        continue;
      }
      if (trimmed.startsWith("data:")) {
        currentMessage = trimmed.slice(5).trim();
      }
    }
  }
  throw new Error("Timeout waiting for MCP response");
}

async function initializeSession(sseUrl) {
  const { endpoint, reader, decoder } = await connectSse(sseUrl);
  const postUrl = getPostUrl(sseUrl, endpoint);

  await sendMessage(postUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "energy-insights-hub", version: "0.1.0" }
    }
  });

  const initRes = await readMessages(reader, decoder, m => m.id === 1);
  if (initRes.error) {
    throw new Error(`MCP initialize error: ${initRes.error.message}`);
  }

  await sendMessage(postUrl, {
    jsonrpc: "2.0",
    method: "notifications/initialized"
  });

  return { postUrl, reader, decoder };
}

async function callTool(postUrl, reader, decoder, name, args, id, timeoutMs = 30000, parseJson = true) {
  await sendMessage(postUrl, {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args }
  });
  const res = await readMessages(reader, decoder, m => m.id === id, timeoutMs);
  if (res.error) {
    throw new Error(`MCP tool ${name} error: ${res.error.message}`);
  }
  const text = res.result?.content?.[0]?.text;
  if (text === undefined || text === null) {
    throw new Error(`MCP tool ${name} returned empty content`);
  }
  if (!parseJson) {
    return text;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`MCP tool ${name} returned invalid JSON: ${e.message}`);
  }
}

function normalizeWechatDate(seconds) {
  const d = new Date(seconds * 1000);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

async function fetchFeedArticles(session, feedId, limit, requestIdRef) {
  const articles = await callTool(
    session.postUrl,
    session.reader,
    session.decoder,
    "get_feed_articles",
    { feedId, limit },
    requestIdRef.id++
  );
  return Array.isArray(articles) ? articles : [];
}

function pickAccountName(item, feedName) {
  const candidates = [
    item.accountName,
    item.account,
    item.author,
    item.sourceName,
    item.source,
    item.feedName,
    item.mpName,
    item.officialAccount,
    item.bizName
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return feedName || "";
}

async function fetchFullText(session, articleId, requestIdRef) {
  try {
    const html = await callTool(
      session.postUrl,
      session.reader,
      session.decoder,
      "get_article_fulltext",
      { articleId },
      requestIdRef.id++,
      30000,
      false
    );
    return typeof html === "string" ? html : "";
  } catch (e) {
    console.error(`[wechat_mcp] Failed to fetch fulltext for ${articleId}:`, e.message);
    return "";
  }
}

export async function fetchArticles(source) {
  const config = parseConfig(source);
  const sseUrl = source.url;
  const feedId = config.feedId || "";
  const articleLimit = config.articleLimit || DEFAULT_ARTICLE_LIMIT;
  const lookbackHours = config.lookbackHours || DEFAULT_LOOKBACK_HOURS;
  if (!sseUrl) {
    throw new Error("wechat_mcp source requires an MCP SSE URL");
  }

  const session = await initializeSession(sseUrl);
  const requestIdRef = { id: 10 };

  try {
    const feedNameById = {};
    let feedIds = [];
    if (feedId) {
      feedIds = [feedId];
    } else {
      const feeds = await callTool(
        session.postUrl,
        session.reader,
        session.decoder,
        "list_wechat_feeds",
        {},
        requestIdRef.id++
      );
      for (const f of Array.isArray(feeds) ? feeds : []) {
        if (!f.id) continue;
        feedIds.push(f.id);
        const name = f.name || f.title || f.accountName || f.account || f.author || "";
        feedNameById[f.id] = name.trim();
      }
    }

    if (feedIds.length === 0) {
      throw new Error("No WeChat feeds found in MCP server");
    }

    // 每个公众号抓取上限：优先 config.perFeedLimit，其次全局 tracker_settings，
    // 最后按 articleLimit 平均分配（resolvePerFeedLimit 统一决策）
    const settings = loadSettings();
    const perFeedLimit = resolvePerFeedLimit({
      configPerFeedLimit: config.perFeedLimit,
      feedId,
      articleLimit,
      feedCount: feedIds.length,
      globalPerFeedLimit: settings.wechatMcpPerFeedLimit,
    });
    const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;
    const articles = [];

    for (const id of feedIds) {
      try {
        const feedName = feedNameById[id] || "";
        const feedArticles = await fetchFeedArticles(session, id, perFeedLimit, requestIdRef);
        for (const item of feedArticles) {
          try {
            const publishTime = item.publishTime || item.updateTime;
            const publishDate = normalizeWechatDate(publishTime);
            if (new Date(publishDate).getTime() < cutoff) continue;

            const html = await fetchFullText(session, item.id, requestIdRef);
            const rawContent = stripHtml(html);
            const summary = rawContent.slice(0, 500);

            articles.push({
              title: item.title || "",
              summary,
              url: item.link || `https://mp.weixin.qq.com/s/${item.id}`,
              publishDate,
              rawContent,
              source: pickAccountName(item, feedName)
            });
          } catch (e) {
            console.error(`[wechat_mcp] Failed to process article ${item.id}:`, e.message);
          }
        }
      } catch (e) {
        console.error(`[wechat_mcp] Failed to fetch feed ${id}:`, e.message);
      }
    }

    // 返回上限 = 每源上限 × 源数量（例如 15 篇/源 × 25 源 = 375 篇），
    // 而非固定 articleLimit——后者会把排在后面的源（常含最新文章）全部截掉
    return articles.slice(0, perFeedLimit * feedIds.length);
  } finally {
    try {
      await session.reader.cancel();
    } catch (e) {
      // ignore
    }
  }
}
