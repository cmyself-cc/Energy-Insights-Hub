# Purpose-Based Monitoring Module Design

## Overview

Energy Insights Hub serves three monitoring purposes, each with distinct data sources and filtering logic. This design introduces a `purpose` field on sources and filter rules, enabling a single pipeline that routes each source through purpose-appropriate filtering.

## Three Purposes

| Purpose | Description | Example Events |
|---------|-------------|----------------|
| `competitor` | Competitor/partner activity monitoring | Investments, acquisitions, partnerships, signings |
| `policy` | Energy policy monitoring | New regulations, standards, government notices |
| `tech` | Technology breakthrough monitoring | R&D breakthroughs, patents, first-of-kind deployments |

## Source Grouping

Each source is tagged with one or more purposes. A source can serve multiple purposes.

| purpose | Source Types | Example Sources |
|---------|-------------|-----------------|
| `competitor` | `wechat_mcp`, `website` | WeChat MCP aggregated accounts, 财新能源, OilPrice |
| `policy` | `website`, `rss` | 国家能源局, 中国石油官网, 美国能源信息署 |
| `tech` | `wechat_mcp`, `website` | Industry WeChat accounts, Carbon Brief, 伍德麦肯兹 |

- Tavily is NOT used as a source type; it is reserved for future active querying.

## Filter Rules by Purpose

Three-layer progressive filter structure, independently configured per purpose:

| purpose | Subject Keywords (enterprise) | Include Keywords (include_keyword) | Exclude Keywords (exclude_keyword) |
|---------|------------------------------|-----------------------------------|-----------------------------------|
| `competitor` | Company names: 中石油, 宁德时代, 国家电网, etc. | 投资, 收购, 合作, 签约, 合资, 并购 | 股价, 涨停, 广告, 人事 |
| `policy` | Government bodies: 国家能源局, 国家发改委, 交通部, 生态环境部, 工信部 | 政策, 规划, 通知, 批复, 标准, 方案, 意见 | 培训, 会议, 学术, 获奖 |
| `tech` | Tech domains: 新能源, 储能, 光伏, 油气, CCUS, 氢能, 锂电池, 燃料电池 | 突破, 创新, 研发, 专利, 首次, 发布, 量产 | 获奖, 任命, 推广, 广告 |

## Keyword Gate Logic

All three purposes use the same unified logic:

```
(subject_keywords OR include_keywords) AND NOT exclude_keywords
```

- **Subject keywords** are the anchor: a company name, a government body, or a tech domain term.
- **Include keywords** are the event/type qualifier: investment, policy, breakthrough.
- **Exclude keywords** filter out noise: stock prices, awards, ads.

An article passes if it matches **at least one** subject keyword **or** at least one include keyword, and does **not** match any exclude keyword.

## LLM Semantic Filtering by Purpose

Each purpose gets a dedicated LLM prompt:

| purpose | LLM Role | Key Output Fields |
|---------|---------|-------------------|
| `competitor` | 竞争情报分析师 | Subject company, event type, partners, deal size |
| `policy` | 政策分析师 | Policy name, issuing agency, affected industries |
| `tech` | 技术分析师 | Tech domain, innovation point, application scenario |

## Data Flow

```
sources (tagged with purpose)
  → fetch articles (by source type)
  → dedup (exact URL/title)
  → keyword gate (purpose-specific rules)
  → fuzzy dedup
  → LLM (purpose-specific prompt)
  → post-filter (business categories)
  → insights table
```

## Database Changes

- `sources` table: add `purpose` TEXT column (comma-separated values: `competitor,policy,tech`)
- `filter_rules` table: add `purpose` TEXT column (`competitor`, `policy`, or `tech`)
- `filter_config` table: add `purpose` TEXT column for LLM prompts

## UI Changes

- **Sources page**: add purpose selector (multi-select or comma-separated)
- **Content Filters page**: group filter rules by purpose with collapsible sections
- **Insights feed**: add purpose tag to each card

## What Stays the Same

- Crawler types (rss, website, wechat_mcp) — no changes to how articles are fetched
- Dedup logic — no changes
- Business categories — still apply to all purposes
- Semantic exclusion prompt — still applies to all purposes (can be purpose-specific later)
