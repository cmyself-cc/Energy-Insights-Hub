function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== "");
  if (lines.length === 0) return [];

  const headers = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h.trim()] = values[i] !== undefined ? values[i] : "";
    });
    return row;
  });
}

function parseLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function escapeCsv(value) {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(headers, rows) {
  const lines = [headers.map(escapeCsv).join(",")];
  rows.forEach(row => {
    lines.push(headers.map(h => escapeCsv(row[h])).join(","));
  });
  return lines.join("\n");
}

export function parseContentFiltersCsv(text) {
  const rows = parseCsv(text);
  const result = {
    excludeKeywords: [],
    compositeRules: [],
    semanticPrompt: "",
    categories: []
  };

  rows.forEach(row => {
    const type = (row.type || "").trim().toLowerCase();
    if (type === "semantic") {
      result.semanticPrompt = (row.prompt || "").trim();
    } else if (type === "keyword" || type === "exclude_keyword") {
      const name = (row.name || "").trim();
      if (name) result.excludeKeywords.push(name);
    } else if (type === "composite") {
      const include = (row.include || "").split(";").map(s => s.trim()).filter(Boolean);
      const exclude = (row.exclude || "").split(";").map(s => s.trim()).filter(Boolean);
      if (include.length > 0) {
        result.compositeRules.push({
          name: (row.name || "").trim() || null,
          mustInclude: include,
          mustNotInclude: exclude
        });
      }
    } else if (type === "category") {
      const name = (row.name || "").trim();
      if (name) {
        result.categories.push({
          name,
          description: (row.description || "").trim(),
          inclusionPrompt: (row.prompt || "").trim(),
          active: (row.active || "1").trim() === "1" ? 1 : 0
        });
      }
    }
  });

  return result;
}

export function buildContentFiltersCsv(rules, categories, semanticConfig) {
  const headers = ["type", "name", "include", "exclude", "description", "prompt", "active"];
  const rows = [];

  rows.push({
    type: "semantic",
    name: "",
    include: "",
    exclude: "",
    description: "",
    prompt: semanticConfig?.content || "",
    active: ""
  });

  (rules || []).filter(r => r.type === "exclude_keyword").forEach(r => {
    const keyword = Array.isArray(r.must_exclude)
      ? r.must_exclude[0]
      : (r.name || "");
    rows.push({
      type: "keyword",
      name: keyword,
      include: "",
      exclude: "",
      description: "",
      prompt: "",
      active: ""
    });
  });

  (rules || []).filter(r => r.type === "composite").forEach(r => {
    const include = Array.isArray(r.must_include) ? r.must_include.join(";") : r.must_include;
    const exclude = Array.isArray(r.must_exclude) ? r.must_exclude.join(";") : r.must_exclude;
    rows.push({
      type: "composite",
      name: r.name || "",
      include,
      exclude,
      description: "",
      prompt: "",
      active: ""
    });
  });

  (categories || []).forEach(c => {
    rows.push({
      type: "category",
      name: c.name,
      include: "",
      exclude: "",
      description: c.description || "",
      prompt: c.inclusion_prompt || "",
      active: c.active ? "1" : "0"
    });
  });

  return buildCsv(headers, rows);
}

export function parseSourcesCsv(text) {
  const rows = parseCsv(text);
  return rows
    .map(row => {
      const type = (row.type || "").trim().toLowerCase();
      const name = (row.name || "").trim();
      if (!name || (type !== "rss" && type !== "website" && type !== "wechat_mcp")) return null;
      const url = (row.url || "").trim();
      const mcpUrl = (row.mcpUrl || row.mcp_url || "").trim();
      const feedId = (row.feedId || row.feed_id || "").trim();
      const active = (row.active || "1").trim();
      const source = {
        name,
        type,
        url: type === "wechat_mcp" ? mcpUrl : url,
        active: active !== "0" && active.toLowerCase() !== "false",
        config: type === "wechat_mcp" ? { feedId, articleLimit: 20 } : {}
      };
      return source;
    })
    .filter(Boolean);
}

export function buildSourcesCsv(sources) {
  const headers = ["type", "name", "url", "mcpUrl", "feedId", "active"];
  const rows = (sources || []).map(s => ({
    type: s.type,
    name: s.name,
    url: s.type === "wechat_mcp" ? "" : (s.url || ""),
    mcpUrl: s.type === "wechat_mcp" ? (s.url || "") : "",
    feedId: s.type === "wechat_mcp" ? (s.config?.feedId || "") : "",
    active: s.active === false || s.active === 0 || s.active === "0" ? "0" : "1"
  }));
  return buildCsv(headers, rows);
}

export function parseTrackerSettingsCsv(text) {
  const rows = parseCsv(text);
  const settings = {};
  rows.forEach(row => {
    const key = (row.key || "").trim();
    const value = (row.value || "").trim();
    if (!key) return;
    if (["lookbackHours", "maxPerSource"].includes(key)) {
      settings[key] = parseInt(value, 10) || 0;
    } else if (["fuzzyDeduplicationThreshold"].includes(key)) {
      settings[key] = parseFloat(value) || 0.85;
    } else if (["includeBusinessDomains", "includeEnterpriseTypes", "includeCategories", "excludeKeywords", "requiredIndustryKeywords", "requiredCompanyKeywords"].includes(key)) {
      settings[key] = value.split(",").map(s => s.trim()).filter(Boolean);
    } else {
      settings[key] = value;
    }
  });
  return settings;
}

export function buildTrackerSettingsCsv(settings) {
  const headers = ["key", "value"];
  const rows = [
    { key: "lookbackHours", value: settings.lookbackHours ?? 24 },
    { key: "maxPerSource", value: settings.maxPerSource ?? 3 },
    { key: "includeBusinessDomains", value: (settings.includeBusinessDomains || []).join(",") },
    { key: "includeEnterpriseTypes", value: (settings.includeEnterpriseTypes || []).join(",") },
    { key: "includeCategories", value: (settings.includeCategories || []).join(",") },
    { key: "excludeKeywords", value: (settings.excludeKeywords || []).join(",") },
    { key: "requiredIndustryKeywords", value: (settings.requiredIndustryKeywords || []).join(",") },
    { key: "requiredCompanyKeywords", value: (settings.requiredCompanyKeywords || []).join(",") },
    { key: "fuzzyDeduplicationThreshold", value: settings.fuzzyDeduplicationThreshold ?? 0.85 }
  ];
  return buildCsv(headers, rows);
}

export function parseApiConfigCsv(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    providerId: (row.providerId || "").trim(),
    baseUrl: (row.baseUrl || "").trim(),
    modelId: (row.modelId || "").trim(),
    apiKey: (row.apiKey || "").trim()
  };
}

export function buildApiConfigCsv(config, includeKey = true) {
  const headers = ["providerId", "baseUrl", "modelId", "apiKey"];
  const rows = [{
    providerId: config?.providerId || "",
    baseUrl: config?.baseUrl || "",
    modelId: config?.modelId || "",
    apiKey: includeKey ? (config?.apiKey || "") : ""
  }];
  return buildCsv(headers, rows);
}

export function parseSearchConfigCsv(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    providerId: (row.providerId || "").trim(),
    baseUrl: (row.baseUrl || "").trim(),
    apiKey: (row.apiKey || "").trim()
  };
}

export function buildSearchConfigCsv(config, includeKey = true) {
  const headers = ["providerId", "baseUrl", "apiKey"];
  const rows = [{
    providerId: config?.providerId || "",
    baseUrl: config?.baseUrl || "",
    apiKey: includeKey ? (config?.apiKey || "") : ""
  }];
  return buildCsv(headers, rows);
}

export function downloadCsv(filename, csvText) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
