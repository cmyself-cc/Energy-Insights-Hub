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

const NEWS_PATH_RE = /\/(20\d{2}|19\d{2})[/-][01]\d([/-][0123]\d)?\//;
const NEWS_TYPE_RE = /\/(news|article|articles|post|posts|story|stories|blog|press-release|press|release|updates|latest)\//;
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

function parseIsoLike(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function extractPublishedDate($) {
  const selectors = [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[property="og:article:published_time"]',
    'meta[name="publishdate"]',
    'meta[name="date"]',
    'meta[itemprop="datePublished"]'
  ];

  for (const sel of selectors) {
    const content = $(sel).attr("content");
    if (content) {
      const parsed = parseIsoLike(content);
      if (parsed) return parsed;
    }
  }

  let jsonLdDate = null;
  $("script[type='application/ld+json']").each((_i, el) => {
    if (jsonLdDate) return false;
    try {
      const data = JSON.parse($(el).text() || "{}");
      const graphs = Array.isArray(data["@graph"]) ? data["@graph"] : [data];
      for (const item of graphs) {
        const types = [].concat(item["@type"] || []);
        if (types.some(t => /NewsArticle|Article|BlogPosting/i.test(t))) {
          const d = item.datePublished || item.dateModified;
          if (d) {
            jsonLdDate = parseIsoLike(d);
            if (jsonLdDate) return false;
          }
        }
      }
    } catch {
      // ignore malformed JSON-LD
    }
  });
  if (jsonLdDate) return jsonLdDate;

  let timeDate = null;
  $("time[datetime]").each((_i, el) => {
    if (timeDate) return false;
    const d = parseIsoLike($(el).attr("datetime"));
    if (d) {
      timeDate = d;
      return false;
    }
  });
  if (timeDate) return timeDate;

  return null;
}

export function cleanText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\n+/g, "\n")
    .trim();
}
