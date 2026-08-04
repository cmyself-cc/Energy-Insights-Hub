# WAF 挑战感知 Fetch 层设计

**日期：** 2026-08-04
**目标：** 解决被 Aliyun WAF（`acw_sc__v2` JS 挑战）保护的站点详情页抓取失败问题，并修复一批直接影响抓取覆盖率的通用 bug。首个落地站点：`energy.bjx.com.cn`（北极星能源网）。
**非目标（留下一轮）：** 并发抓取、增量去重（跳过库中已有 URL）、策略记忆、Playwright 浏览器池、JSON API 拦截形状扩展。

## 背景与根因（实测验证）

对 `https://energy.bjx.com.cn` 实测当前爬虫，发现：

1. **详情页被 Aliyun WAF 拦截。** `news.bjx.com.cn`、`guangfu.bjx.com.cn` 等子域的详情页对纯 HTTP 请求返回挑战页（约 23KB）：页面内嵌混淆 JS，从 `var arg1='...'` 计算 `acw_sc__v2` cookie（`max-age=3600`）后重载。爬虫无法执行 JS，cheerio 解析挑战页 → 正文 0 字、日期回退为抓取当天。
2. **cookie 复用可行（已验证）。** 解出的 cookie 在同域其他文章、甚至其他子域（guangfu）均被服务端接受，1 小时有效期内无需重复解挑战。
3. **vm 沙箱可解挑战（已验证）。** 将挑战页全部 `<script>` 放入 Node `vm` 沙箱执行（shim `document`/`location`/`navigator`，拦截 `document.cookie` 赋值），毫秒级得到 cookie。该站点脚本无 `debugger` 陷阱。
4. **正文容器选择器不匹配。** bjx 正文在 `<div class="cc-article">`，不在 `DEFAULT_DETAIL_SELECTORS` 内。
5. **通用 bug：** 子列表页抓取用裸 `.text()` 不走 GBK 解码（中文老站乱码）；偶发 `fetch failed` 无重试直接丢文章；`maxAgeDays` 只在 sitemap 路径生效，HTML 列表/RSS 路径旧文章混入。

## 架构

新增模块 `server/crawlers/challenge.js`，websiteCrawler 的所有 HTTP 抓取统一经过它：

```text
fetchHtmlSmart(url, opts, timeoutMs)
 ├─ 1. 查 cookie 缓存（内存 Map，key = 可注册域名，value = {cookie, expiresAt}）
 │      命中且未过期 → 请求附带 Cookie 头
 ├─ 2. fetchWithTimeout 抓取；解码沿用 decodeHtmlBuffer（GBK/GB2312/GB18030）
 │      网络错误（fetch failed/ETIMEDOUT/ECONNRESET）或 HTTP 429/5xx → 等 1s 重试 1 次
 ├─ 3. isChallengePage(html) 检测挑战特征（arg1= / acw_sc__v2 / aliyunwaf 标记）
 │      未检出 → 返回 HTML
 ├─ 4. vm 求解：solveChallengeInVm(html)
 │      提取页面所有 <script>，构造沙箱（见下），拦截 document.cookie 赋值
 │      得到 acw_sc__v2 → 写入缓存（TTL 取 cookie max-age，缺省 55 分钟）→ 带 cookie 重取
 ├─ 5. vm 失败或重取仍是挑战页 → Playwright 兜底：solveChallengeWithPlaywright(url)
 │      chromium.launch（复用 websiteCrawler 现有启动参数与反检测设置）
 │      goto(url) 等待页面完成挑战重载 → context.cookies() 取 acw_sc__v2
 │      写入缓存 → 关闭浏览器 → 纯 HTTP 带 cookie 重取
 └─ 6. 全部失败 → 抛出错误，由调用方按现有逻辑跳过该篇/继续策略级联
```

### 关键决策

- **cookie 按可注册域名缓存，而非按 host。** 实测 bjx 的 cookie 跨子域有效。可注册域名提取用简单启发式：`com.cn / net.cn / org.cn / gov.cn / com / net / org / co` 等常见后缀表，取后缀 + 前一标签。提取失败时退回完整 host 作 key（只影响复用率，不影响正确性）。
- **缓存仅在内存，不落库。** cookie 本身只有 1 小时寿命，重启后重解一次成本极低，避免 schema 变更。
- **vm 沙箱安全边界：** 沙箱不注入 `require`/`fs`/网络/进程能力；每段脚本 5 秒超时；捕获 cookie 后脚本后续报错可忽略（实测 cookie 赋值发生在 reload 调用之前）。站点均为管理员自行配置，视为可信输入；Playwright 兜底路径提供真实浏览器隔离。
- **Playwright 兜底只用于"解锁取 cookie"，取到后立即关闭浏览器回到纯 HTTP**，不做逐页浏览器抓取，控制资源开销。

## 组件改动清单

### 新增：`server/crawlers/challenge.js`

- `fetchHtmlSmart(url, opts, timeoutMs)` — 唯一对外入口，返回解码后的 HTML 字符串。
- `isChallengePage(html)` — 挑战页检测（`var arg1='` + `acw_sc__v2` / `aliyunwaf` 组合特征）。
- `solveChallengeInVm(html, pageUrl)` — vm 求解器；沙箱 shim：
  - `document.getElementById('renderData')` 返回挑战页 textarea 内容；
  - `document.cookie` setter 拦截并记录；`document.referrer = ''`；
  - `location = { href: pageUrl, reload: noop }`；`navigator.userAgent`；`window = sandbox`。
- `solveChallengeWithPlaywright(url)` — 浏览器兜底解锁器。
- cookie 缓存 Map + `getRegistrableDomain(hostname)` 辅助函数。

### 修改：`server/crawlers/websiteCrawler.js`

1. `fetchHtml`（现第 175 行附近）内部改为调用 `fetchHtmlSmart`，函数签名不变 —— 首页、详情页、sitemap 抓取全部自动获得挑战能力与重试。
2. `fetchArticles` 中子列表页抓取（现第 724–727 行，裸 `fetchWithTimeout(...).text()`）改为调用 `fetchHtmlSmart` —— 修复 GBK 乱码并获得挑战能力。
3. **maxAgeDays 全路径生效：** HTML 列表与 RSS 路径，文章实际提取到发布日期（非回退值）且超过 `maxAgeDays` 时跳过。`fetchArticleDetail` 的 `publishDate` 改为保留 `extractPublishedDate` 的 null 结果（不再原地回退为当前时间），回退由调用方在入库前处理，使旧文章过滤可行。
4. **正文容器兜底启发式：** `fetchArticleDetail` 中选择器命中结果为空或少于 200 字时，取 body 内文本最长的块级元素（div/section/td，排除 nav/header/footer/aside/script/style 子树）作为正文。仅当选择器失败时触发，不改变已配置选择器的行为。

### 修改：`server/routes/sources.js`

- `POST /:id/discover-subpages` 端点抓取首页改走 `fetchHtmlSmart`（同 GBK/挑战修复）。

### 数据：bjx source 配置

数据库 `sources` 表新增一条记录（插入，不改动任何现有数据）：

- `name`: `北极星能源网`
- `url`: `https://energy.bjx.com.cn`
- `type`: `website`，`active`: 1，`purpose`: 空（全部监控目的）
- `config`: `{"strategy":"auto","articleLimit":10,"detailSelectors":{"title":"h1","content":".cc-article"}}`

子列表页（各频道列表）后续用已有的"自动检测子列表页"UI 补充，不在本次范围。

## 错误处理

| 场景 | 行为 |
|---|---|
| 网络错误 / 429 / 5xx | 等 1s 重试 1 次，仍失败则抛出（详情页：跳过该篇；首页：策略级联继续） |
| vm 求解脚本执行异常/超时 | 记录日志，降级 Playwright |
| Playwright 解锁失败 | 记录日志，抛出；该源本轮无产出，tracker 记录失败原因 |
| 带 cookie 重取仍是挑战页 | 判定 cookie 失效，清除缓存条目，降级 Playwright 一次；仍失败则抛出 |
| cookie 缓存过期 | 惰性清理，下次请求重新解 |

日志统一 `[website]` 前缀，新增：挑战检出、vm/Playwright 解锁成功、cookie 缓存命中/失效。

## 测试

**单元测试（Vitest，随代码提交）：**

- `isChallengePage`：用本次捕获的 bjx 挑战页存为 `server/crawlers/__fixtures__/bjx-challenge.html`，断言检出；普通文章页断言不检出。
- `solveChallengeInVm`：对同一 fixture 求解，断言产出符合 `acw_sc__v2` 形态的 cookie（`/[0-9a-f]{10}-[0-9a-f]{40}/`）。arg1→cookie 计算是纯函数，fixture 固定则结果确定。
- `getRegistrableDomain`：`news.bjx.com.cn → bjx.com.cn`、`www.example.com → example.com`、异常输入退回原 host。
- cookie 缓存：写入后命中、过期后失效。
- maxAgeDays：HTML 列表路径对超龄文章过滤、对无日期文章放行。
- 子页 GBK 回归：构造 GBK 编码子页 fixture，断言解码正确。

**活体冒烟（验收步骤，不进 CI）：**

用项目爬虫对 bjx 源端到端运行，断言：文章数 ≥ articleLimit、`rawContent` 非空、`publishDate` 为文章真实日期而非当天。

## 验收标准

1. `npx vitest run` 全部通过；`npm run build` 通过。
2. bjx 源端到端抓取产出正文非空、日期正确的文章。
3. 现有 website 源抓取行为不回归（已有 fixture 测试通过）。
