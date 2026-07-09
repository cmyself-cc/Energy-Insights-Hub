# Sources 模块重构设计

## 背景

当前 tracker 只支持 `rss` 和 `scrape` 两类来源，且默认种入的 5 个 RSS 源都是示例 URL，无法真正抓取。项目根目录的 `sources.md` 已列出用户实际关注的数据来源，包括官方网站、能源媒体、财经媒体以及大量微信公众号。

本设计将来源分为三类：**网站**、**微信公众号**、**RSS**，并为每类实现独立的 crawler 模块；同时把 `sources.md` 接入系统配置，支持启动自动导入和配置页手动导入。

## 目标

1. 支持三类来源的统一接入与独立抓取：
   - `website`：从网站首页提取文章列表并逐篇抓取详情。
   - `wechat`：通过搜狗微信搜索公众号，获取最新文章列表。
   - `rss`：基于现有 rss-parser 迁移并规范化接口。
2. `sources.md` 自动/手动导入为数据库中的来源记录。
3. 每类 crawler 返回统一的数据结构，tracker 无需关心底层实现。
4. 前端 `SourcesPage` 支持按类型添加来源和导入 `sources.md`。

## 非目标

- 不引入 Python 环境或外部 WeChat API 服务。
- 不保证一定能绕过微信/网站的反爬；失败时记录原因并继续其他来源。
- 初期公众号 crawler 以“获取文章标题、链接、发布时间”为主，不要求抓取全文。

## 架构

```text
server/services/tracker.js
  └── sourceRegistry.dispatch(source)
        ├── RssCrawler      (server/crawlers/rssCrawler.js)
        ├── WebsiteCrawler  (server/crawlers/websiteCrawler.js)
        └── WechatCrawler   (server/crawlers/wechatCrawler.js)
```

新增 `server/crawlers/` 目录，所有 crawler 实现同一接口：

```ts
interface Crawler {
  fetchArticles(source: Source): Promise<Article[]>;
}

type Article = {
  title: string;
  summary: string;
  url: string;
  publishDate: string; // ISO 8601
  rawContent: string;
};
```

## 文件结构

```text
server/
  crawlers/
    index.js            # registry + dispatch + 通用工具
    rssCrawler.js       # RSS 抓取（由现有 rssFetcher.js 迁移）
    websiteCrawler.js   # 网站首页 → 文章列表 → 详情
    wechatCrawler.js    # 搜狗微信搜索 → 公众号文章列表
  lib/
    sourcesMdLoader.js  # 解析 sources.md
```

## 数据模型

`sources` 表已有字段足够承载新类型，通过 `type` 和 `config` 区分：

| type | url 含义 | config 示例 |
|---|---|---|
| `rss` | RSS Feed URL | `{ "articleLimit": 20 }` |
| `website` | 网站首页 URL | `{ "articleLimit": 5, "selectors": { "list": "article h2 a", "title": "h1", "content": "article" } }` |
| `wechat` | 可空 | `{ "accountName": "光伏们", "articleLimit": 3 }` |

新增枚举校验由后端在写入时保证，`001_init.sql` 不修改 schema，仅更新 seed/migration 说明。

## 各 Crawler 行为

### RssCrawler

- 复用现有 `rss-parser`。
- 限制返回条数（默认 20，可通过 `config.articleLimit` 覆盖）。
- 输出统一 Article 数组。

### WebsiteCrawler

1. 请求 `source.url`（首页）。
2. 用一组内置启发式选择器提取文章链接：
   - `article h2 a`
   - `article h3 a`
   - `.post-title a`
   - `.entry-title a`
   - `.news-list a`
   - `.list-item a`
3. 去重、过滤无效链接、限制数量（默认 5）。
4. 对每个链接发送请求，使用相同选择器提取标题与正文。
5. 请求间隔 500ms，避免触发频率限制。
6. 单篇文章失败不影响同来源其他文章。

### WechatCrawler

1. 从 `config.accountName` 读取公众号名称。
2. 构造搜狗搜索 URL：
   `https://weixin.sogou.com/weixin?type=1&query={accountName}`
3. 解析搜索结果页，获取公众号主页或最新文章列表链接。
4. 若进入文章列表页，解析标题、链接、发布时间。
5. 过滤 `lookbackHours` 范围外的文章。
6. 限制数量（默认 3）。
7. 返回统一 Article 数组（摘要可空，链接指向 `mp.weixin.qq.com`）。

> 反爬处理：随机桌面 User-Agent、请求间隔、失败重试一次。

## sources.md 导入

### 自动导入

- 后端启动时调用 `sourcesMdLoader.parse()`。
- 按 markdown 章节区分类型：
  - `## 官方网站/定向网站（可直接抓取）` → `website`
  - `## 微信公众号（需人工监测/参考标题）` → `wechat`
- 仅插入不存在的记录，判定键为 `name + url`（公众号 `url` 为空时仅按 `name`）。
- 默认 `active = 1`。

### 手动导入

- 新增 API：`POST /api/sources/import-md`。
- 前端 `SourcesPage` 增加“从 sources.md 导入”按钮。
- 返回导入统计：新增数量、已存在数量、失败原因。

## 前端改动

`SourcesPage.jsx`：

1. 添加来源表单：
   - type 下拉增加 `website`、`wechat`。
   - 选择 `wechat` 时显示“公众号名称”输入框。
   - 选择 `website` 时显示“首页 URL”。
2. 列表：
   - 显示 type badge。
   - 公众号显示 `config.accountName`。
3. 新增“从 sources.md 导入”按钮，点击后调用 API 并刷新列表。

## Tracker 调度改动

`server/services/tracker.js` 中：

- 移除对 `fetchRss` / `fetchScrape` 的直接调用。
- 改为 `const items = await sourceRegistry.fetchArticles(source)`。
- 保留去重、pre-filter、post-filter、LLM 处理流程不变。

## 错误处理

- crawler 内部捕获异常，返回已成功抓取的文章数组；tracker 将来源标记为失败仅当零篇文章且抛错。
- 反爬/超时失败记录到 `tracker_runs.message`。
- 网站单篇文章失败只记录日志，不计入来源失败。

## 测试与验证

1. 单元测试 `server/crawlers/` 的解析函数（使用本地 HTML fixture）。
2. 手动验证：
   - 启动后数据库自动出现 `sources.md` 中的来源。
   - 在 `SourcesPage` 运行 tracker，观察三类来源的进度与结果。
   - 检查 `insights` 表是否生成记录。

## 风险与回退

- 搜狗微信和各大网站可能随时改页面结构或封 IP，crawler 可能失效。应通过配置化选择器和清晰日志降低维护成本。
- 若公众号抓取长期不稳定，可改为仅做“手动转发链接解析”模式，无需改数据库 schema。
