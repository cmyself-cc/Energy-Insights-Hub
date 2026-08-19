#!/usr/bin/env node
/**
 * 重新处理导入的 insights 数据
 * 使用 LLM 重新生成标题、摘要、关键词、分类等
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 配置
const DB_PATH = process.env.DB_PATH || '/app/data/energy_insights.db';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 10; // 每批处理数量
const DELAY_MS = parseInt(process.env.DELAY_MS) || 1000; // 批次间延迟（毫秒）
const LIMIT = parseInt(process.env.LIMIT) || 0; // 限制处理数量，0 表示不限制
const RECENT_DAYS = parseInt(process.env.RECENT_DAYS) || 0; // 只处理最近 N 天的数据，0 表示不限制

// LLM 配置（从环境变量读取）
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

if (!LLM_API_KEY) {
  console.error('Error: LLM_API_KEY environment variable is required');
  process.exit(1);
}

// 系统提示词
const SYSTEM_PROMPT = `你是一位能源行业的专业分析师。请根据提供的文章内容，生成以下内容：

1. title: 只概括一条核心事件，用最精简的中文（10-20字）概括核心事件。剔除来源名、日期、作者名、文学修饰词、废话词，标准格式严格参考：主体+发生了什么或关键结果是什么
2. summary: 用一句话（50-100字）概括文章核心内容，突出关键信息和数据
3. keywords: 恰好3个字符串，必须是具体可搜索的关键词：公司名称、技术名称、事件名称或政策名称。不要宽泛概念
4. categories: 从以下分类中选择最相关的1-3个：["电力&氢能","储能","光伏","油气","CCS","化工","LNG/天然气","移动出行","润滑油","生物燃料"]
5. enterprise_type: 从以下分类中选择：["国有企业","民营企业","外资企业","合资企业","政府机构","研究机构","行业协会","其他"]
6. purpose: 从以下分类中选择最相关的一个：["competitor","policy","tech","industry"]

请以 JSON 格式返回，格式如下：
{
  "title": "标题",
  "summary": "摘要",
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "categories": ["分类1", "分类2"],
  "enterprise_type": "企业类型",
  "purpose": "监控类型"
}`;

async function callLLM(content, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LLM_API_KEY}`
        },
        body: JSON.stringify({
          model: LLM_MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `请分析以下文章：\n\n标题：${content.title}\n\n内容：${content.summary || content.raw_content || content.title}` }
          ],
          temperature: 0.3,
          max_tokens: 1000
        })
      });

      if (!response.ok) {
        throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // 检查响应是否为空
      if (!data.choices || data.choices.length === 0 || !data.choices[0].message) {
        throw new Error('Empty LLM response');
      }
      
      const result = data.choices[0].message.content;
      
      // 检查内容是否为空
      if (!result || result.trim().length === 0) {
        throw new Error('Empty content in LLM response');
      }
  
      // 尝试多种 JSON 提取策略
      let jsonStr = null;
      
      // 策略 1: 直接匹配完整的 JSON 对象
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
      
      // 策略 2: 如果包含 markdown 代码块，提取其中的 JSON
      if (!jsonStr) {
        const codeBlockMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
          jsonStr = codeBlockMatch[1].trim();
        }
      }
      
      // 策略 3: 尝试找到第一个 { 和最后一个 } 之间的内容
      if (!jsonStr) {
        const firstBrace = result.indexOf('{');
        const lastBrace = result.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          jsonStr = result.substring(firstBrace, lastBrace + 1);
        }
      }
      
      if (!jsonStr) {
        throw new Error('Failed to extract JSON from LLM response');
      }
      
      const parsed = JSON.parse(jsonStr);
      return parsed;
      
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      console.log(`  Attempt ${attempt} failed: ${error.message}, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // 递增延迟
    }
  }
}

async function processBatch(db, insights) {
  const results = [];
  
  for (const insight of insights) {
    try {
      console.log(`Processing ID ${insight.id}: ${insight.title.substring(0, 50)}...`);
      
      const processed = await callLLM({
        title: insight.title,
        summary: insight.summary,
        raw_content: insight.raw_content
      });
      
      // 更新数据库
      db.prepare(`
        UPDATE insights 
        SET title = ?, summary = ?, keywords = ?, categories = ?, 
            enterprise_type = ?, purpose = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        processed.title,
        processed.summary,
        JSON.stringify(processed.keywords),
        JSON.stringify(processed.categories),
        processed.enterprise_type,
        processed.purpose,
        insight.id
      );
      
      results.push({ id: insight.id, success: true });
    } catch (error) {
      console.error(`Error processing ID ${insight.id}:`, error.message);
      results.push({ id: insight.id, success: false, error: error.message });
    }
  }
  
  return results;
}

async function main() {
  console.log('Starting insights reprocessing...');
  console.log(`Database: ${DB_PATH}`);
  console.log(`LLM Model: ${LLM_MODEL}`);
  if (RECENT_DAYS > 0) {
    console.log(`Processing only last ${RECENT_DAYS} days`);
  }
  
  const db = new Database(DB_PATH);
  
  // 构建查询条件
  let whereClause = 'id >= 380';
  if (RECENT_DAYS > 0) {
    whereClause += ` AND publish_date >= datetime('now', '-${RECENT_DAYS} days')`;
  }
  
  // 获取需要处理的 insights（按 publish_date 降序，最新的先处理）
  const totalToProcess = db.prepare(`SELECT COUNT(*) as count FROM insights WHERE ${whereClause}`).get();
  console.log(`Total insights to process: ${totalToProcess.count}`);
  
  const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';
  const insights = db.prepare(`
    SELECT id, title, summary, raw_content, publish_date 
    FROM insights 
    WHERE ${whereClause} 
    ORDER BY publish_date DESC
    ${limitClause}
  `).all();
  
  console.log(`Found ${insights.length} insights to process`);
  if (insights.length > 0) {
    console.log(`Date range: ${insights[insights.length-1].publish_date} to ${insights[0].publish_date}`);
  }
  
  let processed = 0;
  let failed = 0;
  
  // 分批处理
  for (let i = 0; i < insights.length; i += BATCH_SIZE) {
    const batch = insights.slice(i, i + BATCH_SIZE);
    console.log(`\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(insights.length / BATCH_SIZE)}...`);
    
    const results = await processBatch(db, batch);
    
    processed += results.filter(r => r.success).length;
    failed += results.filter(r => !r.success).length;
    
    console.log(`Batch complete: ${results.filter(r => r.success).length} success, ${results.filter(r => !r.success).length} failed`);
    
    // 延迟避免 API 限流
    if (i + BATCH_SIZE < insights.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }
  
  console.log(`\nReprocessing complete!`);
  console.log(`Total processed: ${processed}`);
  console.log(`Total failed: ${failed}`);
  
  db.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
