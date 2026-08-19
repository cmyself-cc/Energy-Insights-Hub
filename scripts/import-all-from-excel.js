#!/usr/bin/env node
/**
 * 从 Excel 导入全部 insights 数据
 * 自动处理所有记录（分批处理，避免内存溢出）
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 配置
const DB_PATH = process.env.DB_PATH || '/app/data/energy_insights.db';
const EXCEL_PATH = process.env.EXCEL_PATH || '/app/data/壳牌历史资讯.xlsx';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 10; // 每批处理数量
const DELAY_MS = parseInt(process.env.DELAY_MS) || 1000; // 批次间延迟（毫秒）
const START_FROM = parseInt(process.env.START_FROM) || 0; // 从第几条开始（跳过已处理的）

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

function excelDateToJSDate(serial) {
  if (!serial) return null;
  const utcDays = Math.floor(serial - 25569);
  const utcMs = utcDays * 86400 * 1000;
  return new Date(utcMs).toISOString();
}

async function main() {
  console.log('Starting full import from Excel with LLM processing...');
  console.log(`Database: ${DB_PATH}`);
  console.log(`Excel: ${EXCEL_PATH}`);
  console.log(`LLM Model: ${LLM_MODEL}`);
  console.log(`Starting from record: ${START_FROM}`);
  
  // 读取 Excel
  const workbook = XLSX.read(readFileSync(EXCEL_PATH), { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(sheet);
  
  console.log(`Total records in Excel: ${rawData.length}`);
  
  // 转换数据格式
  const records = rawData.map(row => ({
    title: row.title || '',
    summary: row.summary || '',
    raw_content: row.raw_content || row.summary || '',
    url: row.url || '',
    publish_date: excelDateToJSDate(row.publish_time),
    source_name: row.source_name || '',
    source_type: row.source_type || '',
    business_domain: row.business_domain || '',
    enterprise_type: row.enterprise_type || '',
    categories: row.categories || '[]',
    keywords: row.keywords || '[]',
    features: row.features || '[]'
  }));
  
  // 按日期降序排序
  records.sort((a, b) => {
    if (!a.publish_date) return 1;
    if (!b.publish_date) return -1;
    return new Date(b.publish_date) - new Date(a.publish_date);
  });
  
  // 跳过已处理的记录
  const toProcess = records.slice(START_FROM);
  console.log(`Processing ${toProcess.length} records (from ${START_FROM} to end)`);
  
  if (toProcess.length > 0) {
    console.log(`Date range: ${toProcess[toProcess.length-1].publish_date?.slice(0,10)} to ${toProcess[0].publish_date?.slice(0,10)}`);
  }
  
  const db = new Database(DB_PATH);
  
  // 准备插入语句
  const insertStmt = db.prepare(`
    INSERT INTO insights (
      title, summary, url, publish_date, source_name, source_type,
      business_domain, enterprise_type, categories, keywords, features,
      purpose, hidden, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `);
  
  let processed = 0;
  let failed = 0;
  const total = toProcess.length;
  
  // 逐条处理并插入
  for (let i = 0; i < toProcess.length; i++) {
    const record = toProcess[i];
    const globalIndex = START_FROM + i;
    
    try {
      if (i % 10 === 0) {
        console.log(`\n[${globalIndex+1}/${records.length}] Processing: ${record.title.substring(0, 50)}...`);
        console.log(`  Date: ${record.publish_date?.slice(0,10) || 'unknown'}`);
        console.log(`  Progress: ${((i/total)*100).toFixed(1)}% (${i}/${total})`);
      }
      
      // 调用 LLM 处理
      const llmResult = await callLLM({
        title: record.title,
        summary: record.summary,
        raw_content: record.raw_content
      });
      
      // 插入数据库
      const result = insertStmt.run(
        llmResult.title,
        llmResult.summary,
        record.url,
        record.publish_date,
        record.source_name,
        record.source_type,
        record.business_domain,
        llmResult.enterprise_type || record.enterprise_type,
        JSON.stringify(llmResult.categories),
        JSON.stringify(llmResult.keywords),
        record.features,
        llmResult.purpose
      );
      
      if (i % 10 === 0) {
        console.log(`  ✓ Inserted ID: ${result.lastInsertRowid}`);
        console.log(`  ✓ Title: ${llmResult.title}`);
        console.log(`  ✓ Purpose: ${llmResult.purpose}`);
      }
      
      processed++;
      
      // 每 10 条暂停一下，避免 API 限流
      if ((i + 1) % BATCH_SIZE === 0 && i + 1 < toProcess.length) {
        if ((i + 1) % 100 === 0) {
          console.log(`\n=== Batch complete: ${processed} processed, ${failed} failed ===`);
          console.log(`Waiting ${DELAY_MS}ms before next batch...`);
        }
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
      
    } catch (error) {
      console.error(`  ✗ Error processing record ${globalIndex+1}: ${error.message}`);
      failed++;
    }
  }
  
  console.log(`\n========================================`);
  console.log(`Import complete!`);
  console.log(`Total processed: ${processed}`);
  console.log(`Total failed: ${failed}`);
  console.log(`========================================`);
  
  db.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
