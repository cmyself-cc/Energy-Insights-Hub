// Challenge-aware fetch layer for sites protected by JS cookie challenges
// (e.g. Aliyun WAF "acw_sc__v2"). See spec 2026-08-04-waf-challenge-fetch-layer-design.md.

import vm from "vm";
import { chromium } from "playwright";
import { fetchWithTimeout, sleep, decodeHtmlBuffer } from "./utils.js";

const cookieCache = new Map(); // domain -> { value, expiresAt }
const DEFAULT_COOKIE_TTL_MS = 55 * 60 * 1000; // slightly under the typical 1h cookie lifetime

// Common multi-label public suffixes; anything not matched falls back to last two labels.
const MULTI_LABEL_SUFFIXES = [
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn",
  "co.uk", "com.au", "com.hk", "com.tw"
];

/**
 * Detect Aliyun WAF-style JS challenge pages: they embed `var arg1='...'`
 * and reference the acw_sc__v2 cookie / aliyunwaf script.
 */
export function isChallengePage(html) {
  if (!html || typeof html !== "string") return false;
  return /var arg1=/.test(html) && (/acw_sc__v2/.test(html) || /aliyunwaf/.test(html));
}

/**
 * Collapse a hostname to its registrable domain so cookies solved on one
 * subdomain can be reused on siblings (verified: bjx.com.cn accepts a cookie
 * solved on news.bjx.com.cn for guangfu.bjx.com.cn).
 */
export function getRegistrableDomain(hostname) {
  const labels = String(hostname || "").toLowerCase().split(".").filter(Boolean);
  if (labels.length < 2) return String(hostname || "");
  for (const suffix of MULTI_LABEL_SUFFIXES) {
    const suffixLabels = suffix.split(".");
    if (labels.length > suffixLabels.length &&
        labels.slice(-suffixLabels.length).join(".") === suffix) {
      return labels.slice(-suffixLabels.length - 1).join(".");
    }
  }
  return labels.slice(-2).join(".");
}

export function setCachedCookie(domain, value, maxAgeMs = null) {
  if (!domain || !value) return;
  const ttl = maxAgeMs && maxAgeMs > 60000 ? Math.min(maxAgeMs, 24 * 3600 * 1000) : DEFAULT_COOKIE_TTL_MS;
  cookieCache.set(domain, { value, expiresAt: Date.now() + ttl });
}

export function getCachedCookie(domain) {
  if (!domain) return null;
  const entry = cookieCache.get(domain);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cookieCache.delete(domain);
    return null;
  }
  return entry.value;
}

export function clearCachedCookie(domain = null) {
  if (domain) cookieCache.delete(domain);
  else cookieCache.clear();
}

// DOM/browser shims defined INSIDE the context realm by a prelude script.
// Challenge pages are untrusted third-party content: injecting host-realm
// objects (console/document/navigator) lets script code walk the prototype
// chain to the host Function constructor and reach `process` (full RCE), e.g.
// console.constructor.constructor('return process')(). Only primitives are
// passed into the context (__renderData/__pageUrl); everything else is built
// by this prelude, and the captured cookie is read back as a primitive string
// via __capturedCookie. Sloppy-mode top-level `this` is the context global.
const VM_PRELUDE = `
var window = this, self = this, top = this;
var console = { log: function(){}, warn: function(){}, error: function(){}, info: function(){}, debug: function(){} };
var setTimeout = function(){ return 0; }, setInterval = function(){ return 0; };
var clearTimeout = function(){}, clearInterval = function(){};
var location = { href: __pageUrl, reload: function(){}, replace: function(){} };
var navigator = { userAgent: "Mozilla/5.0", language: "zh-CN" };
var __capturedCookie = "";
var document = {
  getElementById: function(id){ return id === "renderData" ? { innerHTML: __renderData } : null; },
  get cookie(){ return __capturedCookie; },
  set cookie(v){ if (typeof v === "string" && v.indexOf("acw_sc__v2") !== -1) __capturedCookie = v; },
  referrer: "",
  location: location
};
`;

/**
 * Solve an Aliyun WAF-style JS challenge by executing the page's scripts in a
 * Node vm sandbox and intercepting the document.cookie assignment.
 * The sandbox exposes no file/network/process capabilities (all shims live in
 * the context realm, see VM_PRELUDE); each script runs with a 5s timeout.
 * Errors after the cookie is captured are tolerated.
 *
 * Returns { value, maxAgeMs } or null when no acw_sc__v2 cookie was produced.
 */
export function solveChallengeInVm(html, pageUrl = "") {
  if (!isChallengePage(html)) return null;

  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1])
    .filter(s => s.trim());
  const renderData = html.match(/<textarea id="renderData"[^>]*>([\s\S]*?)<\/textarea>/i)?.[1] || "";

  // Bare null-prototype object: no host prototype chain to climb out of the
  // sandbox. Only primitive strings cross the realm boundary.
  const contextObject = Object.create(null);
  contextObject.__renderData = renderData;
  contextObject.__pageUrl = pageUrl;
  const ctx = vm.createContext(contextObject);
  vm.runInContext(VM_PRELUDE, ctx);

  let captured = "";
  for (const script of scripts) {
    try {
      vm.runInContext(script, ctx, { timeout: 5000 });
    } catch {
      // Challenge scripts often end with a reload/navigation we cannot honor;
      // keep going as long as we have not captured the cookie.
    }
    try {
      // Read back even after a script error: the cookie may have been set
      // before the script threw on a navigation we cannot honor.
      const readBack = vm.runInContext("__capturedCookie", ctx, { timeout: 5000 });
      if (typeof readBack === "string" && readBack) captured = readBack;
    } catch {
      // Keep any previously captured value.
    }
    if (captured) break;
  }
  if (!captured) return null;

  const first = captured.split(";")[0];
  const eq = first.indexOf("=");
  let value = eq >= 0 ? first.slice(eq + 1).trim() : first.trim();
  if (!value) return null;
  // This WAF variant appends client-side noise (Math.random-derived hex) after
  // the deterministic core; the cookie observed in the wild is 10 hex chars +
  // '-' + 40 hex chars. Trim the trailing noise to that canonical shape, which
  // is also what makes repeated solves of the same page deterministic.
  const canonical = value.match(/^([0-9a-f]{10}-[0-9a-f]{40})[0-9a-f]+$/i);
  if (canonical) value = canonical[1];
  const maxAge = captured.match(/max-age=(\d+)/i);
  return { value, maxAgeMs: maxAge ? Number(maxAge[1]) * 1000 : null };
}

const RETRYABLE_STATUS = (status) => status === 429 || status >= 500;

async function fetchOnceWithRetry(url, options, timeoutMs, retryDelayMs) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetchWithTimeout(url, options, timeoutMs);
    } catch (e) {
      if (attempt === 0) {
        console.error(`[website] fetch error for ${url}, retrying: ${e.message}`);
        await sleep(retryDelayMs);
        continue;
      }
      throw e;
    }
    if (RETRYABLE_STATUS(res.status) && attempt === 0) {
      console.error(`[website] HTTP ${res.status} for ${url}, retrying`);
      await sleep(retryDelayMs);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }
}

async function fetchDecoded(url, options, timeoutMs, retryDelayMs) {
  const res = await fetchOnceWithRetry(url, options, timeoutMs, retryDelayMs);
  return decodeHtmlBuffer(Buffer.from(await res.arrayBuffer()), res.headers.get("content-type") || "");
}

function withCookieHeader(options, cookieValue) {
  if (!cookieValue) return options;
  return { ...(options || {}), headers: { ...((options || {}).headers || {}), "Cookie": `acw_sc__v2=${cookieValue}` } };
}

/**
 * Solve the challenge by letting a real headless browser execute the JS and
 * reload; then harvest the cookie. Used only when the vm solver fails.
 */
export async function solveChallengeWithPlaywright(url, timeoutMs = 20000) {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-infobars",
        "--disable-dev-shm-usage"
      ]
    });
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai"
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load", timeout: timeoutMs });

    // The challenge script computes the cookie and reloads; poll for it.
    const deadline = Date.now() + 10000;
    let cookie = null;
    while (Date.now() < deadline) {
      cookie = (await context.cookies(url)).find(c => c.name === "acw_sc__v2");
      if (cookie) break;
      await sleep(500);
    }
    await context.close();
    if (!cookie) return null;

    const maxAgeMs = cookie.expires && cookie.expires > 0
      ? Math.max(cookie.expires * 1000 - Date.now(), 60000)
      : null;
    return { value: cookie.value, maxAgeMs };
  } catch (e) {
    console.error(`[website] Playwright challenge solve failed for ${url}:`, e.message);
    return null;
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* already closed */ }
    }
  }
}

/**
 * Challenge-aware fetch. Flow: cached cookie -> fetch -> challenge detected?
 * -> vm solve -> Playwright solve -> re-fetch with cookie. Cookie is cached
 * per registrable domain.
 */
export async function fetchHtmlSmart(url, options = {}, timeoutMs = 20000, { retryDelayMs = 1000 } = {}) {
  let domain = "";
  try {
    domain = getRegistrableDomain(new URL(url).hostname);
  } catch {
    // Invalid URL: fall back to no cookie caching (empty domain key)
  }

  let html = await fetchDecoded(url, withCookieHeader(options, getCachedCookie(domain)), timeoutMs, retryDelayMs);
  if (!isChallengePage(html)) return html;

  console.log(`[website] WAF challenge detected for ${url}`);
  clearCachedCookie(domain);

  // 1) vm sandbox solver
  const vmSolved = solveChallengeInVm(html, url);
  if (vmSolved) {
    setCachedCookie(domain, vmSolved.value, vmSolved.maxAgeMs);
    html = await fetchDecoded(url, withCookieHeader(options, vmSolved.value), timeoutMs, retryDelayMs);
    if (!isChallengePage(html)) {
      console.log(`[website] Challenge solved via vm for ${domain || url}`);
      return html;
    }
    clearCachedCookie(domain);
  }

  // 2) Playwright fallback solver
  const pwSolved = await solveChallengeWithPlaywright(url);
  if (pwSolved) {
    setCachedCookie(domain, pwSolved.value, pwSolved.maxAgeMs);
    html = await fetchDecoded(url, withCookieHeader(options, pwSolved.value), timeoutMs, retryDelayMs);
    if (!isChallengePage(html)) {
      console.log(`[website] Challenge solved via Playwright for ${domain || url}`);
      return html;
    }
    clearCachedCookie(domain);
  }

  throw new Error(`WAF challenge could not be solved for ${url}`);
}
