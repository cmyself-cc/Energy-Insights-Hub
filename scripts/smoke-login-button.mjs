// 登录门主按钮的常驻冒烟（Task 14 runbook 引用；评审 G19/G20 发现的「启用态按钮零观察者」
// 在 vitest 静态套件里补不进 —— 调用点依赖 state —— 固化为部署前手动脚本）。
// 用法：测试环境起好后 `node scripts/smoke-login-button.mjs http://localhost:5177`
// 退出码 0 = 通过；非 0 = 失败（含具体数字）。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"));
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://localhost:5177";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

const probeMain = () => {
  // 登录门只有一个主按钮（mock=dev Sign in；真实模式=微信 <a> 主 CTA），取第一个可交互的。
  // cs 必须内联在本函数里：page.evaluate 只序列化这一个函数，外部作用域带不进去。
  const cs = (el) => { const c = getComputedStyle(el); return { backgroundColor: c.backgroundColor, color: c.color, opacity: c.opacity, cursor: c.cursor, disabled: el.disabled }; };
  const el = [...document.querySelectorAll("button, a")].find((b) => b.tagName === "A" || !b.disabled) ||
             [...document.querySelectorAll("button, a")].find((b) => b.disabled);
  return el ? cs(el) : null;
};

const disabledProbe = await page.evaluate(probeMain);   // 空输入 → 禁用态
const devInput = page.locator("input").first();
if (await devInput.count()) { await devInput.fill("smoke-probe"); await page.waitForTimeout(300); }
const enabledProbe = await page.evaluate(probeMain);    // 有输入 → 启用态

const L = (rgb) => { const m = rgb.match(/[\d.]+/g).map(Number).map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
const cr = (a, b) => { const [hi, lo] = [L(a), L(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const fail = (msg) => { console.error("SMOKE FAIL:", msg, JSON.stringify({ disabledProbe, enabledProbe })); process.exitCode = 1; };

if (!disabledProbe || !disabledProbe.disabled) fail("抓不到禁用态主按钮");
if (!enabledProbe || enabledProbe.disabled) fail("抓不到启用态主按钮");
if (disabledProbe && enabledProbe && disabledProbe.disabled && !enabledProbe.disabled) {
  if (disabledProbe.opacity !== "1") fail(`禁用态用了透明度（opacity=${disabledProbe.opacity}），应换底色方案（A4 教训）`);
  const enCr = cr(enabledProbe.color, enabledProbe.backgroundColor);
  const disCr = cr(disabledProbe.color, disabledProbe.backgroundColor);
  if (enCr < 4.5) fail(`启用态文字对比度 ${enCr.toFixed(2)} < 4.5`);
  if (disCr < 4.5) fail(`禁用态文字对比度 ${disCr.toFixed(2)} < 4.5`);
  const gray = Math.abs(L(enabledProbe.backgroundColor) - L(disabledProbe.backgroundColor));
  if (gray < 0.15) fail(`两态底色亮度差 ${gray.toFixed(3)} 太小，灰度下不可分辨`);
  console.log(`SMOKE OK: enabled ${enCr.toFixed(2)}:1 / disabled ${disCr.toFixed(2)}:1 / 亮度差 ${gray.toFixed(3)}`);
}
if (errors.length) { console.error("PAGEERRORS:", errors); process.exitCode = 1; }
await browser.close();
