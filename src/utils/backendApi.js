const API_BASE = "/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    },
    ...options
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export const backendApi = {
  health: () => request("/health"),

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

  // Reports
  getReports: () => request("/reports"),
  getReport: (id) => request(`/reports/${id}`),
  createReport: (report) => request("/reports", { method: "POST", body: JSON.stringify(report) }),
  deleteReport: (id) => request(`/reports/${id}`, { method: "DELETE" }),

  // Tracker
  runTracker: () => request("/tracker/run", { method: "POST" }),
  stopTracker: () => request("/tracker/stop", { method: "POST" }),
  getTrackerRuns: () => request("/tracker/runs"),
  getTrackerRun: (id) => request(`/tracker/runs/${id}`),
  getTrackerStatus: () => request("/tracker/status"),

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

  // Industry categories
  getIndustryCategories: () => request("/industries"),
  createIndustryCategory: (data) => request("/industries", { method: "POST", body: JSON.stringify(data) }),
  updateIndustryCategory: (id, data) => request(`/industries/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteIndustryCategory: (id) => request(`/industries/${id}`, { method: "DELETE" }),
  suggestIndustryKeywords: (keyword) => request("/industries/suggest-keywords", { method: "POST", body: JSON.stringify({ keyword }) }),
};
