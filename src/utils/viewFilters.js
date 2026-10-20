// 视角（Task 11 / M3）的过滤器双向映射。纯函数、零依赖，node 环境直接可测
//（pinyinIndex.test.js 的「前端非 React 纯函数」先例；计划原文写「node 冒烟脚本不留测试」
// 是 R0 裁定**之前**的话，现有前端测试基建，按计划的精神（验证纯函数）但用真测试文件）。
//
// 形状约定：
//   App 的 filters（DEFAULT_FILTERS，见 src/constants/taxonomy.js）：
//     { purposes: string[], businessCategory, subjectCategory, enterpriseType,
//       sourceType, query, dateRange }
//   视角落库的 filters JSON（user_views.filters，见 server/services/viewService.js）：
//     与 filtersToView 产物同形 —— **undefined 的键直接省略**（JSON.stringify 会丢），
//     所以读回来的对象缺键是常态，viewToFilters 用 || 回落。

// App filters → 视角存储对象。未设的维度输出 undefined（调用方负责 JSON 化时省略）。
export function filtersToView(filters) {
  return {
    purposes: (filters.purposes || []).length ? filters.purposes.join(",") : undefined,
    businessCategory: filters.businessCategory !== "all" ? filters.businessCategory : undefined,
    subjectCategory: filters.subjectCategory !== "all" ? filters.subjectCategory : undefined,
    enterpriseType: filters.enterpriseType !== "all" ? filters.enterpriseType : undefined,
    sourceType: filters.sourceType !== "all" ? filters.sourceType : undefined,
    search: filters.query || undefined,
    dateRange: filters.dateRange !== "noLimit" ? filters.dateRange : undefined
  };
}

// 视角存储对象 → App filters。缺键一律落到「不筛选」语义（"all" / "" / [] / "noLimit"）。
export function viewToFilters(v) {
  const view = v || {};
  return {
    purposes: view.purposes ? String(view.purposes).split(",").filter(Boolean) : [],
    businessCategory: view.businessCategory || "all",
    subjectCategory: view.subjectCategory || "all",
    enterpriseType: view.enterpriseType || "all",
    sourceType: view.sourceType || "all",
    query: view.search || "",
    dateRange: view.dateRange || "noLimit"
  };
}

// 双向往返必须是恒等映射（modulo undefined 键省略）。
export function isDrift(viewFiltersObj, currentFiltersObj) {
  const canon = (o) => {
    const entries = Object.entries(o || {})
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)]);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return JSON.stringify(Object.fromEntries(entries));
  };
  return canon(filtersToView(currentFiltersObj)) !== canon(viewFiltersObj);
}
