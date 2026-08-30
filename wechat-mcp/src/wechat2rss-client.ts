import axios, { AxiosInstance } from 'axios';

export interface WeChatFeed {
  id: string;
  name: string;
}

export interface WeChatArticle {
  id: string;
  mpId: string;
  title: string;
  picUrl: string;
  publishTime: number;
  link: string;
}

export interface WeChatAccount {
  id: number;
  name: string;
  available: boolean;
  needCheck: boolean;
}

function decodeEntities(s: string): string {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 从微信文章链接提取文章 id（/s/xxx） */
function extractArticleId(link: string): string {
  const m = String(link || '').match(/\/s\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : String(link || '');
}

interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  content: string;
}

/** 正则解析 RSS（wechat2rss 的 /feed/:id.xml），提取 title/link/pubDate/content:encoded */
function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(String(xml || ''))) !== null) {
    const block = m[1];
    const get = (tag: string): string => {
      const r = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return r ? decodeEntities(r[1]) : '';
    };
    items.push({
      title: get('title'),
      link: get('link'),
      pubDate: get('pubDate'),
      content: get('content:encoded'),
    });
  }
  return items;
}

/**
 * wechat2rss（xlab）客户端。工具接口与 wewe-rss 版保持一致（EIHC 零改动），
 * 仅数据源切换：
 * - 文章列表 / 全文：拉 /feed/:id.xml（RSS，content:encoded 即全文）
 * - 时间搜索：/api/query
 * - 添加订阅：/addurl?url=<文章链接>
 * - wechat2rss 无手动刷新接口（自动更新，平均 6h），refreshFeed 为 no-op
 */
export class Wechat2RssClient {
  private client: AxiosInstance;
  private token: string;
  private baseURL: string;
  // 全文缓存：crawler 先拉列表（带全文）再逐篇取全文，同轮内必命中
  private fulltextCache = new Map<string, { html: string; ts: number }>();
  private readonly CACHE_TTL = 30 * 60 * 1000;

  constructor(baseURL: string, token?: string) {
    this.baseURL = baseURL;
    this.client = axios.create({
      baseURL,
      timeout: 60 * 1e3,
    });
    this.token = token || '';
  }

  private authQuery(): string {
    return this.token ? `k=${encodeURIComponent(this.token)}` : '';
  }

  async listAccounts(): Promise<WeChatAccount[]> {
    const res = await this.client.get(`/login/list?${this.authQuery()}`);
    const items = res.data?.data || [];
    return items.map((a: any) => ({
      id: a.id,
      name: a.name || '',
      available: Boolean(a.available),
      needCheck: Boolean(a.needCheck),
    }));
  }

  async listFeeds(): Promise<WeChatFeed[]> {
    const res = await this.client.get(`/list?${this.authQuery()}&size=1000`);
    const items = res.data?.data || [];
    return items.map((f: any) => ({
      id: String(f.id),
      name: f.name || '',
    }));
  }

  /**
   * 拉取公众号文章列表（RSS 解析）。wechat2rss 的 feed 含全文
   * （content:encoded），解析时写入进程内缓存供 getArticleFulltext 使用。
   */
  async getFeedArticles(feedId: string, limit = 20, _page = 1): Promise<WeChatArticle[]> {
    const res = await this.client.get(`/feed/${feedId}.xml`, {
      responseType: 'text',
    });
    const items = parseRssItems(res.data);
    return items.slice(0, limit).map((it) => {
      const id = extractArticleId(it.link);
      if (it.content) {
        this.fulltextCache.set(id, { html: it.content, ts: Date.now() });
      }
      const pub = Date.parse(it.pubDate);
      return {
        id,
        mpId: feedId,
        title: it.title,
        picUrl: '',
        publishTime: Number.isNaN(pub) ? 0 : pub / 1000,
        link: it.link,
      };
    });
  }

  /** 单篇全文：从缓存取（get_feed_articles 已预热）；miss 时抛错提示先拉列表 */
  async getArticleFulltext(articleId: string): Promise<string> {
    const cached = this.fulltextCache.get(articleId);
    if (cached && Date.now() - cached.ts < this.CACHE_TTL) {
      return cached.html;
    }
    throw new Error(
      `文章 ${articleId} 全文不在缓存中，请先通过 get_feed_articles 拉取该公众号列表（wechat2rss 无按单篇 id 取全文的接口）`,
    );
  }

  /** 按时间范围查询文章（/api/query）。wechat2rss 返回不含文章链接，link 留空 */
  async searchArticlesByTime(
    startTs: number,
    endTs: number,
    feedId?: string,
    limit = 100,
  ): Promise<any[]> {
    const d = (ts: number) => {
      const x = new Date(ts * 1000);
      const p = (n: number) => String(n).padStart(2, '0');
      return `${x.getFullYear()}${p(x.getMonth() + 1)}${p(x.getDate())}`;
    };
    const params = [
      this.authQuery(),
      `after=${d(startTs)}`,
      `before=${d(endTs)}`,
      'content=0',
    ];
    if (feedId) params.push(`bid=${feedId}`);
    const res = await this.client.get(`/api/query?${params.join('&')}`);
    const items = res.data?.data || [];
    return items.slice(0, limit).map((a: any) => ({
      title: a.title || '',
      bizId: String(a.biz_id || ''),
      bizName: a.biz_name || '',
      publishTime: new Date(a.created).getTime() / 1000,
      publishTimeFormatted: a.created || '',
    }));
  }

  /** 通过一篇公众号文章链接添加订阅（/addurl） */
  async addFeedByUrl(wxsLink: string): Promise<{ id: string; name: string }> {
    const res = await this.client.get(
      `/addurl?${this.authQuery()}&url=${encodeURIComponent(wxsLink)}`,
    );
    const feedUrl: string = res.data?.data || '';
    const m = String(feedUrl).match(/\/feed\/([^.]+)\./);
    const id = m ? m[1] : '';
    return { id, name: '' };
  }

  /** wechat2rss 无手动刷新接口（自动更新，平均 6h） */
  async refreshFeed(_feedId: string): Promise<void> {
    // no-op：wechat2rss 后台自动更新
  }
}
