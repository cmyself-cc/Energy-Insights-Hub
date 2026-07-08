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

  // Sources
  getSources: () => request("/sources"),
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
  getTrackerRuns: () => request("/tracker/runs"),

  // Tracker settings
  getTrackerSettings: () => request("/tracker-settings"),
  updateTrackerSettings: (settings) => request("/tracker-settings", {
    method: "PUT",
    body: JSON.stringify(settings)
  })
};
