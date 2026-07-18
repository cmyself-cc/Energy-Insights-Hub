import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import db from "../db.js";

// Per-purpose LLM semantic prompts (spec: 竞争情报分析师 / 政策分析师 / 技术分析师)
export const PURPOSE_PROMPTS = {
  competitor: `你是一名竞争情报分析师，只保留能识别出主体公司、事件类型、合作方、交易规模等竞争情报要素的资讯。剔除以下资讯：
1、通篇主要/核心资讯要点不涉及能源企业竞争动态的资讯，例如：不包含主体公司的投资、收购、合作、签约、合资、并购等事件
2、通篇主要/核心资讯要点仅为股价行情、涨停跌停等金融市场数据，不包含实质企业事件的资讯
3、通篇主要/核心资讯要点为人事变动、获奖、广告软文等无竞争情报价值的内容`,
  policy: `你是一名政策分析师，只保留能识别出政策名称、发文机构、受影响行业等政策要素的资讯。剔除以下资讯：
1、通篇主要/核心资讯要点不涉及政策内容的资讯，例如：不包含政策、规划、通知、批复、标准、方案、意见等的发布或解读
2、通篇主要/核心资讯要点仅为会议报道、培训、学术研讨、获奖等而非政策发布或政策解读的资讯
3、无法识别出发文机构或受影响行业的资讯`,
  tech: `你是一名技术分析师，只保留能识别出技术领域、创新点、应用场景等技术要素的资讯。剔除以下资讯：
1、通篇主要/核心资讯要点不涉及能源技术进展的资讯，例如：不包含突破、创新、研发、专利、量产、示范应用等内容
2、通篇主要/核心资讯要点仅为产品推广、广告、赞助、招聘等而非技术进展的资讯
3、无法识别出技术领域、创新点或应用场景的资讯`
};

// Insert only if missing so edited prompts are never overwritten.
export function seedPurposePrompts() {
  const hasPrompt = db.prepare("SELECT id FROM filter_config WHERE type = 'semantic' AND purpose = ? LIMIT 1");
  const insertPrompt = db.prepare("INSERT INTO filter_config (type, content, active, purpose) VALUES ('semantic', ?, 1, ?)");
  for (const [purpose, content] of Object.entries(PURPOSE_PROMPTS)) {
    if (hasPrompt.get(purpose)) continue;
    insertPrompt.run(content, purpose);
  }
}

// Run standalone: node server/seeds/seedPurposePrompts.js
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  seedPurposePrompts();
  console.log(JSON.stringify(
    db.prepare("SELECT id, purpose, active FROM filter_config WHERE type = 'semantic'").all(),
    null, 2
  ));
}
