# 混沌能源智库

一个用于收集、分析和展示能源行业动态的智能平台。

## 功能特性

- **多源数据聚合**：支持RSS、网站爬虫、微信MCP等多种数据源
- **智能分类**：自动识别竞争情报、政策法规、技术创新、行业动态
- **AI驱动分析**：使用LLM生成摘要、提取关键词、生成报告
- **实时监控**：定时任务自动抓取最新信息
- **可视化展示**：清晰的信息流展示，支持筛选和搜索
- **报告生成**：支持自定义模板，自动生成行业分析报告

## 技术栈

- **前端**：React + Vite
- **后端**：Node.js + Express
- **数据库**：SQLite
- **AI**：OpenAI API (支持多种LLM提供商)
- **部署**：Docker + Docker Compose

## 快速开始

### 环境要求

- Node.js >= 18
- npm 或 yarn

### 安装步骤

1. 克隆仓库
```bash
git clone https://github.com/cmyself-cc/Energy-Insights-Hub.git
cd Energy-Insights-Hub
```

2. 安装依赖
```bash
npm install
```

3. 配置环境变量
```bash
cp .env.example .env
```

编辑 `.env` 文件，配置以下变量：
```env
# LLM API配置（必需）
LLM_API_KEY=your_api_key_here
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4

# 服务端口
PORT=3001

# 数据库路径
DATABASE_PATH=./data/energy_insights.db
```

4. 启动开发服务器
```bash
npm run dev
```

访问 http://localhost:3001

### 生产部署

使用Docker部署：

```bash
# 构建镜像
docker build -t energy-insights-hub .

# 运行容器
docker run -d \
  -p 3001:3001 \
  -v $(pwd)/data:/app/data \
  --env-file .env \
  energy-insights-hub
```

或使用Docker Compose：

```bash
docker-compose up -d
```

## 项目结构

```
Energy-Insights-Hub/
├── server/              # 后端代码
│   ├── services/        # 业务逻辑
│   ├── routes/          # API路由
│   ├── crawlers/        # 数据爬虫
│   └── index.js         # 入口文件
├── src/                 # 前端代码
│   ├── components/      # React组件
│   ├── pages/           # 页面
│   └── App.jsx          # 主应用
├── wechat-mcp/          # 微信公众号MCP服务器
│   ├── src/             # MCP服务器源码
│   ├── README.md        # 微信MCP配置说明
│   └── package.json     # 依赖配置
├── data/                # 数据库文件
├── docker-compose.yml   # Docker配置
└── package.json         # 项目依赖
```

## 配置数据源

在管理界面中添加数据源：

### 1. RSS源
直接输入RSS URL即可。

### 2. 网站爬虫
配置URL和CSS选择器，支持自动发现子页面。

### 3. 微信公众号（需要额外部署）

微信公众号数据需要通过 MCP 服务接入。本项目提供了 MCP 服务器代码（位于 `wechat-mcp/` 目录），但需要先部署第三方微信 RSS 服务。

**推荐方案：**

#### 方案一：wechat-rss（推荐）
- **项目地址**：https://wechat2rss.xlab.app/
- **特点**：商业服务，稳定可靠，约 15 元/月，无封号风险
- **部署**：访问官网注册，添加公众号后获取 RSS 地址

#### 方案二：wewe-rss（开源免费）
- **项目地址**：https://github.com/cooderl/wewe-rss
- **特点**：开源免费，基于微信读书 API，需要微信扫码登录
- **风险**：可能存在账号风险，建议用小号

**配置步骤：**

1. 部署微信 RSS 服务（wechat-rss 或 wewe-rss）
2. 启动 MCP 服务器：
   ```bash
   cd wechat-mcp
   npm install
   cp .env.example .env
   # 编辑 .env，配置 WEWE_BASE_URL 指向你的微信 RSS 服务
   npm start
   ```
3. 在 Energy Insights Hub 管理界面添加数据源：
   - 类型：`wechat_mcp`
   - URL：`http://localhost:4001/sse`

详细说明请参考 `wechat-mcp/README.md`。

## API文档

主要API端点：

- `GET /api/insights` - 获取insights列表
- `POST /api/tracker/run` - 手动触发数据抓取
- `GET /api/reports` - 获取报告列表
- `POST /api/reports/generate` - 生成报告

详细API文档请查看 `server/routes/` 目录。

## 开发

```bash
# 启动后端（端口3001）
npm run dev:server

# 启动前端（端口5173）
npm run dev:client

# 运行测试
npm test

# 构建生产版本
npm run build
```

## 许可证

MIT

## 贡献

欢迎提交Issue和Pull Request！
