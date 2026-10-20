const API_BASE = "/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    // 会话 cookie 是 HttpOnly 的，前端唯一能做的是「确保它随请求发出去」。
    // 诚实说明：API_BASE 是硬编码的同源相对路径 "/api"，而同源请求的 fetch 默认
    // （credentials: "same-origin"）本来就带 cookie，所以这一行**今天**是 no-op。
    // 写在这里是把意图钉在将来真需要它的那一行旁边：如果哪天 API_BASE 改成跨源绝对地址，
    // 没有它就会静默地不带会话。但光有它**不够** —— 跨源还需要服务端 CORS 回
    // Access-Control-Allow-Credentials: true，且 Access-Control-Allow-Origin 不能是 "*"。
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    },
    ...options
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const err = new Error(error.error || `HTTP ${response.status}`);
    // 挂上状态码，调用方才能区分 429（限速，该提示「稍后再试」）与 400（邀请码错，
    // 该提示「邀请码无效」），而不必去正则匹配错误文案 —— 文案是给用户看的，不是给代码判断的。
    err.status = response.status;
    throw err;
  }

  return response.json();
}

export const backendApi = {
  health: () => request("/health"),

  // Auth —— 会话 cookie 由服务端 Set-Cookie 管理，前端只读 { data: { user } }
  getAuthConfig: () => request("/auth/config"),
  devLogin: (devUnionid) => request("/auth/dev-login", { method: "POST", body: JSON.stringify({ devUnionid }) }),
  registerWithInvite: (ticket, code) => request("/auth/register", { method: "POST", body: JSON.stringify({ ticket, code }) }),
  me: () => request("/auth/me"),
  logout: () => request("/auth/logout", { method: "POST" }),

  // Insights
  getInsights: (params = {}) => {
    const filtered = Object.entries(params).reduce((acc, [key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        acc[key] = value;
      }
      return acc;
    }, {});
    const query = new URLSearchParams(filtered).toString();
    return request(`/insights?${query}`);
  },
  hideInsight: (id) => request(`/insights/${id}/hide`, { method: "POST" }),
  unhideInsight: (id) => request(`/insights/${id}/unhide`, { method: "POST" }),
  reclassifyInsight: (id, toPurpose) => request(`/insights/${id}/reclassify`, {
    method: "POST",
    body: JSON.stringify({ toPurpose })
  }),
  recordFeedback: (insightId, action, reason) => request("/feedback", {
    method: "POST",
    body: JSON.stringify({ insightId, action, reason: reason || undefined })
  }),
  getFeedbackStats: () => request("/feedback/stats"),
  getFeedbackSuggestions: () => request("/feedback/suggestions"),
  acceptFeedbackSuggestion: (id) => request(`/feedback/suggestions/${id}/accept`, { method: "POST" }),
  rejectFeedbackSuggestion: (id) => request(`/feedback/suggestions/${id}/reject`, { method: "POST" }),
  generateFeedbackSuggestions: () => request("/feedback/generate-suggestions", { method: "POST" }),

  // Sources
  getSources: () => request("/sources"),
  importSourcesMd: () => request("/sources/import-md", { method: "POST" }),
  createSource: (source) => request("/sources", { method: "POST", body: JSON.stringify(source) }),
  updateSource: (id, source) => request(`/sources/${id}`, { method: "PUT", body: JSON.stringify(source) }),
  deleteSource: (id) => request(`/sources/${id}`, { method: "DELETE" }),
  discoverSubPages: (id) => request(`/sources/${id}/discover-subpages`, { method: "POST" }),
  confirmSubPages: (id, subPages) => request(`/sources/${id}/confirm-subpages`, { method: "POST", body: JSON.stringify({ subPages }) }),

  // Reports
  getReports: () => request("/reports"),
  getReport: (id) => request(`/reports/${id}`),
  createReport: (report) => request("/reports", { method: "POST", body: JSON.stringify(report) }),
  updateReport: (id, data) => request(`/reports/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteReport: (id) => request(`/reports/${id}`, { method: "DELETE" }),
  getReportTemplates: () => request("/reports/templates"),
  createReportTemplate: (data) => request("/reports/templates", { method: "POST", body: JSON.stringify(data) }),
  updateReportTemplate: (id, data) => request(`/reports/templates/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteReportTemplate: (id) => request(`/reports/templates/${id}`, { method: "DELETE" }),
  screenReport: (templateId, insightIds) => request("/reports/screening", { method: "POST", body: JSON.stringify({ templateId, insightIds }) }),
  clarifyReport: (templateId, insightIds, answers) => request("/reports/clarify", { method: "POST", body: JSON.stringify({ templateId, insightIds, answers }) }),
  generateReportPrompt: (data) => request("/reports/generate-prompt", { method: "POST", body: JSON.stringify(data) }),
  generateReport: (templateId, insightIds, resolutions, purpose, audience, theme) => request("/reports/generate", { method: "POST", body: JSON.stringify({ templateId, insightIds, resolutions, purpose, audience, theme }) }),
  getReportJobs: () => request("/reports/jobs"),
  getReportJob: (id) => request(`/reports/jobs/${id}`),
  retryReportJob: (id) => request(`/reports/jobs/${id}/retry`, { method: "POST" }),

  // Tracker
  runTracker: () => request("/tracker/run", { method: "POST" }),
  stopTracker: () => request("/tracker/stop", { method: "POST" }),
  clearInsights: () => request("/tracker/clear-insights", { method: "POST" }),
  getTrackerRuns: () => request("/tracker/runs"),
  getTrackerRun: (id) => request(`/tracker/runs/${id}`),
  getTrackerStatus: () => request("/tracker/status"),
  exportConfig: () => request("/tracker/export-config"),
  importConfigFull: (data) => request("/tracker/import-config-full", { method: "POST", body: JSON.stringify(data) }),

  // Tracker settings
  getTrackerSettings: () => request("/tracker-settings"),
  updateTrackerSettings: (settings) => request("/tracker-settings", {
    method: "PUT",
    body: JSON.stringify(settings)
  }),

  // Filters
  getFilterRules: () => request("/filters/rules"),
  createFilterRule: (rule) => request("/filters/rules", { method: "POST", body: JSON.stringify(rule) }),
  updateFilterRule: (id, rule) => request(`/filters/rules/${id}`, { method: "PUT", body: JSON.stringify(rule) }),
  deleteFilterRule: (id) => request(`/filters/rules/${id}`, { method: "DELETE" }),
  regenerateAliases: (id, opts = {}) => request(`/filters/rules/${id}/regenerate-aliases`, { method: "POST", body: JSON.stringify(opts) }),
  generateAliasesPreview: (keyword) => request("/industries/suggest-keywords", { method: "POST", body: JSON.stringify({ keyword }) }),
  getBusinessCategories: () => request("/filters/categories"),
  updateBusinessCategory: (id, category) => request(`/filters/categories/${id}`, { method: "PUT", body: JSON.stringify(category) }),
  getSemanticConfig: (purpose) => {
    const query = purpose ? `?purpose=${encodeURIComponent(purpose)}` : "";
    return request(`/filters/config${query}`);
  },
  updateSemanticConfig: (config, purpose) => {
    const query = purpose ? `?purpose=${encodeURIComponent(purpose)}` : "";
    return request(`/filters/config${query}`, { method: "PUT", body: JSON.stringify(config) });
  },
  getAiPresets: () => request("/filters/ai-presets"),
  saveAiPresets: (presets) => request("/filters/ai-presets", { method: "PUT", body: JSON.stringify({ presets }) }),
  importConfig: (base64File, filename, mode = "append") => request("/tracker/import-config", {
    method: "POST",
    body: JSON.stringify({ file: base64File, filename, mode })
  }),

  // LLM env
  saveLlmEnv: (baseUrl, modelId) => request("/tracker-settings/save-llm-env", { method: "POST", body: JSON.stringify({ baseUrl, modelId }) }),
  testLlm: (modelId) => request("/tracker-settings/test-llm", { method: "POST", body: JSON.stringify({ modelId }) }),

  // Server-managed models (browser never sees baseUrl/apiKey)
  getModels: () => request("/models"),
  getCurrentModel: () => request("/models/current"),
  addModel: (data) => request("/models", { method: "POST", body: JSON.stringify(data) }),
  setActiveModel: (id) => request(`/models/${id}/active`, { method: "PUT" }),
  deleteModel: (id) => request(`/models/${id}`, { method: "DELETE" }),

  // Search providers (browser never sees apiKey)
  getSearchProviders: () => request("/search-providers"),
  createSearchProvider: (data) => request("/search-providers", { method: "POST", body: JSON.stringify(data) }),
  updateSearchProvider: (id, data) => request(`/search-providers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSearchProvider: (id) => request(`/search-providers/${id}`, { method: "DELETE" }),
  activateSearchProvider: (id) => request(`/search-providers/${id}/activate`, { method: "POST" }),

  // Industry categories
  getIndustryCategories: () => request("/industries"),
  createIndustryCategory: (data) => request("/industries", { method: "POST", body: JSON.stringify(data) }),
  updateIndustryCategory: (id, data) => request(`/industries/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteIndustryCategory: (id) => request(`/industries/${id}`, { method: "DELETE" }),
  suggestIndustryKeywords: (keyword) => request("/industries/suggest-keywords", { method: "POST", body: JSON.stringify({ keyword }) }),
};
