import * as cheerio from "cheerio";
import Parser from "rss-parser";
import {
  fetchWithTimeout,
  resolveUrl,
  sleep,
  randomUserAgent,
  isNewsUrl,
  isNewsTitle,
  extractPublishedDate,
  cleanText,
  decompressIfNeeded,
  normalizeUrl
} from "./utils.js";

const rssParser = new Parser({
  timeout: 20000,
  headers: { "User-Agent": "EnergyInsightsHub/1.0" }
});

const DEFAULT_LIST_SELECTORS = [
  "article h2 a",
  "article h3 a",
  ".post-title a",
  ".entry-title a",
  ".news-list a",
  ".list-item a",
  "a[href*='/news/']",
  "a[href*='/article/']",
  "a[href*='/post/']",
  "a[href*='/blog/']",
  "a[href*='/202']",
  "a[href*='/201']"
];

const DEFAULT_DETAIL_SELECTORS = {
  title: "h1, .article-title, .post-title, .entry-title, [property='og:title']",
  content: "article, .article, .post-content, .entry-content, main, .content"
};

function parseConfig(source) {
  let config = source.config || {};
  if (typeof config === "string") {
    try {
      config = JSON.parse(config);
    } catch {
      config = {};
    }
  }

  const selectors = config.selectors || {};
  const rawList = selectors.list || config.listSelectors;
  const rawDetail = selectors.detail || config.detailSelectors;

  return {
    strategy: (config.strategy || "auto").toLowerCase(),
    articleLimit: Math.min(Math.max(parseInt(config.articleLimit, 10) || 5, 1), 20),
    requireNewsPattern: config.requireNewsPattern !== false,
    maxAgeDays: Math.min(Math.max(parseInt(config.maxAgeDays, 10) || 7, 1), 30),
    fetchDetailForRss: config.fetchDetailForRss !== false,
    listSelectors: rawList
      ? (Array.isArray(rawList) ? rawList : [rawList])
      : undefined,
    detailSelectors: typeof rawDetail === "object" && rawDetail ? rawDetail : {}
  };
}

export function discoverRssFeeds(html, baseUrl) {
  const $ = cheerio.load(html);
  const feeds = [];
  const selectors = [
    'link[type="application/rss+xml"]',
    'link[type="application/atom+xml"]',
    'link[type="application/rdf+xml"]',
    'a[href*=".rss"]',
    'a[href*="/rss"]',
    'a[href*="/feed"]',
    'a[href*="/atom"]'
  ];
  selectors.forEach(selector => {
    $(selector).each((_i, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const url = resolveUrl(baseUrl, href);
      if (url && !feeds.includes(url)) feeds.push(url);
    });
  });
  return feeds;
}

export function discoverSubPages(html, baseUrl) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const candidates = [];
  const pathPatterns = [/\/news/, /\/xwzx/, /\/article/, /\/post/, /\/blog/, /\/info/, /\/category/, /\/list/, /\/column/, /\/channel/];
  const textPatterns = /新闻|资讯|动态|全部|更多|列表|目录|要闻/;

  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (!href || href === "#" || href === "/" || href.startsWith("javascript:") || href.startsWith("mailto:")) return;
    const url = resolveUrl(baseUrl, href);
    if (!url || seen.has(url)) return;
    seen.add(url);

    let score = 0;
    const urlLower = url.toLowerCase();
    for (const pattern of pathPatterns) {
      if (pattern.test(urlLower)) { score += 5; break; }
    }
    if (textPatterns.test(text)) score += 3;

    if (score > 0) {
      candidates.push({ url, title: text || url, score });
    }
  });

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ url, title }) => ({ url, title }));
}

export function discoverListSelectors(html) {
  const $ = cheerio.load(html);
  const groupScores = new Map();

  $("a[href]").each((_i, el) => {
    const $el = $(el);
    const href = $el.attr("href");
    const text = $el.text().trim();
    if (!href || !text || text.length < 5 || text.length > 200) return;

    // Find closest list-like parent
    let parent = $el.parent();
    for (let depth = 0; depth < 5 && parent.length; depth++) {
      const tag = parent.prop("tagName").toLowerCase();
      if (["li", "article", "div"].includes(tag)) {
        // Build selector for this <a> within the parent
        const parentTag = parent.prop("tagName").toLowerCase();
        let parentClass = parent.attr("class")?.split(/\s+/)[0] || "";
        const aTag = $el.prop("tagName").toLowerCase();
        let aClass = $el.attr("class")?.split(/\s+/)[0] || "";

        let selector;
        if (parentClass) {
          selector = `${parentTag}.${parentClass} ${aTag}` + (aClass ? `.${aClass}` : "");
        } else {
          selector = `${parentTag} ${aTag}`;
        }

        const score = groupScores.get(selector) || 0;
        let newScore = score + 1;
        const parentHtml = parent.html() || "";
        if (parentHtml.includes("time") || parentHtml.includes("date") || parentHtml.includes("span")) newScore += 2;
        if (isNewsUrl(href)) newScore += 3;
        if (isNewsTitle(text)) newScore += 2;
        groupScores.set(selector, newScore);
        break;
      }
      parent = parent.parent();
    }
  });

  return Array.from(groupScores.entries())
    .filter(([, score]) => score >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([sel]) => sel);
}

async function fetchHtml(url, timeoutMs = 20000) {
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        "User-Agent": randomUserAgent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache"
      }
    },
    timeoutMs
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchArticleDetail(url, detailSelectors = {}) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  let title = $(detailSelectors.title || DEFAULT_DETAIL_SELECTORS.title).first().text().trim();
  if (!title) title = $("title").first().text().trim();

  const contentEl = $(detailSelectors.content || DEFAULT_DETAIL_SELECTORS.content).first();
  contentEl.find("script,style,nav,header,footer,aside,.advertisement,.ads,.social-share,.comments").remove();
  const content = cleanText(contentEl.text());
  const summary = content.slice(0, 600);
  const publishDate = extractPublishedDate($) || new Date().toISOString();

  return {
    title,
    summary,
    url,
    publishDate,
    rawContent: content.slice(0, 10000)
  };
}

async function fetchRssArticles(feedUrl, config) {
  try {
    const feed = await rssParser.parseURL(feedUrl);
    let items = (feed.items || [])
      .map(item => {
        try {
          return {
            title: item.title || "",
            summary: item.contentSnippet || item.content || "",
            url: normalizeUrl(item.link || ""),
            publishDate: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
            rawContent: item["content:encoded"] || item.content || ""
          };
        } catch (err) {
          console.error("RSS item normalization failed:", err.message);
          return null;
        }
      })
      .filter(item => item !== null && item.title && item.url);

    if (config.requireNewsPattern) {
      items = items.filter(item => isNewsUrl(item.url) && isNewsTitle(item.title));
    }

    // Enrich thin RSS items with the full article page when useful.
    const enriched = [];
    for (const item of items.slice(0, config.articleLimit * 2)) {
      const isThin = (item.rawContent || "").length < 1000;
      if ((isThin && config.fetchDetailForRss) || config.requireNewsPattern) {
        try {
          const detail = await fetchArticleDetail(item.url, config.detailSelectors);
          item.rawContent = detail.rawContent || item.rawContent;
          item.summary = detail.summary || item.summary;
          item.publishDate = detail.publishDate || item.publishDate;
          if (!item.title) item.title = detail.title;
        } catch (e) {
          // keep the RSS-provided data
        }
      }
      enriched.push(item);
      await sleep(300);
    }

    return enriched.slice(0, config.articleLimit);
  } catch (err) {
    console.error(`[website] RSS fallback failed for ${feedUrl}:`, err.message);
    return [];
  }
}

function parseSitemapXml(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const urls = [];
  $("url").each((_i, el) => {
    const loc = $(el).find("loc").first().text().trim();
    const lastmod = $(el).find("lastmod").first().text().trim();
    if (loc) {
      urls.push({ url: loc, lastmod: lastmod || null });
    }
  });
  return urls;
}

async function fetchSitemapUrls(sitemapUrl) {
  try {
    const res = await fetchWithTimeout(
      sitemapUrl,
      { headers: { "User-Agent": randomUserAgent(), "Accept": "application/xml,application/xhtml+xml,*/*;q=0.9" } },
      20000
    );
    if (!res.ok) return [];
    const buffer = Buffer.from(await res.arrayBuffer());
    const xml = decompressIfNeeded(buffer, res.headers.get("content-type") || "", sitemapUrl);

    const $ = cheerio.load(xml, { xmlMode: true });
    const childSitemaps = $("sitemap")
      .map((_i, el) => $(el).find("loc").first().text().trim())
      .get()
      .filter(Boolean);

    if (childSitemaps.length > 0) {
      const all = [];
      for (const childUrl of childSitemaps.slice(0, 3)) {
        all.push(...await fetchSitemapUrls(childUrl));
      }
      return all;
    }

    return parseSitemapXml(xml);
  } catch (e) {
    console.error(`[website] Sitemap fetch failed for ${sitemapUrl}:`, e.message);
    return [];
  }
}

async function fetchSitemapArticles(baseUrl, config) {
  const candidates = [];
  const paths = [
    "/sitemap.xml",
    "/sitemap_index.xml",
    "/sitemap-index.xml",
    "/post-sitemap.xml",
    "/sitemap-news.xml"
  ];

  for (const path of paths) {
    const sitemapUrl = resolveUrl(baseUrl, path);
    const urls = await fetchSitemapUrls(sitemapUrl);
    for (const { url, lastmod } of urls) {
      if (config.requireNewsPattern && !isNewsUrl(url)) continue;

      const date = lastmod ? new Date(lastmod) : null;
      if (date && !isNaN(date.getTime()) && config.maxAgeDays > 0) {
        const ageDays = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays > config.maxAgeDays) continue;
      }

      candidates.push({
        url,
        title: "",
        publishDate: date && !isNaN(date.getTime()) ? date.toISOString() : new Date().toISOString()
      });
    }
    if (candidates.length > 0) break;
  }

  candidates.sort((a, b) => new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime());
  const limited = candidates.slice(0, config.articleLimit * 2);

  const articles = [];
  for (const candidate of limited) {
    try {
      const detail = await fetchArticleDetail(candidate.url, config.detailSelectors);
      if (config.requireNewsPattern && (!isNewsUrl(detail.url) || !isNewsTitle(detail.title))) continue;
      articles.push({ ...detail, publishDate: candidate.publishDate || detail.publishDate });
      if (articles.length >= config.articleLimit) break;
    } catch (e) {
      console.error(`[website] Failed to fetch sitemap article ${candidate.url}:`, e.message);
    }
    await sleep(400);
  }

  return articles;
}

export function extractArticleLinks(html, baseUrl, limit = 10, customListSelectors = null) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const results = [];

  const selectorGroups = customListSelectors?.length
    ? [customListSelectors, DEFAULT_LIST_SELECTORS]
    : [DEFAULT_LIST_SELECTORS];

  for (const selectors of selectorGroups) {
    for (const selector of selectors) {
      $(selector).each((_i, el) => {
        const $el = $(el);
        const href = $el.attr("href");
        const url = resolveUrl(baseUrl, href);
        if (!url || seen.has(url)) return;

        let title = $el.text().trim();
        if (!title) {
          title = $el.attr("title")?.trim() || "";
        }
        if (!title) return;

        let date = null;
        const time = $el.closest("article, li, div, section").find("time[datetime]").first().attr("datetime");
        if (time) {
          const d = new Date(time);
          if (!isNaN(d.getTime())) date = d.toISOString();
        }

        seen.add(url);
        results.push({ url, title, date });
      });
    }
    if (results.length > 0) break;
  }

  return results.slice(0, limit);
}

function scoreArticleLink(link) {
  let score = 0;
  if (link.date) score += 20;
  if (isNewsUrl(link.url)) score += 15;
  if (isNewsTitle(link.title)) score += 10;
  const len = link.title.length;
  if (len >= 15 && len <= 120) score += 5;
  return score;
}

function scoreAndLimit(links, config) {
  return links
    .map(link => ({ ...link, score: scoreArticleLink(link) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, config.articleLimit * 2);
}

export async function fetchArticles(source) {
  const config = parseConfig(source);
  const strategy = config.strategy;

  let homeHtml = null;
  if (strategy === "auto" || strategy === "rss" || strategy === "html") {
    try {
      homeHtml = await fetchHtml(source.url);
    } catch (e) {
      console.error(`[website] Failed to fetch ${source.url}:`, e.message);
      if (strategy === "html") throw e;
    }
  }

  // 1) RSS discovery and fetch
  if ((strategy === "auto" || strategy === "rss") && homeHtml) {
    const feeds = discoverRssFeeds(homeHtml, source.url);
    if (feeds.length > 0) {
      console.log(`[website] Discovered RSS feeds: ${feeds.join(", ")}`);
      const articles = await fetchRssArticles(feeds[0], config);
      if (articles.length > 0) {
        console.log(`[website] RSS returned ${articles.length} articles`);
        return articles.map(a => ({ ...a, source: source.name || "" }));
      }
    }
  }

  // 2) XML sitemap
  if (strategy === "auto" || strategy === "sitemap") {
    try {
      const articles = await fetchSitemapArticles(source.url, config);
      if (articles.length > 0) {
        console.log(`[website] Sitemap returned ${articles.length} articles`);
        return articles.map(a => ({ ...a, source: source.name || "" }));
      }
    } catch (e) {
      console.error("[website] Sitemap strategy failed:", e.message);
    }
  }

  // 3) HTML article list
  if ((strategy === "auto" || strategy === "html") && homeHtml) {
    const links = extractArticleLinks(homeHtml, source.url, config.articleLimit * 3, config.listSelectors);
    const scored = scoreAndLimit(links, config);
    console.log(`[website] HTML list found ${scored.length} candidate links`);

    const articles = [];
    for (const link of scored) {
      try {
        if (config.requireNewsPattern && (!isNewsUrl(link.url) || !isNewsTitle(link.title))) {
          console.log(`[website] Skipping non-news link: ${link.title}`);
          continue;
        }
        const article = await fetchArticleDetail(link.url, config.detailSelectors);
        if (!article.title) article.title = link.title;
        articles.push(article);
        if (articles.length >= config.articleLimit) break;
      } catch (e) {
        console.error(`[website] Failed to fetch ${link.url}:`, e.message);
      }
      await sleep(500);
    }

    if (articles.length > 0) {
      console.log(`[website] HTML list returned ${articles.length} articles`);
      return articles.map(a => ({ ...a, source: source.name || "" }));
    }
  }

  throw new Error("No articles found via RSS, sitemap or HTML list");
}
