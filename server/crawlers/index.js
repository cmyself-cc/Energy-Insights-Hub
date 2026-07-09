const registry = new Map();

export function registerCrawler(type, crawler) {
  registry.set(type, crawler);
}

export async function fetchArticles(source) {
  const crawler = registry.get(source.type);
  if (!crawler) {
    throw new Error(`No crawler registered for type: ${source.type}`);
  }
  return crawler.fetchArticles(source);
}

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
