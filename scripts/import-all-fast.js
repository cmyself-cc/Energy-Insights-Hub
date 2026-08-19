#!/usr/bin/env node
/**
 * 从 Excel 导入全部 insights 数据 - 快速版本（并发处理）
 * v2: 增加超时控制、逐条日志、全局错误捕获
 */

import Database from 'better-sqlite3';
import { readFileSync, appendFileSync } from 'fs';
import * as XLSX from 'xlsx';

// 配置
const DB_PATH = process.env.DB_PATH || '/app/data/energy_insights.db';
const EXCEL_PATH = process.env.EXCEL_PATH || '/app/data/壳牌历史资讯.xlsx';
const CONCURRENCY = parseInt(process.env.CONCURRENCY) || 3; // 并发数（降低避免API限流）
const START_FROM = parseInt(process.env.START_FROM) || 0; // 从第几条开始
const LOG_FILE = process.env.LOG_FILE || '/tmp/import-fast.log';
const FETCH_TIMEOUT = parseInt(process.env.FETCH_TIMEOUT) || 30000; // 30秒超时

// LLM 配置
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

// 全局错误捕获 - 防止静默崩溃
process.on('unhandledRejection', (reason, promise) => {
  log(`FATAL: Unhandled rejection at ${promise}: ${reason}`);
  process.exit(2);
});
process.on('uncaughtException', (error) => {
  log(`FATAL: Uncaught exception: ${error.message}\n${error.stack}`);
  process.exit(3);
});

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG_FILE, line + '\n'); } catch(e) {}
}

if (!LLM_API_KEY) {
  log('Error: LLM_API_KEY environment variable is required');
  process.exit(1);
}

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

async function callLLM(content, retries = 2) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
      
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
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`LLM API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.choices || data.choices.length === 0 || !data.choices[0].message) {
        throw new Error('Empty LLM response');
      }
      
      const result = data.choices[0].message.content;
      
      if (!result || result.trim().length === 0) {
        throw new Error('Empty content');
      }
  
      // 提取 JSON
      let jsonStr = null;
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      } else {
        const codeBlockMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
          jsonStr = codeBlockMatch[1].trim();
        } else {
          const firstBrace = result.indexOf('{');
          const lastBrace = result.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            jsonStr = result.substring(firstBrace, lastBrace + 1);
          }
        }
      }
      
      if (!jsonStr) {
        throw new Error('Failed to extract JSON');
      }
      
      return JSON.parse(jsonStr);
      
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
  }
}

function excelDateToJSDate(serial) {
  if (!serial) return null;
  const utcDays = Math.floor(serial - 25569);
  const utcMs = utcDays * 86400 * 1000;
  return new Date(utcMs).toISOString();
}

async function processRecord(record, db, insertStmt, index, total) {
  try {
    const llmResult = await callLLM({
      title: record.title,
      summary: record.summary,
      raw_content: record.raw_content
    });
    
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
    
    return { success: true, id: result.lastInsertRowid, index };
  } catch (error) {
    return { success: false, error: error.message, index };
  }
}

async function main() {
  log('Starting fast import with concurrency: ' + CONCURRENCY);
  log(`Database: ${DB_PATH}`);
  log(`Excel: ${EXCEL_PATH}`);
  log(`LLM Model: ${LLM_MODEL}`);
  log(`Fetch timeout: ${FETCH_TIMEOUT}ms`);
  log(`Starting from record: ${START_FROM}`);
  
  // 读取 Excel
  const workbook = XLSX.read(readFileSync(EXCEL_PATH), { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawData = XLSX.utils.sheet_to_json(sheet);
  
  log(`Total records in Excel: ${rawData.length}`);
  
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
  
  const toProcess = records.slice(START_FROM);
  log(`Processing ${toProcess.length} records with concurrency ${CONCURRENCY}`);
  
  const db = new Database(DB_PATH);
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
  const startTime = Date.now();
  
  // 并发处理
  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const batch = toProcess.slice(i, i + CONCURRENCY);
    const promises = batch.map((record, idx) => 
      processRecord(record, db, insertStmt, START_FROM + i + idx, total)
    );
    
    const results = await Promise.all(promises);
    
    for (const result of results) {
      if (result.success) {
        processed++;
        log(`✓ Record ${result.index + 1} inserted (ID: ${result.id})`);
      } else {
        failed++;
        log(`✗ Record ${result.index + 1} failed: ${result.error}`);
      }
    }
    
    // 每 10 条显示一次进度
    if ((i + CONCURRENCY) % 10 === 0 || i + CONCURRENCY >= total) {
      const elapsed = (Date.now() - startTime) / 1000 / 60;
      const speed = processed / elapsed;
      const remaining = (total - processed - failed) / speed;
      log(`Progress: ${processed + failed}/${total} (${((processed + failed) / total * 100).toFixed(1)}%) | Processed: ${processed}, Failed: ${failed} | Speed: ${speed.toFixed(1)} rec/min | ETA: ${remaining.toFixed(1)} min`);
    }
  }
  
  log(`========================================`);
  log(`Import complete!`);
  log(`Total processed: ${processed}`);
  log(`Total failed: ${failed}`);
  log(`========================================`);
  
  db.close();
}

main().catch(error => {
  log(`Fatal error: ${error.message}\n${error.stack}`);
  process.exit(1);
});
