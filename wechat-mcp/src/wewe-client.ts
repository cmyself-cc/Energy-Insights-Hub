import axios, { AxiosInstance } from 'axios';

export interface WeWeAccount {
  id: string;
  name: string;
  status: number;
}

export interface WeWeFeed {
  id: string;
  name: string;
  intro: string;
  cover: string;
  syncTime: number;
  updateTime: number;
}

export interface WeWeArticle {
  id: string;
  mpId: string;
  title: string;
  picUrl: string;
  publishTime: number;
}

export interface WeWeMpInfo {
  id: string;
  cover: string;
  name: string;
  intro: string;
  updateTime: number;
}

export class WeWeClient {
  private client: AxiosInstance;
  private authCode?: string;

  constructor(baseURL: string, authCode?: string) {
    this.client = axios.create({
      baseURL,
      timeout: 60 * 1e3,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    this.authCode = authCode;
  }

  private getHeaders() {
    return this.authCode ? { Authorization: this.authCode } : {};
  }

  /**
   * 调用 tRPC 接口（v10 batch 格式）
   */
  private async trpcCall(
    path: string,
    input?: Record<string, unknown>,
  ): Promise<any> {
    const payload: Record<string, { json: Record<string, unknown> }> = {};
    if (input) {
      payload['0'] = { json: input };
    }

    const res = await this.client.get(`/trpc/${path}`, {
      params: input ? payload : undefined,
      headers: this.getHeaders(),
    });

    // tRPC v10 batch 响应格式：[{ result: { data: ... } }]
    const results = Array.isArray(res.data) ? res.data : [res.data];
    return results[0]?.result?.data;
  }

  private async trpcMutate(
    path: string,
    input?: Record<string, unknown>,
  ): Promise<any> {
    const payload: Record<string, { json: Record<string, unknown> }> = {};
    if (input) {
      payload['0'] = { json: input };
    }

    const res = await this.client.post(`/trpc/${path}`, payload, {
      headers: this.getHeaders(),
    });

    const results = Array.isArray(res.data) ? res.data : [res.data];
    return results[0]?.result?.data;
  }

  async listAccounts(): Promise<WeWeAccount[]> {
    const data = await this.trpcCall('account.list', { limit: 1000 });
    return data?.items || [];
  }

  async listFeeds(): Promise<WeWeFeed[]> {
    const res = await this.client.get('/feeds', {
      headers: this.getHeaders(),
    });
    return res.data || [];
  }

  async getFeedArticles(
    feedId: string,
    limit = 20,
    page = 1,
  ): Promise<WeWeArticle[]> {
    const res = await this.client.get(`/feeds/${feedId}.json`, {
      // 列表场景只要元数据；显式 summary 避免触发全文抓取
      params: { limit, page, mode: 'summary' },
      headers: this.getHeaders(),
    });
    const items = res.data?.items || [];
    return items.map((item: any) => this.normalizeArticle(item, feedId));
  }

  async getAllArticles(limit = 1000, page = 1): Promise<WeWeArticle[]> {
    const [feedRes, allRes] = await Promise.all([
      this.client.get('/feeds', { headers: this.getHeaders() }),
      this.client.get('/feeds/all.json', {
        params: { limit, page, mode: 'summary' },
        headers: this.getHeaders(),
      }),
    ]);

    const feeds: WeWeFeed[] = feedRes.data || [];
    const nameToId = new Map(feeds.map((f) => [f.name, f.id]));

    const items = allRes.data?.items || [];
    return items.map((item: any) => {
      const mpId = nameToId.get(item.author?.name) || item.author?.name || '';
      return this.normalizeArticle(item, mpId);
    });
  }

  private normalizeArticle(item: any, mpId: string): WeWeArticle {
    const publishTime = item.publishTime
      ? Number(item.publishTime)
      : item.date_modified
        ? Math.floor(new Date(item.date_modified).getTime() / 1000)
        : 0;

    return {
      id: item.id || '',
      mpId,
      title: item.title || '',
      picUrl: item.picUrl || item.image || '',
      publishTime,
    };
  }

  async getMpInfo(wxsLink: string): Promise<WeWeMpInfo | null> {
    const data = await this.trpcMutate('platform.getMpInfo', { wxsLink });
    return data?.[0] || null;
  }

  async addFeed(feed: WeWeFeed): Promise<any> {
    return this.trpcMutate('feed.add', {
      id: feed.id,
      mpName: feed.name,
      mpCover: feed.cover,
      mpIntro: feed.intro,
      updateTime: feed.updateTime,
      status: 1,
    });
  }

  async refreshFeed(mpId: string): Promise<void> {
    await this.trpcMutate('feed.refreshArticles', { mpId });
  }

  async getArticleFulltext(articleId: string): Promise<string> {
    // wewe-rss 没有按 id 取单篇全文的接口；全文由 wewe-rss 自己在生成
    // feed 时抓取并嵌入 JSON 的 content_html（FEED_MODE=fulltext，
    // 进程内 LRU 缓存）。这里扫描 /feeds/all.json 按文章 id 匹配。
    const limit = 300;
    const maxPages = 2;
    for (let page = 1; page <= maxPages; page++) {
      const res = await this.client.get('/feeds/all.json', {
        params: { limit, page, mode: 'fulltext' },
        headers: this.getHeaders(),
        // 冷缓存时 wewe-rss 需逐篇抓全文，可能耗时数分钟
        timeout: 300 * 1e3,
      });
      const items: any[] = res.data?.items || [];
      const hit = items.find((item) => item.id === articleId);
      if (hit) {
        const html = typeof hit.content_html === 'string' ? hit.content_html : '';
        if (!html || html.includes('获取全文失败')) {
          throw new Error(
            `wewe-rss 未能抓取文章 ${articleId} 的全文（可能微信风控或链接失效），请稍后重试`,
          );
        }
        return html;
      }
      if (items.length < limit) {
        break;
      }
    }
    throw new Error(
      `文章 ${articleId} 未出现在 wewe-rss feed 最近 ${limit * maxPages} 条中，无法获取全文`,
    );
  }
}
