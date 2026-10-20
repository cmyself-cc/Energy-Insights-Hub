import { useState, useCallback, useEffect } from "react";
import ApiConfig from "./components/ApiConfig";
import InsightsGenerator from "./components/InsightsGenerator";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import IntelligencePage from "./components/IntelligencePage";
import AiDrawer from "./components/AiDrawer";
import ReportsPage from "./components/ReportsPage";
import ReportGeneratorModal from "./components/ReportGeneratorModal";
import ViewsBar from "./components/ViewsBar";
import { filtersToView, viewToFilters, isDrift } from "./utils/viewFilters";
import ConfigurationPage from "./components/ConfigurationPage";
import LoginGate from "./components/LoginGate";
import { ToastContainer } from "./components/Toast";
import { storage } from "./utils/storage";
import { api } from "./utils/api";
import { backendApi } from "./utils/backendApi";
import { COLORS, FONT_SIZES, TRANSITIONS, BORDER_RADIUS } from "./constants/theme";
import { i18n } from "./constants/i18n";
import { DEFAULT_FILTERS } from "./constants/taxonomy";
import useIsMobile, { isMobileViewport } from "./hooks/useIsMobile";
import "./styles/responsive.css";

export default function App() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  // Task 11 / M3 自定义视角：activeViewId=null 表示公共池（VIEW-4）
  const [views, setViews] = useState([]);
  const [activeViewId, setActiveViewId] = useState(null);
  const activeView = views.find((v) => v.id === activeViewId) || null;
  const viewDrift = activeView ? isDrift(activeView.filters, filters) : false;
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fetched, setFetched] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [cart, setCart] = useState([]);
  const [newsletter, setNewsletter] = useState(null);
  // 惰性初始化器，而不是 useState(false) 再由 effect A 读回：useEffect 在**首次绘制之后**才跑，
  // 用 false 起头会让暗色用户看到一帧浅色底 —— 包括 !authReady 那屏的加载脉冲点。
  // LoginGate.jsx 早已用 useState(() => storage.getDarkMode()) 解决同一个问题，这里对齐。
  const [darkMode, setDarkMode] = useState(() => storage.getDarkMode());
  const [bookmarks, setBookmarks] = useState([]);
  const [hidden, setHidden] = useState([]);
  const [activeTab, setActiveTab] = useState("intelligence");
  const [subTab, setSubTab] = useState("feed");
  // 标题行右侧插槽：报告/配置页通过 portal 把自己的控件挂进来
  const [titleSlotEl, setTitleSlotEl] = useState(null);
  const [showApiConfig, setShowApiConfig] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [dailyBriefingMode, setDailyBriefingMode] = useState(false);
  const [reportTemplates, setReportTemplates] = useState([]);
  const [openReportId, setOpenReportId] = useState(null);
  const [apiConfig, setApiConfig] = useState(null);
  // 语言初始值按设备判断（手机端仅中文），避免 en→zh 切换触发重复 fetch/toast
  const [language, setLanguage] = useState(() => (isMobileViewport() ? "zh" : "en"));
  const isMobile = useIsMobile();
  const [toasts, setToasts] = useState([]);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  // 内容过滤配置中的主体关键词（企业/主体 + 包含关键词及别名），用于卡片高亮
  const [subjectKeywords, setSubjectKeywords] = useState([]);
  // 身份：user 为 null 时整个应用外壳都不挂载（见下方早返回）。
  // authReady 与 user 分开，是因为「还没问完」和「问完了，确实没登录」必须渲染成不同的东西：
  // 前者是加载态，后者是登录门。合成一个状态就会在首屏闪一次登录页。
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  // 抽出来而不是在依赖数组里写 user?.id：exhaustive-deps 会把可选链当成
  // 「无法静态检查的复杂表达式」告警，而本仓 lint 带 --max-warnings 0。
  const userId = user?.id ?? null;

  const t = i18n[language];

  useEffect(() => {
    let cancelled = false;
    backendApi.me()
      .then((res) => { if (!cancelled) setUser(res.data?.user || null); })
      .catch((e) => {
        // 401 是「没登录」的正常答案，不是故障，不该往 console 里刷 error。
        // 判断依据是状态码而不是错误文案（backendApi 把 response.status 挂在 err.status 上）。
        if (e?.status !== 401) console.error("[App] session check failed:", e?.message || e);
        if (!cancelled) setUser(null);
      })
      .finally(() => { if (!cancelled) setAuthReady(true); });
    return () => { cancelled = true; };
  }, []);

  const loadInsightsFromBackend = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await backendApi.getInsights({ pageSize: 100 });
      setInsights(res.data || []);
      setFetched(true);
    } catch (e) {
      setError(storage.getLanguage() === "zh" ? "无法连接到后端服务，请确认已运行 npm run dev:server" : "Cannot connect to backend. Please run npm run dev:server");
      console.error("Backend load failed:", e);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- language 保留以在切换语言时重建回调；移除会改变 loadInsightsFromBackend 的 identity
  }, [language]);

  useEffect(() => {
    // darkMode 不在这里读：它已改成 useState 的惰性初始化器（见上），在这里再 set 一次
    // 只会在首帧之后多触发一次无谓的重渲染。
    setBookmarks(storage.getBookmarks());
    setCart(storage.getCart());
    setApiConfig(storage.getApiConfig());
    const savedLanguage = storage.getStoredLanguage();
    // 移动端仅中文界面（语言切换已隐藏）；Web 端沿用保存值，默认英文
    setLanguage(isMobileViewport() ? "zh" : (savedLanguage || "en"));
  }, []);

  // 三处后端加载从上面那个 effect 里拆出来、挂到 userId 上：Task 6 之后这些端点全在鉴权墙内，
  // 未登录时打过去只会收到一串 401（污染 console，且拿到的是空数据），而原 effect 的 deps 是 []，
  // 登录之后根本不会再跑一次 —— 只在里面加 if 守卫是修不好的，必须让它依赖身份。
  useEffect(() => {
    if (!userId) return;
    loadInsightsFromBackend();
    backendApi.getReportTemplates(user?.role === "admin").then(r => setReportTemplates(r.data || [])).catch(() => {});
    // 视角列表 + 默认视角自动启用（VIEW-5）：用户显式关过（view_off_<id>）则尊重其选择
    backendApi.getViews().then(r => {
      const list = r.data || [];
      setViews(list);
      const def = list.find((v) => v.is_default);
      if (def && !localStorage.getItem(`view_off_${userId}`)) {
        setActiveViewId(def.id);
        setFilters(viewToFilters(def.filters));
      }
    }).catch(() => {});
    // 主体关键词：用于洞察卡片标题中突出显示主体
    // 来源：企业/主体规则（competitor/policy/tech）+ 行业初筛关键词（industry）
    Promise.all([backendApi.getFilterRules(), backendApi.getIndustryCategories()])
      .then(([rulesRes, industriesRes]) => {
        const kws = new Set();
        for (const r of rulesRes.data || []) {
          if (r.active === 0) continue;
          // 仅企业/主体关键词是「主体」；include_keyword 多为动作词（发布/合作），不高亮
          if (r.type !== "enterprise") continue;
          if (r.name && r.name.trim()) kws.add(r.name.trim());
          let aliases = r.aliases;
          if (typeof aliases === "string") {
            try { aliases = JSON.parse(aliases); } catch { aliases = []; }
          }
          if (Array.isArray(aliases)) {
            // 与服务端一致：纯英文 ≤2 字符的别名（如 GW）易撞单位，不作为主体词
            aliases.forEach(a => {
              const v = String(a || "").trim();
              if (v && !/^[A-Za-z]{1,2}$/.test(v)) kws.add(v);
            });
          }
        }
        for (const cat of industriesRes.data || []) {
          if (cat.active === 0) continue;
          for (const kw of cat.keywords || []) {
            if (kw && String(kw).trim()) kws.add(String(kw).trim());
          }
          for (const a of cat.aliases || []) {
            if (a && String(a).trim()) kws.add(String(a).trim());
          }
        }
        setSubjectKeywords([...kws].sort((a, b) => b.length - a.length));
      }).catch(() => {});
    // loadInsightsFromBackend 刻意不入 deps：它随 language 重建，入 deps 会让每次切换语言
    // 都重拉一遍全量数据，而切换语言只该改文案、不该改数据。
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // opts.id：稳定 id 时执行**覆盖**（同 id 的旧 toast 先移除再追加新的）——
  // 用于「Fetched N insights」这类高频提示：新的覆盖旧的，始终只留最新一条
  // （产品负责人 2026-10-21）。其他 toast 不传 id，维持原样堆叠。
  const addToast = (message, type = "success", opts = {}) => {
    const id = opts.id ?? Date.now();
    setToasts(prev => {
      const rest = opts.id != null ? prev.filter(t => t.id !== opts.id) : prev;
      return [...rest, { id, message, type }];
    });
  };

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const toggleCart = (item) => {
    const newCart = cart.find(c => c.title === item.title)
      ? cart.filter(c => c.title !== item.title)
      : [...cart, item];
    setCart(newCart);
    storage.saveCart(newCart);
  };

  const toggleBookmark = async (item) => {
    const adding = !bookmarks.find(b => b.title === item.title);
    const newBookmarks = adding
      ? [...bookmarks, item]
      : bookmarks.filter(b => b.title !== item.title);
    setBookmarks(newBookmarks);
    storage.saveBookmarks(newBookmarks);
    if (adding && item.id) {
      try { await backendApi.recordFeedback(item.id, "bookmark"); } catch (e) { console.error("Bookmark feedback failed:", e); }
    }
    addToast(newBookmarks.length > bookmarks.length ? t.toasts.addedToBookmarks : t.toasts.removedFromBookmarks, "success");
  };

  // Task 13 / M4：用户把卡片「提交给管理员审阅」（不直接生效，admin 在 Feedback 页 accept 后才进 filter_rules）
  const submitToAdmin = async (item, reason, note) => {
    try {
      await backendApi.submitFeedback(item.id, reason, note);
      addToast(t.competitiveIntelligence.submittedToast, "success");
    } catch (e) {
      addToast(e.message || t.errors.fetchFailed, "error");
    }
  };

  const hideItem = async (item, reason) => {
    try {
      if (item.id) {
        await backendApi.hideInsight(item.id);
        if (reason) {
          await backendApi.recordFeedback(item.id, "hide", reason);
        }
      }
      const newHidden = [...hidden, item.title];
      setHidden(newHidden);
      addToast(language === "zh" ? "已隐藏该文章" : "Article hidden", "info");
    } catch (e) {
      console.error("Hide failed:", e);
      addToast(language === "zh" ? "隐藏失败" : "Hide failed", "error");
    }
  };

  // 归类：调整卡片的监控类别，立即更新前端展示，并记录反馈（自学习权重）
  const purposeLabel = (p, lang) => {
    const map = { competitor: "竞争", policy: "政策", tech: "技术", industry: "行业" };
    return lang === "zh" ? (map[p] || p) : p;
  };
  const reclassifyItem = async (item, toPurpose) => {
    try {
      if (item.id) {
        await backendApi.reclassifyInsight(item.id, toPurpose);
      }
      const applyPurpose = (arr) =>
        arr.map(c => c.id === item.id ? { ...c, purposes: [toPurpose] } : c);
      setInsights(prev => applyPurpose(prev));
      setBookmarks(prev => applyPurpose(prev));
      addToast(language === "zh" ? `已归为${purposeLabel(toPurpose, language)}` : `Reclassified to ${toPurpose}`, "success");
    } catch (e) {
      console.error("Reclassify failed:", e);
      addToast(language === "zh" ? "归类失败" : "Reclassify failed", "error");
    }
  };

  const clearCart = () => {
    setCart([]);
    storage.saveCart([]);
  };

  const handleDarkModeToggle = () => {
    const newDarkMode = !darkMode;
    setDarkMode(newDarkMode);
    storage.saveDarkMode(newDarkMode);
  };

  const handleApiConfigSave = (config) => {
    setApiConfig(config);
    storage.saveApiConfig(config);
    addToast(t.toasts.apiConfigSaved, "success");
  };

  const handleLanguageToggle = () => {
    const newLanguage = language === "en" ? "zh" : "en";
    setLanguage(newLanguage);
    storage.saveLanguage(newLanguage);
  };

  function getDateRange(dateRange) {
    if (dateRange === "noLimit") return {};
    const days = { last7: 7, last30: 30, last90: 90 };
    const d = days[dateRange];
    if (!d) return {};
    const date = new Date();
    date.setDate(date.getDate() - d);
    return { dateFrom: date.toISOString().split("T")[0] };
  }

  // ── Task 11 / M3 视角处理器 ──────────────────────────────
  const reloadViews = async () => {
    try { const r = await backendApi.getViews(); setViews(r.data || []); } catch { /* 列表刷新失败不打断主流程 */ }
  };
  const applyView = (view) => {
    setFilters(viewToFilters(view.filters));
    setActiveViewId(view.id);
    localStorage.removeItem(`view_off_${userId}`);   // 显式选择 = 撤销「关掉默认视角」的记忆
  };
  const exitView = () => {
    setActiveViewId(null);
    setFilters(DEFAULT_FILTERS);                      // 回公共池 = 不筛选（VIEW-4）
    localStorage.setItem(`view_off_${userId}`, "1");
  };
  const saveViewAs = async (name) => {
    try {
      const res = await backendApi.createView({ name, filters: filtersToView(filters) });
      await reloadViews();
      // 保存即启用：ViewsBar 关闭态只有「保存为视角」一个按钮（无下拉），
      // 若不在这里激活，新视角没有任何入口被打开。视角用的就是当前筛选，无需改 filters。
      const created = res?.data;
      if (created?.id) {
        setActiveViewId(created.id);
        localStorage.removeItem(`view_off_${userId}`);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || "" };  // 超限（400 view limit reached）走这条
    }
  };
  const updateCurrentView = async () => {
    if (!activeView) return;
    await backendApi.updateView(activeView.id, { filters: filtersToView(filters) });
    await reloadViews();
  };

  const fetchInsights = useCallback(async (append = false) => {
    if (!append) {
      setLoading(true);
      setPage(1);
    }
    setError(null);

    try {
      const params = {
        page: append ? page + 1 : 1,
        pageSize: 100,
        search: filters.query || undefined,
        sourceType: filters.sourceType !== "all" ? filters.sourceType : undefined,
        businessCategory: filters.businessCategory !== "all" ? filters.businessCategory : undefined,
        subjectCategory: filters.subjectCategory !== "all" ? filters.subjectCategory : undefined,
        purposes: (filters.purposes || []).length > 0 ? filters.purposes.join(",") : undefined,
        ...getDateRange(filters.dateRange)
      };
      const res = await backendApi.getInsights(params);
      const newData = res.data || [];
      const pagination = res.pagination || {};
      
      if (append) {
        setInsights(prev => [...prev, ...newData]);
        setPage(page + 1);
      } else {
        setInsights(newData);
        setFetched(true);
        const count = newData.length;
        const msg = language === "zh" ? `成功获取 ${count} 条洞察` : `Fetched ${count} insights`;
        // 稳定 id 覆盖：登录时默认视角自动启用会连发两次 fetch（默认筛选 + 视角筛选），
        // 新的结果直接覆盖旧 toast，最后只留最新一条（产品负责人 2026-10-21）。
        addToast(msg, "success", { id: "insights-fetch-result" });
      }
      
      // 使用后端返回的pagination信息判断是否还有更多数据
      const loadedCount = append ? (insights.length + newData.length) : newData.length;
      setHasMore(loadedCount < (pagination.total || 0));
    } catch (e) {
      setError(t.errors.fetchFailed + e.message);
      addToast(t.toasts.insightsFailed, "error");
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 不加入 insights.length：会让 fetchInsights 每次 insights 变化都重建，触发下方 debounce useEffect 循环
  }, [filters, t, language, page]);

  // Auto-fetch when filters change (debounced for query input) - reset pagination
  useEffect(() => {
    // 未登录时不打 /api/insights（Task 6 之后它在鉴权墙内，只会收到 401）。
    // 依赖里带上 userId：登录那一刻 filters 没变，不靠这个依赖不会自动拉首屏数据。
    // ⚠️ 绝不能加 insights.length —— 见上面 fetchInsights 的依赖说明。
    if (!userId) return;
    const timer = setTimeout(() => {
      fetchInsights(false);
    }, filters.query ? 500 : 0);
    return () => clearTimeout(timer);
  }, [filters, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load more function for infinite scroll
  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchInsights(true);
    }
  }, [loading, hasMore, fetchInsights]);

  const openAiDrawer = (item) => {
    setSelectedArticle(item);
    setAiDrawerOpen(true);
  };

  const closeAiDrawer = () => {
    setAiDrawerOpen(false);
    setSelectedArticle(null);
  };

  const saveReport = async (report) => {
    try {
      await backendApi.createReport(report);
      addToast(language === "zh" ? "报告已保存" : "Report saved", "success");
    } catch (e) {
      addToast(language === "zh" ? "保存报告失败" : "Failed to save report", "error");
      throw e;
    }
  };

  // 移动端不提供配置页：若正处于配置页（如桌面切到手机宽度），回退到市场洞察
  useEffect(() => {
    if (isMobile && activeTab === "configuration") setActiveTab("intelligence");
  }, [isMobile, activeTab]);

  const handleLogout = async () => {
    // 服务端失败也要清本地状态：会话 cookie 是 HttpOnly 的，前端唯一能做的判断是
    // 「本地不再认为已登录」。留着 user 只会让用户以为还登录着，而下一个请求照样 401。
    try {
      await backendApi.logout();
    } catch (e) {
      console.error("[App] logout failed:", e?.message || e);
    }
    // 不发 toast：ToastContainer 挂在主壳里，user 一变 null 主壳就被 LoginGate 替换，
    // toast 会跟着一起卸载 —— 用户看不到它，只会看到一个闪一下就没了的东西。
    setUser(null);
  };

  // —— 以下不再有 hook，可以早返回 ——
  if (!authReady) {
    // 身份还没问完。**不放任何文案**：此刻 language 仍是按设备猜的初始值，effect 可能马上
    // 把它改成存储值，闪一句错语言的「加载中」比一个中性的脉冲点更糟。
    // pulse 关键帧来自 src/styles/responsive.css（本文件已 import），不新增样式表。
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: darkMode ? COLORS.background.dark : "#f8f8fc"
      }}>
        <div style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: COLORS.primary,
          animation: "pulse 1.2s ease-in-out infinite"
        }} />
      </div>
    );
  }
  if (!user) return <LoginGate onLoggedIn={(u) => setUser(u)} />;

  const showIntelligence = activeTab === "intelligence";
  const showReports = activeTab === "reports";
  // 非管理员连页面都不渲染：Sidebar 已经不给入口，这里是兜底（activeTab 是普通 state，
  // 任何将来的代码都可能把它设成 "configuration"）。真正的边界在服务端 requireAdmin。
  const showConfiguration = activeTab === "configuration" && !isMobile && user.role === "admin";

  const bg = darkMode ? COLORS.background.dark : "#f8f8fc";
  const text = darkMode ? "#e8e8e8" : COLORS.text.primary;
  const border = darkMode ? COLORS.border.dark : COLORS.border.light;

  return (
    <div style={{
      height: "100vh",
      background: bg,
      fontFamily: "'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
      transition: `background ${TRANSITIONS.normal}`,
      display: "flex",
      flexDirection: "column"
    }}>
      <Header
        darkMode={darkMode}
        language={language}
        onLanguageToggle={handleLanguageToggle}
        isMobile={isMobile}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        user={user}
        onLogout={handleLogout}
      />

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* 移动端隐藏侧边栏，导航移至顶部，释放左侧空间 */}
        {!isMobile && (
          <Sidebar
            darkMode={darkMode}
            language={language}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            role={user.role}
          />
        )}

        <main style={{
          flex: 1,
          overflowY: "auto",
          padding: isMobile ? "16px 14px" : "24px 28px",
          minWidth: 0
        }}>
          {/* 标题行：左侧页面标题，右侧放页内标签（信息流/书签；报告/配置页通过 portal 挂入） */}
          <div ref={setTitleSlotEl} style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 20
          }}>
            <h1 style={{
              fontSize: FONT_SIZES["3xl"],
              fontWeight: 700,
              color: text,
              margin: 0
            }}>
              {activeTab === "reports"
                ? (language === "zh" ? "报告" : "Reports")
                : activeTab === "configuration"
                  ? (language === "zh" ? "配置" : "Configuration")
                  : t.competitiveIntelligence.pageTitle}
            </h1>
              {showIntelligence && (
                <div style={{
                  display: "flex", gap: 4,
                  background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
                  borderRadius: BORDER_RADIUS.lg, padding: 4, border: `1px solid ${border}`, width: "fit-content"
                }}>
                  {["feed", "bookmarks"].map(tab => (
                    <button key={tab} onClick={() => setSubTab(tab)} style={{
                      padding: "6px 14px", borderRadius: 7, border: "none",
                      background: subTab === tab ? COLORS.primary : "transparent",
                      color: subTab === tab ? "#fff" : darkMode ? "#aaa" : COLORS.text.secondary,
                      fontWeight: subTab === tab ? 700 : 400, fontSize: FONT_SIZES.md, cursor: "pointer"
                    }}>
                      {tab === "feed" ? t.tabs.feed : `${t.tabs.bookmarks} (${bookmarks.length})`}
                    </button>
                  ))}
                </div>
              )}
          </div>

          {showIntelligence && (
            <IntelligencePage
              darkMode={darkMode}
              language={language}
              viewsBar={
                <ViewsBar
                  darkMode={darkMode}
                  language={language}
                  views={views}
                  activeViewId={activeViewId}
                  drift={viewDrift}
                  onSelect={(v) => (v ? applyView(v) : exitView())}
                  onSave={saveViewAs}
                  onUpdateCurrent={updateCurrentView}
                  onDelete={async (v) => { await backendApi.deleteView(v.id); if (activeViewId === v.id) exitView(); await reloadViews(); }}
                  onSetDefault={async (v) => { await backendApi.setDefaultView(v.id); await reloadViews(); }}
                />
              }
              subTab={subTab}
              onSubTabChange={setSubTab}
              subjectKeywords={subjectKeywords}
              filters={filters}
              onFilterChange={setFilters}
              onSearch={fetchInsights}
              loading={loading}
              fetched={fetched}
              error={error}
              insights={insights}
              bookmarks={bookmarks}
              hidden={hidden}
              cart={cart}
              onToggleCart={toggleCart}
              onToggleBookmark={toggleBookmark}
              onHide={hideItem}
              userRole={user?.role}
              onSubmitToAdmin={submitToAdmin}
              onReclassify={reclassifyItem}
              onAiInterpret={openAiDrawer}
              onClearCart={clearCart}
              onGenerateReport={() => setShowReportModal(true)}
              onKeywordClick={(keyword) => {
                setFilters(prev => ({ ...prev, query: keyword }));
              }}
              loadMore={loadMore}
              hasMore={hasMore}
            />
          )}

          {showReports && (
            <ReportsPage
              darkMode={darkMode}
              language={language}
              user={user}
              titleSlotEl={titleSlotEl}
              openReportId={openReportId}
              onOpenReportHandled={() => setOpenReportId(null)}
              onViewReport={(report) => {
                setNewsletter(report.content);
              }}
              onGenerateDailyBriefing={() => {
                // 获取昨天和今天的所有 insights
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                const tomorrow = new Date(today);
                tomorrow.setDate(tomorrow.getDate() + 1);

                const recentInsights = insights.filter(item => {
                  const itemDate = new Date(item.date || item.publishDate);
                  return itemDate >= yesterday && itemDate < tomorrow;
                });

                if (recentInsights.length === 0) {
                  addToast(language === "zh" ? "暂无新的洞察" : "No recent insights", "warning");
                  return;
                }

                setCart(recentInsights);
                setDailyBriefingMode(true);
                setShowReportModal(true);
              }}
            />
          )}

          {showConfiguration && (
            <ConfigurationPage
              darkMode={darkMode}
              language={language}
              titleSlotEl={titleSlotEl}
              onTrackerComplete={loadInsightsFromBackend}
              user={user}
            />
          )}
        </main>
      </div>

      {newsletter && (
        <InsightsGenerator
          items={cart}
          onClose={() => setNewsletter(null)}
          darkMode={darkMode}
          defaultLanguage={language}
          t={t}
          onSaveReport={saveReport}
          onGenerate={async (newLang) => {
            try {
              const txt = await api.generateNewsletter(cart, newLang);
              setNewsletter(txt);
              setLanguage(newLang);
              storage.saveLanguage(newLang);
              return txt;
            } catch (e) {
              addToast(t.toasts.newsletterFailed + e.message, "error");
              throw e;
            }
          }}
        />
      )}

      {showApiConfig && (
        <ApiConfig
          onClose={() => setShowApiConfig(false)}
          onSave={handleApiConfigSave}
          currentConfig={apiConfig}
          darkMode={darkMode}
          language={language}
        />
      )}

      {aiDrawerOpen && selectedArticle && (
        <AiDrawer
          item={selectedArticle}
          darkMode={darkMode}
          language={language}
          onClose={closeAiDrawer}
        />
      )}

      {showReportModal && (
        <ReportGeneratorModal
          darkMode={darkMode}
          language={language}
          templates={reportTemplates}
          cart={cart}
          autoMode={dailyBriefingMode}
          onClose={() => { setShowReportModal(false); setDailyBriefingMode(false); }}
          onStarted={() => addToast(language === "zh" ? "报告已开始生成，进度见顶部进度条" : "Report generation started — see the progress bar at the top", "info")}
          onTemplatesChanged={() => backendApi.getReportTemplates(user?.role === "admin").then(r => setReportTemplates(r.data || [])).catch(() => {})}
        />
      )}

      <button
        onClick={handleDarkModeToggle}
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          width: 44,
          height: 44,
          borderRadius: "50%",
          border: `1px solid ${border}`,
          background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
          color: darkMode ? "#fff" : text,
          fontSize: FONT_SIZES.lg,
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 50
        }}
        title={darkMode ? t.buttons.lightMode : t.buttons.darkMode}
      >
        {darkMode ? "☼" : "☾"}
      </button>

      <ToastContainer toasts={toasts} removeToast={removeToast} darkMode={darkMode} />
    </div>
  );
}
