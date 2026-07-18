import { execFileSync } from "child_process";
import path from "path";
import os from "os";
import fs from "fs";

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map(s => s.trim()).filter(Boolean);
  }
  return [];
}

export function parseJsonConfig(payload) {
  if (!payload || typeof payload !== "object") {
    payload = {};
  }

  return {
    excludeKeywords: toArray(payload.excludeKeywords),
    enterpriseKeywords: toArray(payload.enterpriseKeywords),
    includeKeywords: toArray(payload.includeKeywords),
    semanticPrompt: payload.semanticPrompt || "",
    categories: (payload.categories || []).map(c => ({
      name: c.name,
      description: c.description || "",
      inclusion_prompt: c.inclusionPrompt || c.inclusion_prompt || ""
    })).filter(c => c.name),
    sources: (payload.sources || []).map(s => ({
      name: s.name,
      identifier: s.identifier || null,
      type: s.type === "wechat" ? "wechat_mcp" : s.type,
      url: s.type === "wechat" ? (process.env.WECHAT_MCP_URL || "http://192.168.5.134:4001/sse") : (s.url || ""),
      config: s.config ? JSON.stringify(s.config) : (s.type === "wechat" ? JSON.stringify({ articleLimit: 20 }) : null)
    })).filter(s => s.name && s.type)
  };
}

function buildPythonScript() {
  return [
    "import pandas as pd",
    "import json",
    "import sys",
    "import os",
    "",
    "input_path = sys.argv[1]",
    "output_path = sys.argv[2]",
    "xl = pd.ExcelFile(input_path)",
    "result = {}",
    "",
    "def first_non_empty(row):",
    "    for v in row:",
    "        if pd.notna(v):",
    "            s = str(v).strip()",
    "            if s:",
    "                return s",
    "    return ''",
    "",
    "if '关键词过滤' in xl.sheet_names:",
    "    df = pd.read_excel(xl, sheet_name='关键词过滤', header=None).iloc[1:]",
    "    keywords = []",
    "    for _, row in df.iterrows():",
    "        v = first_non_empty(row)",
    "        if v:",
    "            keywords.append(v)",
    "    result['excludeKeywords'] = keywords",
    "",
    "if '底层过滤关键词' in xl.sheet_names:",
    "    df = pd.read_excel(xl, sheet_name='底层过滤关键词', header=None).iloc[1:]",
    "    enterprise_keywords = []",
    "    include_keywords = []",
    "    exclude_keywords = []",
    "    for _, row in df.iterrows():",
    "        base = str(row.iloc[0]).strip() if pd.notna(row.iloc[0]) else ''",
    "        if not base:",
    "            continue",
    "        add = str(row.iloc[4]).strip() if len(row) > 4 and pd.notna(row.iloc[4]) else ''",
    "        excl = str(row.iloc[5]).strip() if len(row) > 5 and pd.notna(row.iloc[5]) else ''",
    "        if base:",
    "            enterprise_keywords.append(base)",
    "        if add:",
    "            include_keywords.append(add)",
    "        if excl:",
    "            exclude_keywords.append(excl)",
    "    result['enterpriseKeywords'] = enterprise_keywords",
    "    result['includeKeywords'] = include_keywords",
    "    result['excludeKeywords'] = exclude_keywords",
    "",
    "if '语义过滤' in xl.sheet_names:",
    "    df = pd.read_excel(xl, sheet_name='语义过滤', header=None).iloc[1:]",
    "    for _, row in df.iterrows():",
    "        v = first_non_empty(row)",
    "        if v:",
    "            result['semanticPrompt'] = v",
    "            break",
    "",
    "if '业务分类描述' in xl.sheet_names:",
    "    df = pd.read_excel(xl, sheet_name='业务分类描述', header=None).iloc[1:]",
    "    categories = []",
    "    for _, row in df.iterrows():",
    "        name = str(row.iloc[0]).strip() if pd.notna(row.iloc[0]) else ''",
    "        if not name:",
    "            continue",
    "        description = str(row.iloc[1]).strip() if len(row) > 1 and pd.notna(row.iloc[1]) else ''",
    "        inclusion_prompt = str(row.iloc[2]).strip() if len(row) > 2 and pd.notna(row.iloc[2]) else ''",
    "        categories.append({",
    "            'name': name,",
    "            'description': description,",
    "            'inclusionPrompt': inclusion_prompt",
    "        })",
    "    result['categories'] = categories",
    "",
    "if '新增微信公众号' in xl.sheet_names:",
    "    df = pd.read_excel(xl, sheet_name='新增微信公众号', header=None).iloc[1:]",
    "    sources = []",
    "    for _, row in df.iterrows():",
    "        media = str(row.iloc[0]).strip() if pd.notna(row.iloc[0]) else ''",
    "        name = str(row.iloc[1]).strip() if pd.notna(row.iloc[1]) else ''",
    "        identifier = str(row.iloc[2]).strip() if len(row) > 2 and pd.notna(row.iloc[2]) else ''",
    "        website = str(row.iloc[3]).strip() if len(row) > 3 and pd.notna(row.iloc[3]) else ''",
    "        if not name:",
    "            continue",
    "        if media == '微信公众号':",
    "            sources.append({",
    "                'name': name,",
    "                'type': 'wechat_mcp',",
    "                'url': os.environ.get('WECHAT_MCP_URL', 'http://192.168.5.134:4001/sse'),",
    "                'config': {'articleLimit': 20}",
    "            })",
    "        elif website and (website.startswith('http://') or website.startswith('https://')):",
    "            sources.append({",
    "                'name': website,",
    "                'type': 'website',",
    "                'url': website",
    "            })",
    "    result['sources'] = sources",
    "",
    "with open(output_path, 'w', encoding='utf-8') as f:",
    "    json.dump(result, f, ensure_ascii=False)"
  ].join("\n");
}

function parseExcelBuffer(buffer) {
  const tmpDir = os.tmpdir();
  const stamp = Date.now();
  const inPath = path.join(tmpDir, `config-in-${stamp}.xlsx`);
  const outPath = path.join(tmpDir, `config-out-${stamp}.json`);
  const scriptPath = path.join(tmpDir, `parse-config-${stamp}.py`);

  try {
    fs.writeFileSync(inPath, buffer);
    fs.writeFileSync(scriptPath, buildPythonScript());
    execFileSync("python3", [scriptPath, inPath, outPath]);
    const raw = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    return parseJsonConfig(raw);
  } finally {
    for (const p of [inPath, outPath, scriptPath]) {
      try {
        fs.unlinkSync(p);
      } catch (_err) {
        // ignore cleanup errors
      }
    }
  }
}

export function parseConfigFile(buffer, filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".json") {
    return parseJsonConfig(JSON.parse(buffer.toString("utf-8")));
  }
  if (ext === ".xlsx") {
    return parseExcelBuffer(buffer);
  }
  throw new Error("Unsupported file type. Use .json or .xlsx");
}
