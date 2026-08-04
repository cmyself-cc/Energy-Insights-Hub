// Challenge-aware fetch layer for sites protected by JS cookie challenges
// (e.g. Aliyun WAF "acw_sc__v2"). See spec 2026-08-04-waf-challenge-fetch-layer-design.md.

import vm from "vm";

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

/**
 * Solve an Aliyun WAF-style JS challenge by executing the page's scripts in a
 * Node vm sandbox and intercepting the document.cookie assignment.
 * The sandbox exposes no file/network/process capabilities; each script runs
 * with a 5s timeout. Errors after the cookie is captured are tolerated.
 *
 * Returns { value, maxAgeMs } or null when no acw_sc__v2 cookie was produced.
 */
export function solveChallengeInVm(html, pageUrl = "") {
  if (!isChallengePage(html)) return null;

  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1])
    .filter(s => s.trim());
  const renderData = html.match(/<textarea id="renderData"[^>]*>([\s\S]*?)<\/textarea>/i)?.[1] || "";

  let captured = null;
  const locationShim = { href: pageUrl, reload() {}, replace() {} };
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout: () => 0,
    setInterval: () => 0,
    clearTimeout: () => {},
    clearInterval: () => {},
    document: {
      getElementById: (id) => (id === "renderData" ? { innerHTML: renderData } : null),
      get cookie() { return captured || ""; },
      set cookie(v) {
        if (typeof v === "string" && v.includes("acw_sc__v2")) captured = v;
      },
      referrer: "",
      location: locationShim
    },
    navigator: { userAgent: "Mozilla/5.0", language: "zh-CN" },
    location: locationShim
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.top = sandbox;

  const ctx = vm.createContext(sandbox);
  for (const script of scripts) {
    try {
      vm.runInContext(script, ctx, { timeout: 5000 });
    } catch {
      // Challenge scripts often end with a reload/navigation we cannot honor;
      // keep going as long as we have not captured the cookie.
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
