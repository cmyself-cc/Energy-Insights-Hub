import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Wechat2RssClient } from './wechat2rss-client.js';

const WECHAT2RSS_BASE_URL = process.env.WECHAT2RSS_BASE_URL || 'http://localhost:8082';
const WECHAT2RSS_TOKEN = process.env.WECHAT2RSS_TOKEN || undefined;
const PORT = parseInt(process.env.MCP_PORT || '4001', 10);
const HOST = process.env.MCP_HOST || '0.0.0.0';

const wechat2rss = new Wechat2RssClient(WECHAT2RSS_BASE_URL, WECHAT2RSS_TOKEN);

function createMcpServer(): Server {
  const server = new Server(
    {
      name: 'wewe-rss-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'list_wechat_accounts',
          description: '列出已绑定的微信读书账号及其状态',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'list_wechat_feeds',
          description: '列出所有已订阅的微信公众号',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'get_feed_articles',
          description: '获取某个公众号的最新文章列表',
          inputSchema: {
            type: 'object',
            properties: {
              feedId: {
                type: 'string',
                description: '公众号 feed ID，例如 MP_WXS_1234567890',
              },
              limit: {
                type: 'number',
                description: '返回文章数量，默认 20',
                default: 20,
              },
              page: {
                type: 'number',
                description: '分页页码，默认 1',
                default: 1,
              },
            },
            required: ['feedId'],
          },
        },
        {
          name: 'add_wechat_feed',
          description: '通过一篇公众号文章链接添加新的公众号订阅',
          inputSchema: {
            type: 'object',
            properties: {
              wxsLink: {
                type: 'string',
                description: '公众号文章链接，例如 https://mp.weixin.qq.com/s/xxxx',
              },
            },
            required: ['wxsLink'],
          },
        },
        {
          name: 'refresh_wechat_feed',
          description: '立即刷新某个公众号的最新文章',
          inputSchema: {
            type: 'object',
            properties: {
              feedId: {
                type: 'string',
                description: '公众号 feed ID',
              },
            },
            required: ['feedId'],
          },
        },
        {
          name: 'get_article_fulltext',
          description: '获取单篇公众号文章的全文 HTML',
          inputSchema: {
            type: 'object',
            properties: {
              articleId: {
                type: 'string',
                description: '文章 ID',
              },
            },
            required: ['articleId'],
          },
        },
        {
          name: 'search_articles_by_time',
          description: '按时间范围查询公众号文章，返回标题、链接、发布时间和公众号名称',
          inputSchema: {
            type: 'object',
            properties: {
              startTime: {
                type: 'string',
                description: '开始时间，ISO 8601 格式，例如 2026-07-01T00:00:00+08:00',
              },
              endTime: {
                type: 'string',
                description: '结束时间，ISO 8601 格式，例如 2026-07-11T23:59:59+08:00',
              },
              feedId: {
                type: 'string',
                description: '可选，只查询某个公众号的 feed ID',
              },
              limit: {
                type: 'number',
                description: '最大返回数量，默认 100',
                default: 100,
              },
            },
            required: ['startTime', 'endTime'],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'list_wechat_accounts': {
          const accounts = await wechat2rss.listAccounts();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(accounts, null, 2),
              },
            ],
          };
        }

        case 'list_wechat_feeds': {
          const feeds = await wechat2rss.listFeeds();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(feeds, null, 2),
              },
            ],
          };
        }

        case 'get_feed_articles': {
          const { feedId, limit = 20, page = 1 } = args as {
            feedId: string;
            limit?: number;
            page?: number;
          };
          const articles = await wechat2rss.getFeedArticles(feedId, limit, page);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(articles, null, 2),
              },
            ],
          };
        }

        case 'add_wechat_feed': {
          const { wxsLink } = args as { wxsLink: string };
          const info = await wechat2rss.addFeedByUrl(wxsLink);
          return {
            content: [
              {
                type: 'text',
                text: `公众号已添加（feed id: ${info.id}）。文章将由 wechat2rss 自动抓取（平均 6h 更新）`,
              },
            ],
          };
        }

        case 'refresh_wechat_feed': {
          const { feedId } = args as { feedId: string };
          await wechat2rss.refreshFeed(feedId);
          return {
            content: [
              {
                type: 'text',
                text: `公众号 ${feedId}：wechat2rss 无手动刷新接口，将按自动更新周期（平均 6h）抓取`,
              },
            ],
          };
        }

        case 'get_article_fulltext': {
          const { articleId } = args as { articleId: string };
          const html = await wechat2rss.getArticleFulltext(articleId);
          return {
            content: [
              {
                type: 'text',
                text: html,
              },
            ],
          };
        }

        case 'search_articles_by_time': {
          const { startTime, endTime, feedId, limit = 100 } = args as {
            startTime: string;
            endTime: string;
            feedId?: string;
            limit?: number;
          };

          const startTs = Math.floor(new Date(startTime).getTime() / 1000);
          const endTs = Math.floor(new Date(endTime).getTime() / 1000);

          if (Number.isNaN(startTs) || Number.isNaN(endTs)) {
            throw new Error('时间格式不正确，请使用 ISO 8601 格式');
          }

          const filtered = await wechat2rss.searchArticlesByTime(
            startTs,
            endTs,
            feedId,
            limit,
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(filtered, null, 2),
              },
            ],
          };
        }

        default:
          throw new Error(`未知工具: ${name}`);
      }
    } catch (err: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${err.message || String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

const app = express();

// 允许跨域，便于局域网中的其他客户端连接
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  next();
});

const transports: Record<string, { transport: SSEServerTransport; server: Server }> = {};

app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  const server = createMcpServer();

  transports[transport.sessionId] = { transport, server };

  // 注意：必须监听 res（ServerResponse）的 close——它只在连接真正断开时触发；
  // 若监听 req（IncomingMessage）的 close，GET 请求一完成（几乎立即）就会触发，
  // 导致 transport 被立刻删除，后续 POST /messages 全部 400。
  res.on('close', async () => {
    const entry = transports[transport.sessionId];
    if (entry) {
      await entry.server.close();
      delete transports[transport.sessionId];
    }
  });

  await server.connect(transport);
});

app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const entry = transports[sessionId];

  if (!entry) {
    res.status(400).send('No active SSE transport found');
    return;
  }

  await entry.transport.handlePostMessage(req, res);
});

app.listen(PORT, HOST, () => {
  console.log(`WeChat2RSS MCP server running at http://${HOST}:${PORT}`);
  console.log(`SSE endpoint: http://${HOST}:${PORT}/sse`);
  console.log(`Connected to wechat2rss: ${WECHAT2RSS_BASE_URL}`);
});
