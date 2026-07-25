import { fetchArticles as websiteFetchArticles } from '../server/crawlers/websiteCrawler.js';

const cases = [
  { name: '第一财经', url: 'https://www.yicai.com', purpose: 'competitor' },
  { name: '新浪财经', url: 'https://finance.sina.com.cn', purpose: 'competitor' },
  { name: '中国能源网', url: 'https://www.china5e.com', purpose: 'competitor,policy' },
  { name: '金融界', url: 'https://www.jrj.com', purpose: 'competitor' },
  { name: '东方财富', url: 'https://www.eastmoney.com', purpose: '' },
];

for (const c of cases) {
  console.log(`\n=== ${c.name} ===`);
  try {
    const source = { name: c.name, url: c.url, type: 'website', config: { articleLimit: 3 } };
    const articles = await websiteFetchArticles(source);
    console.log(`SUCCESS: ${articles.length} articles`);
    for (const a of articles.slice(0, 3)) {
      const dateStr = a.publishDate ? new Date(a.publishDate).toISOString().slice(0,10) : 'no date';
      console.log(`  - [${dateStr}] ${a.title?.slice(0, 80)} | ${a.url}`);
    }
  } catch (e) {
    console.log(`FAILED: ${e.message}`);
  }
}
