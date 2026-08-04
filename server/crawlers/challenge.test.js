import { describe, it, expect, beforeEach } from "vitest";
import {
  isChallengePage,
  getRegistrableDomain,
  setCachedCookie,
  getCachedCookie,
  clearCachedCookie,
  solveChallengeInVm
} from "./challenge.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bjxChallengeHtml = fs.readFileSync(path.join(__dirname, "__fixtures__/bjx-challenge.html"), "utf-8");

describe("isChallengePage", () => {
  it("detects Aliyun WAF challenge page markers", () => {
    const html = `<textarea id="renderData">{"l1":"var arg1='abc';"}</textarea>
      <script name="aliyunwaf_x">setCookie("acw_sc__v2",e)</script>`;
    expect(isChallengePage(html)).toBe(true);
  });

  it("returns false for normal pages and empty input", () => {
    expect(isChallengePage("<html><body><h1>News</h1></body></html>")).toBe(false);
    expect(isChallengePage("")).toBe(false);
    expect(isChallengePage(null)).toBe(false);
  });

  it("returns false when only one marker is present", () => {
    expect(isChallengePage("var arg1='abc'")).toBe(false);
  });
});

describe("getRegistrableDomain", () => {
  it("collapses multi-label public suffixes", () => {
    expect(getRegistrableDomain("news.bjx.com.cn")).toBe("bjx.com.cn");
    expect(getRegistrableDomain("guangfu.bjx.com.cn")).toBe("bjx.com.cn");
  });

  it("falls back to last two labels for common TLDs", () => {
    expect(getRegistrableDomain("www.example.com")).toBe("example.com");
    expect(getRegistrableDomain("a.b.example.org")).toBe("example.org");
  });

  it("returns input for degenerate hosts", () => {
    expect(getRegistrableDomain("localhost")).toBe("localhost");
    expect(getRegistrableDomain("")).toBe("");
  });
});

describe("cookie cache", () => {
  beforeEach(() => clearCachedCookie());

  it("stores and retrieves a cookie by domain", () => {
    setCachedCookie("bjx.com.cn", "abc123");
    expect(getCachedCookie("bjx.com.cn")).toBe("abc123");
    expect(getCachedCookie("other.com")).toBeNull();
  });

  it("clears a single domain or the whole cache", () => {
    setCachedCookie("a.com", "1");
    setCachedCookie("b.com", "2");
    clearCachedCookie("a.com");
    expect(getCachedCookie("a.com")).toBeNull();
    expect(getCachedCookie("b.com")).toBe("2");
    clearCachedCookie();
    expect(getCachedCookie("b.com")).toBeNull();
  });

  it("ignores empty domain or value", () => {
    setCachedCookie("", "x");
    setCachedCookie("a.com", "");
    expect(getCachedCookie("")).toBeNull();
    expect(getCachedCookie("a.com")).toBeNull();
  });
});

describe("solveChallengeInVm", () => {
  it("extracts acw_sc__v2 cookie from a real bjx challenge page", () => {
    const solved = solveChallengeInVm(bjxChallengeHtml, "https://news.bjx.com.cn/html/20260727/1505924.shtml");
    expect(solved).not.toBeNull();
    // 实测观察到的 cookie 形态：10 位 hex + '-' + 40 位 hex
    expect(solved.value).toMatch(/^[0-9a-f]{10}-[0-9a-f]{40}$/);
    expect(solved.maxAgeMs).toBe(3600 * 1000);
  });

  it("is deterministic for a fixed challenge page", () => {
    const a = solveChallengeInVm(bjxChallengeHtml, "https://news.bjx.com.cn/");
    const b = solveChallengeInVm(bjxChallengeHtml, "https://news.bjx.com.cn/");
    expect(a.value).toBe(b.value);
  });

  it("returns null for non-challenge HTML", () => {
    expect(solveChallengeInVm("<html><body>hello</body></html>", "https://example.com/")).toBeNull();
  });
});
