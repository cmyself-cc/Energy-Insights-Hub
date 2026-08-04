# Task 10 Report: 新增 bjx source + 端到端活体冒烟 + 最终验证

**Status:** DONE_WITH_CONCERNS（一个无害的 lint 基线问题 + 一处脚本内容微偏差，详见下）
**Commit:** `2bd66a7` feat: add bjx energy source, live smoke script for challenge-aware crawler

## 1. DB Insert（先查重，只 INSERT）

- **Pre-check:** `SELECT id, url FROM sources WHERE url = 'https://energy.bjx.com.cn';` → 无输出（不存在），安全插入。
- **INSERT 语句:** 与 brief 完全一致（单条 INSERT，无任何 DELETE/UPDATE）。
- **插入结果回显:**

```
318|北极星能源网|https://energy.bjx.com.cn|1|{"strategy":"auto","articleLimit":10,"detailSelectors":{"title":"h1","content":".cc-article"}}
```

id=318，config JSON 完整。

## 2. 活体冒烟（首次运行即 PASS，未重试）

命令: `node scripts/smoke-bjx.mjs`，完整输出：

```
[website] HTML list found 20 candidate links (incl. sub-pages)
[website] WAF challenge detected for https://guangfu.bjx.com.cn/news/20260803/1506923.shtml
[website] Challenge solved via vm for bjx.com.cn
[website] Skipping article older than 7d: https://news.bjx.com.cn/html/20260727/1505924.shtml
[website] Skipping article older than 7d: https://news.bjx.com.cn/html/20260724/1505676.shtml
[website] Skipping article older than 7d: https://news.bjx.com.cn/html/20260727/1506010.shtml
[website] Skipping article older than 7d: https://news.bjx.com.cn/html/20260724/1505713.shtml
[website] Skipping article older than 7d: https://news.bjx.com.cn/html/20260721/1505148.shtml
[website] Skipping article older than 7d: https://news.bjx.com.cn/html/20260728/1506107.shtml
[website] Skipping article older than 7d: https://news.bjx.com.cn/html/20260722/1505280.shtml
[website] Skipping article older than 7d: https://news.bjx.com.cn/html/20260728/1506202.shtml
[website] Skipping article older than 7d: https://news.bjx.com.cn/html/20260728/1506071.shtml
[website] Skipping article older than 7d: https://news.bjx.com.cn/html/20260720/1504932.shtml
[website] HTML list returned 10 articles
Fetched 10 articles in 8.6s
- [2026-08-03] 两部门印发《新型电力系统建设"十五五"规划》 | content:705字
- [2026-08-03] 第八师石玛兵地融合陕建100万千瓦"草光互补"光伏项目支架采购中标结果公示 | content:5073字
- [2026-08-03] 中电工程总经理李屹立：从五大创新看"十五五"新型能源体系建设 | content:2530字
- [2026-08-03] 协合新能源：附属公司与特斯拉签订469MW光伏项目售电协议 | content:5156字
- [2026-07-31] 全球能源价格走势分析报告（2026年7月） | content:7712字
- [2026-08-03] 集中供冷来了！全国首个废弃矿井水集中供冷项目在徐矿建成投运 | content:975字
- [2026-07-30] 中能财经 | 今夏动力煤市场为何"燃"不起来？ | content:6964字
- [2026-07-30] 国家能源局：推动油气与新能源、CCUS、伴生资源协同开发 | content:579字
- [2026-07-29] 中国海油2026年年中工作会议召开 | content:2509字
- [2026-08-03] *ST天宜被责令改正 | content:408字
PASS
```

断言核验：10 篇（≥5 ✓）；正文 408–7712 字（均 ≥100 ✓）；日期 2026-07-29 ~ 2026-08-03（今天 2026-08-04，均在近 8 天内 ✓）；耗时 8.6s。
关键日志：`WAF challenge detected`（首个详情页触发阿里云 WAF 挑战）→ `Challenge solved via vm`（vm 沙箱解算成功，cookie 被 bjx.com.cn 全站接受，后续 9 个详情请求无再触发），maxAgeDays 过滤正常工作（跳过 10 条超龄文章）。

## 3. 最终验证

- **vitest（scoped）:** `npx vitest run server/crawlers/websiteCrawler.test.js server/crawlers/challenge.test.js`
  → `Test Files  2 passed (2)` / `Tests  32 passed (32)`（6.48s）
- **eslint（scoped，本任务唯一触碰文件）:** `npx eslint scripts/smoke-bjx.mjs --max-warnings 0` → 0 errors 0 warnings（修复后，见偏差 1）。另 `node --check` 语法校验通过。
- **eslint（全量 `npm run lint`）:** 退出码 1，23 problems（15 errors, 8 warnings）。全部位于本任务未触碰的文件：src/*、server/services/*、server/routes/sources.js、server/lib/llmAlias.js，以及 challenge.js（2× no-empty）与 websiteCrawler.js（2× no-empty + 1× no-unused-vars）。后两者在工作区相对 HEAD 无改动（`git status` 确认），即这些是 tasks 1–9 已提交并经 review 的基线，非本任务引入。**本任务零新增 lint 问题。**
- **build:** `npm run build` → `✓ 60 modules transformed` / `✓ built in 861ms`（chunk-size 警告为既有提示，非错误）。

## 4. Files changed

| 文件 | 变更 |
|---|---|
| `data/energy_insights.db` | INSERT 1 行（id=318，北极星能源网）；gitignored 运行时数据 |
| `scripts/smoke-bjx.mjs` | 新建，35 行；已提交 `2bd66a7` |

## 5. Self-review findings

- 冒烟脚本仅 readonly 打开 DB，只 import `websiteCrawler.js`，未触碰 Express/migrations，符合 brief 约束。
- 活体运行证明端到端链路：列表抓取 → WAF 挑战检测 → vm 解算 → cookie 缓存（registrable domain bjx.com.cn 覆盖 guangfu/news 子域）→ GBK 子页解码 → maxAgeDays 过滤 → detailSelectors(.cc-article) 正文提取，全部生效。
- 既有 website 源无回归：websiteCrawler.test.js 14 个测试全绿。

## 6. Deviations

1. **smoke-bjx.mjs 加了一行 `/* global process */`**（brief 原稿无）。原因：`.eslintrc.cjs` 的 node env 仅覆盖 `server/**/*.js`，`scripts/` 下 `process` 触发 no-undef，违反"零新增 lint 问题"验收项。相比改动共享 eslint 配置（会引入第二个变更文件），文件内 directive 是最小侵入修复。不影响脚本行为。
2. `npm run lint` 全量不通过，但失败全部为既有基线（见第 3 节），非本任务引入；brief 验收语境为"无新增问题"，故判定满足。若后续要求全量 lint 绿，需另开清理任务（challenge.js/websiteCrawler.js 的 4 处 no-empty 建议用 `// ignored` 注释或 `eslint-disable-next-line` 处理，属 tasks 1–9 遗留）。
