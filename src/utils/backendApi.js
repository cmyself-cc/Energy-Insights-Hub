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

// 把「新建邀请码」表单归一化成服务端要的请求体。纯函数、无副作用，所以可以直接测。
//
// 🔴 为什么它返回 { ok:false, error } 而不是照控制器的注记「把 "abc" 送成 NaN」：
// 注记的本意是 fail-closed —— 服务端 normalizeMaxUses 用 `Number.isInteger(NaN) === false`
// 拒掉它并返回 400。但那条路在 JSON 上**走不通**，实测：
//     JSON.stringify({ max_uses: NaN }) === '{"max_uses":null}'
// JSON 没有 NaN 这个字面量，序列化时一律变成 null；而 null 在 normalizeMaxUses 里正是
// 「NULL = 不限」的合法输入（admin.js:69）。也就是说：照着送 NaN，服务端收到的是 null，
// 建出来的是一张**无限次可用**的邀请码 —— 恰好是注记想要避免的权限放大，而且静默。
// 所以在客户端就拒绝、根本不发请求，是唯一同时满足「fail-closed」与「管理员立刻看得见」的做法。
// 服务端那道 400 仍然是对的纵深防御（其它客户端、直接打 API），两者不冲突。
//
// expires_at 的语义（控制器注记 2 的裁定，详见组件里的用户可见提示）：
// <input type="date"> 产出 "YYYY-MM-DD"，而服务端 normalizeExpiresAt 走 SQL 的 datetime()，
// 实测 datetime('2026-12-31') -> '2026-12-31 00:00:00'，即「到期日当天 00:00 就已失效」，
// 与管理员填这个日期的本意（当天还能用）相反。这里补上 T23:59:59，
// 实测 datetime('2026-12-31T23:59:59') -> '2026-12-31 23:59:59'。
// ⚠️ 服务端按 UTC 解释无时区后缀的串（datetime('now') 也是 UTC），所以对 UTC+8 的管理员
// 实际会多出 8 小时。这是**有意选择**：不引入浏览器时区依赖（同一张码不会因为管理员出差
// 而改变语义），代价是在 UI 上把 UTC 三个字写清楚。要精确到本地午夜就得送带偏移的串
// （实测 datetime('2026-12-31T23:59:59+08:00') -> '2026-12-31 15:59:59'），本轮不做。
export function buildInvitePayload(form) {
  const role = form.role;
  if (role !== "admin" && role !== "user") return { ok: false, error: "errRole" };

  const rawMax = typeof form.max_uses === "string" ? form.max_uses.trim() : form.max_uses;
  let maxUses = null;                                  // null = 不限（服务端的口径）
  if (rawMax != null && rawMax !== "") {
    const n = Number(rawMax);
    // Number("") 是 0 而不是 NaN，所以空串必须在上面单独放过；这里挡住 "abc"->NaN、
    // "1.7"、"-5"、"0" —— 全部 fail-closed，绝不静默改写成「不限」。
    if (!Number.isInteger(n) || n < 1) return { ok: false, error: "errMaxUses" };
    maxUses = n;
  }

  const rawExpires = typeof form.expires_at === "string" ? form.expires_at.trim() : form.expires_at;
  let expiresAt = null;                                // null = 长期有效
  if (rawExpires != null && rawExpires !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawExpires)) return { ok: false, error: "errExpires" };
    // 形状对但日历上不存在的日期也要拒，而且这一层**只能**在客户端拒：服务端 normalizeExpiresAt
    // 走 SQL 的 datetime()，而 SQLite 对越界日期是**静默归一化**而不是报错 ——
    // 实测 datetime('2026-02-30') -> '2026-03-02'、datetime('2026-13-01') -> '2027-01-01'，
    // 于是服务端会 happily 建出一张到期日与管理员所选**不同**的码（fail-open，且无任何提示）。
    // <input type="date"> 正常不会产出这种值，但这个函数是导出的纯函数，别的调用方未必走 date input。
    const [yy, mm, dd] = rawExpires.split("-").map(Number);
    const probe = new Date(Date.UTC(yy, mm - 1, dd));
    if (probe.getUTCFullYear() !== yy || probe.getUTCMonth() !== mm - 1 || probe.getUTCDate() !== dd) {
      return { ok: false, error: "errExpires" };
    }
    expiresAt = `${rawExpires}T23:59:59`;
  }

  const rawView = typeof form.default_view === "string" ? form.default_view.trim() : form.default_view;
  let defaultView = null;
  if (rawView != null && rawView !== "") {
    let parsed;
    try {
      parsed = JSON.parse(rawView);
    } catch {
      return { ok: false, error: "errDefaultView" };
    }
    // 数组也是 typeof "object"，而服务端对数组走的是**静默 return**（建出 0 个视角、不报错），
    // 所以这里连数组一起拒掉，口径与 admin.js 的 400 一致。
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "errDefaultView" };
    }
    defaultView = parsed;
  }

  const payload = {
    role,
    label: form.label || "",
    note: form.note || "",
    max_uses: maxUses,
    expires_at: expiresAt,
    default_view: defaultView
  };
  // 空 code 整个键都不放：服务端 `String(b.code || "").trim().toUpperCase() || 自动生成`，
  // 省略与送空串等价，但省略更能表达「交给服务端生成」这个意图。
  const code = typeof form.code === "string" ? form.code.trim().toUpperCase() : "";
  if (code) payload.code = code;
  return { ok: true, payload };
}

export const backendApi = {
  health: () => request("/health"),

  // Auth —— 会话 cookie 由服务端 Set-Cookie 管理，前端只读 { data: { user } }
  getAuthConfig: () => request("/auth/config"),
  devLogin: (devUnionid) => request("/auth/dev-login", { method: "POST", body: JSON.stringify({ devUnionid }) }),
  registerWithInvite: (ticket, code) => request("/auth/register", { method: "POST", body: JSON.stringify({ ticket, code }) }),
  me: () => request("/auth/me"),
  logout: () => request("/auth/logout", { method: "POST" }),

  // Admin —— 用户管理与邀请码管理（PRD 的 ADM-1 / ADM-2）。
  // 整个 /api/admin 前缀在服务端已经 requireAdmin（server/apiRoutes.js），所以这里的门禁是
  // 服务端的；前端藏标签只是省掉几个必然 403 的请求，**不是**安全边界。
  // ⚠️ 只加 Task 7b 真正消费的 6 个方法。视角那 5 个（getViews/createView/updateView/
  // deleteView/setDefaultView）属于 Task 11，现在加进来就是死代码。
  getAdminUsers: () => request("/admin/users"),
  // patch 只含要改的键：{ role } 或 { status }。服务端对 role/status 分别校验，
  // 并拒绝「把最后一个在岗管理员降级或停用」（409）。
  patchAdminUser: (id, patch) => request(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  getInviteCodes: () => request("/admin/invite-codes"),
  // payload 由上面的 buildInvitePayload(form) 产生，不要直接把表单塞进来。
  createInviteCode: (payload) => request("/admin/invite-codes", { method: "POST", body: JSON.stringify(payload) }),
  // 停用 = { active: 0 }，不物理删除（Global Constraint）；同一个端点也能重新启用。
  patchInviteCode: (id, patch) => request(`/admin/invite-codes/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  // ADM-2 的「查看使用记录」：返回用这张码注册的用户（id/unionid/nickname/created_at）。
  getInviteCodeUsages: (id) => request(`/admin/invite-codes/${id}/usages`),

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

  // Reports。all=true → ?scope=all（仅 admin 生效；非 admin 传了也会被服务端忽略、
  // 返回同默认可见集合）。admin 的列表行额外带 owner_nickname（服务端 JOIN，Task 9）。
  getReports: (all) => request("/reports" + (all ? "?scope=all" : "")),
  getReport: (id) => request(`/reports/${id}`),
  createReport: (report) => request("/reports", { method: "POST", body: JSON.stringify(report) }),
  updateReport: (id, data) => request(`/reports/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteReport: (id) => request(`/reports/${id}`, { method: "DELETE" }),
  getReportTemplates: (all) => request("/reports/templates" + (all ? "?scope=all" : "")),
  // 「另存为副本」：源模板必须可见；新行强制私有 + 归属自己（服务端 Task 9 语义）。
  duplicateReportTemplate: (id) => request(`/reports/templates/${id}/duplicate`, { method: "POST" }),
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
