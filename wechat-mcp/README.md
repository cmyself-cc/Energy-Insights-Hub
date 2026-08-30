# 微信公众号 MCP 服务器

把微信公众号订阅能力封装成 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 服务，支持通过 SSE 传输供 Energy Insights Hub 调用。

## 架构说明

```
第三方微信RSS服务 → MCP服务器(本目录) → Energy Insights Hub
(wewe-rss/wechat-rss)                    (AI分析平台)
```

本 MCP 服务器作为中间层，将微信 RSS 服务的数据转换为 MCP 协议，供 Energy Insights Hub 调用。

## 前置要求

需要部署以下任一微信 RSS 服务：

### 方案一：wechat-rss（推荐）

**项目地址**：https://wechat2rss.xlab.app/

**特点**：
- 商业服务，稳定可靠
- 支持付费订阅（约 15 元/月）
- 提供标准 RSS 输出
- 无需微信账号登录，无封号风险

**部署步骤**：
1. 访问官网注册账号
2. 添加需要订阅的公众号
3. 获取 RSS 地址
4. 配置本 MCP 服务器的 `WEWE_BASE_URL` 环境变量指向该地址

### 方案二：wewe-rss（开源免费）

**项目地址**：https://github.com/cooderl/wewe-rss

**特点**：
- 开源免费，可自建
- 基于微信读书 API
- 需要微信扫码登录
- 可能存在账号风险（建议用小号）

**部署步骤**：
1. 克隆项目并安装依赖
2. 使用微信扫描二维码登录
3. 添加公众号订阅
4. 配置本 MCP 服务器的 `WEWE_BASE_URL` 环境变量

## MCP 工具列表

| Tool | 说明 |
|------|------|
| `list_wechat_accounts` | 列出已绑定的微信读书账号 |
| `list_wechat_feeds` | 列出所有已订阅的微信公众号 |
| `get_feed_articles` | 获取某个公众号的最新文章列表 |
| `add_wechat_feed` | 通过文章链接添加新的公众号订阅 |
| `refresh_wechat_feed` | 立即刷新某个公众号的文章 |
| `get_article_fulltext` | 获取单篇公众号文章的全文 HTML |
| `search_articles_by_time` | 按时间范围查询公众号文章 |

## 安装

```bash
cd wechat-mcp
npm install
```

## 配置

```bash
cp .env.example .env
# 按需修改 .env
```

关键环境变量：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `WEWE_BASE_URL` | 微信 RSS 服务地址 | `http://localhost:4000` |
| `WEWE_AUTH_CODE` | 微信 RSS 服务鉴权码 | 空 |
| `MCP_PORT` | MCP 服务端口 | `4001` |
| `MCP_HOST` | 监听地址 | `0.0.0.0` |

## 启动

开发模式：

```bash
npm run dev
```

生产模式：

```bash
npm run build
npm run start
```

## 在 Energy Insights Hub 中配置

1. 启动本 MCP 服务器（默认端口 4001）
2. 在 Energy Insights Hub 管理界面添加数据源：
   - 类型：`wechat_mcp`
   - URL：`http://localhost:4001/sse`
3. 配置抓取参数（可选）：
   - `feedId`：指定公众号 ID
   - `articleLimit`：每次抓取文章数
   - `perFeedLimit`：每个公众号抓取上限

## Docker 部署

```bash
docker build -t wechat-mcp .
docker run -d -p 4001:4001 \
  -e WEWE_BASE_URL=http://your-wechat-rss-url \
  wechat-mcp
```

## 局域网访问

MCP server 默认监听 `0.0.0.0:4001`，局域网内其他机器可通过本机 IP 访问：

```text
http://<你的局域网IP>:4001/sse
```

### 获取本机局域网 IP

macOS / Linux：

```bash
ifconfig | grep 'inet ' | grep -v '127.0.0.1'
# 或
ipconfig getifaddr en0
```

### 防火墙 / 安全组

- macOS：如弹出"是否允许 node 接受传入网络连接"，请选择"允许"。
- 如需跨机器访问，请确保本机防火墙放行 `4001` 端口。

## 故障排查

### 无法连接微信 RSS 服务

- 检查 `WEWE_BASE_URL` 是否正确
- 确认微信 RSS 服务正在运行
- 检查网络连接和防火墙设置

### 无法获取文章全文

- 部分公众号可能限制了全文输出
- 检查微信 RSS 服务的日志
- 确认 RSS 源配置正确

## 许可证

MIT
