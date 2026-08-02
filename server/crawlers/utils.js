import { URL } from "url";
import zlib from "zlib";

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

export function resolveUrl(base, relative) {
  if (!relative) return "";
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

const DESKTOP_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
];

export function randomUserAgent() {
  return DESKTOP_AGENTS[Math.floor(Math.random() * DESKTOP_AGENTS.length)];
}

const NON_NEWS_SEGMENTS = [
  "/about", "/contact", "/tag/", "/category/", "/author/", "/page/",
  "/search", "/login", "/signup", "/register", "/archive", "/feed",
  "/rss", "/atom", "/comments", "/cdn-cgi", "/wp-content/uploads",
  "/assets/", "/static/", "/images/", "/wp-json"
];

// Supports: /2026/07/24/, /2026-07-24/, /20260724/ (no separators — common on Chinese news sites)
const NEWS_PATH_RE = /\/(20\d{2}|19\d{2})[/-]?[01]\d([/-]?[0123]\d)?\//;
const NEWS_TYPE_RE = /\/(news|news-releases|article|articles|post|posts|story|stories|blog|press-release|press|release|updates|latest|xw|gsdt|yaowen)\//;
const NON_FILE_EXT = new Set(["jpg", "jpeg", "png", "gif", "pdf", "zip", "mp4", "mp3", "css", "js", "xml", "json"]);

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach(p => u.searchParams.delete(p));
    return u.href;
  } catch {
    return url;
  }
}

export function isNewsUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();

    if (NON_NEWS_SEGMENTS.some(s => path.includes(s))) return false;
    if (!NEWS_PATH_RE.test(path) && !NEWS_TYPE_RE.test(path)) return false;

    const ext = path.split(".").pop();
    if (NON_FILE_EXT.has(ext)) return false;

    return true;
  } catch {
    return false;
  }
}

const TITLE_BLACKLIST = [
  "login", "sign in", "register", "subscribe", "sitemap", "archives",
  "privacy policy", "cookie policy", "terms of service", "404", "403",
  "page not found", "tag:", "category:", "author:", "search results",
  "登录", "注册", "订阅", "关于我们", "联系我们", "标签", "分类", "作者"
];

export function isNewsTitle(title) {
  const t = (title || "").trim();
  if (!t || t.length < 10 || t.length > 200) return false;
  if (/^[^a-zA-Z0-9\u4e00-\u9fa5]+$/.test(t)) return false;

  const lower = t.toLowerCase();
  if (TITLE_BLACKLIST.some(w => lower.includes(w))) return false;

  const alpha = t.replace(/[^a-zA-Z]/g, "");
  if (alpha.length > 10 && alpha === alpha.toUpperCase()) return false;

  return true;
}

function normalizeForFuzzy(s) {
  return String(s || "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function buildNgrams(str, n = 2) {
  const set = new Set();
  for (let i = 0; i <= str.length - n; i++) {
    set.add(str.slice(i, i + n));
  }
  return set;
}

export function fuzzyTitleSimilarity(a, b) {
  const na = normalizeForFuzzy(a);
  const nb = normalizeForFuzzy(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const ga = buildNgrams(na);
  const gb = buildNgrams(nb);
  let intersection = 0;
  for (const g of ga) {
    if (gb.has(g)) intersection++;
  }
  if (intersection === 0) return 0;
  return (2 * intersection) / (ga.size + gb.size);
}

export function decompressIfNeeded(buffer, contentType = "", url = "") {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("gzip") || url.toLowerCase().endsWith(".gz")) {
    return zlib.gunzipSync(buffer).toString("utf-8");
  }
  return buffer.toString("utf-8");
}

/**
 * Parse a date string that may be in DD/MM/YYYY, MM/DD/YYYY, or YYYY-MM-DD format.
 * Returns a valid Date or null.
 */
function parseFlexibleDate(str) {
  if (!str) return null;
  const s = str.trim();
  // Try standard ISO / JS parse first (handles YYYY-MM-DD, YYYY/MM/DD, ISO 8601)
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;

  // Try DD/MM/YYYY or DD-MM-YYYY (European / Chinese common format)
  const dmyMatch = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmyMatch) {
    const [, day, month, year] = dmyMatch;
    d = new Date(Number(year), Number(month) - 1, Number(day));
    if (!isNaN(d.getTime())) return d;
  }

  // Try additional formats
  // "01/07/2024" could be DD/MM/YYYY
  const slashMatch = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    // Assume DD/MM/YYYY — this is the most common format on Chinese/European sites
    d = new Date(Number(slashMatch[3]), Number(slashMatch[2]) - 1, Number(slashMatch[1]));
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

export function extractPublishedDate($) {
  // --- Helper: try to extract a date string, return ISO or null ---
  const tryExtract = (text) => {
    if (!text) return null;
    const t = text.trim().replace(/\s+/g, " ");
    // YYYY-MM-DD or YYYY/MM/DD
    const ymd = t.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);
    if (ymd) {
      const d = parseFlexibleDate(ymd[1]);
      if (d) return d.toISOString();
    }
    // DD/MM/YYYY or DD-MM-YYYY
    const dmy = t.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{4})\b/);
    if (dmy) {
      const d = parseFlexibleDate(dmy[1]);
      if (d) return d.toISOString();
    }
    return null;
  };

  // 1) <time> tag
  const timeEl = $("time[datetime]").first();
  if (timeEl.length) {
    const result = tryExtract(timeEl.attr("datetime"));
    if (result) return result;
  }

  // 2) meta tags
  const metaSelectors = [
    'meta[property="article:published_time"]',
    'meta[name="pubdate"]',
    'meta[name="publishdate"]',
    'meta[name="DC.date"]',
    'meta[name="date"]',
    'meta[property="article:modified_time"]'
  ];
  for (const sel of metaSelectors) {
    const content = $(sel).attr("content");
    if (content) {
      const result = tryExtract(content);
      if (result) return result;
    }
  }

  // 3) Common CSS class patterns — check DD/MM/YYYY first (more specific), then YYYY-MM-DD
  const classSelectors = [
    ".date", ".publish-date", ".article-date", ".post-date", ".pub-date",
    ".time", ".publish-time", ".article-time", ".post-time",
    "[class*='date']", "[class*='time']", "[class*='publish']"
  ];
  for (const sel of classSelectors) {
    const text = $(sel).first().text().trim();
    const result = tryExtract(text);
    if (result) return result;
  }

  // 4) Text pattern matching in body (first 3000 chars)
  const bodyText = $("body").text().slice(0, 3000);
  const patterns = [
    // Chinese date labels with DD/MM/YYYY
    /发布时间[：:\s]*(\d{1,2}[/-]\d{1,2}[/-]\d{4})/,
    /发布日期[：:\s]*(\d{1,2}[/-]\d{1,2}[/-]\d{4})/,
    /日期[：:\s]*(\d{1,2}[/-]\d{1,2}[/-]\d{4})/,
    // Chinese date labels with YYYY-MM-DD
    /发布时间[：:\s]*(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s*\d{1,2}:\d{2})/,
    /发布日期[：:\s]*(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s*\d{1,2}:\d{2})/,
    // Generic: DD/MM/YYYY near a date label word
    /(?:date|pub|publish|time|发布|日期)[^\n]{0,30}?(\d{1,2}[/-]\d{1,2}[/-]\d{4})/i,
    // Generic: YYYY-MM-DD HH:MM
    /(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s*\d{1,2}:\d{2})/
  ];
  for (const pattern of patterns) {
    const match = bodyText.match(pattern);
    if (match) {
      const result = tryExtract(match[1]);
      if (result) return result;
    }
  }

  // No date found — return null so caller can decide fallback
  return null;
}

export function cleanText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\n+/g, "\n")
    .trim();
}
