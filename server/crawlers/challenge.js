// Challenge-aware fetch layer for sites protected by JS cookie challenges
// (e.g. Aliyun WAF "acw_sc__v2"). See spec 2026-08-04-waf-challenge-fetch-layer-design.md.

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
