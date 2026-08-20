import { useState, useCallback, useEffect, useRef } from "react";
import ApiConfig from "./components/ApiConfig";
import InsightsGenerator from "./components/InsightsGenerator";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import IntelligencePage from "./components/IntelligencePage";
import AiDrawer from "./components/AiDrawer";
import ReportsPage from "./components/ReportsPage";
import ReportGeneratorModal from "./components/ReportGeneratorModal";
import ConfigurationPage from "./components/ConfigurationPage";
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
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fetched, setFetched] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [cart, setCart] = useState([]);
  const [newsletter, setNewsletter] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const [bookmarks, setBookmarks] = useState([]);
  const [hidden, setHidden] = useState([]);
  const [activeTab, setActiveTab] = useState("intelligence");
  const [subTab, setSubTab] = useState("feed");
  // 标题行右侧插槽：报告/配置页通过 portal 把自己的控件挂进来
  const [titleSlotEl, setTitleSlotEl] = useState(null);
  const [showApiConfig, setShowApiConfig] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportTemplates, setReportTemplates] = useState([]);
  const [openReportId, setOpenReportId] = useState(null);
  const [apiConfig, setApiConfig] = useState(null);
  // 语言初始值按设备判断（手机端仅中文），避免 en→zh 切换触发重复 fetch/toast
  const [language, setLanguage] = useState(() => (isMobileViewport() ? "zh" : "en"));
  // 防重复 toast：记录上次成功 toast 的文案与时间
  const lastToastRef = useRef({ key: "", ts: 0 });
  const isMobile = useIsMobile();
  const [toasts, setToasts] = useState([]);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  // 内容过滤配置中的主体关键词（企业/主体 + 包含关键词及别名），用于卡片高亮
  const [subjectKeywords, setSubjectKeywords] = useState([]);

  const t = i18n[language];

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
  }, [language]);

  useEffect(() => {
    setDarkMode(storage.getDarkMode());
    setBookmarks(storage.getBookmarks());
    setCart(storage.getCart());
    setApiConfig(storage.getApiConfig());
    const savedLanguage = storage.getStoredLanguage();
    // 移动端仅中文界面（语言切换已隐藏）；Web 端沿用保存值，默认英文
    setLanguage(isMobileViewport() ? "zh" : (savedLanguage || "en"));
    loadInsightsFromBackend();
    backendApi.getReportTemplates().then(r => setReportTemplates(r.data || [])).catch(() => {});
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addToast = (message, type = "success") => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
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
      
      if (append) {
        setInsights(prev => [...prev, ...newData]);
        setPage(page + 1);
      } else {
        setInsights(newData);
        setFetched(true);
        const count = newData.length;
        const msg = language === "zh" ? `成功获取 ${count} 条洞察` : `Fetched ${count} insights`;
        const now = Date.now();
        const last = lastToastRef.current;
        if (!(last && last.key === msg && now - last.ts < 2000)) {
          addToast(msg, "success");
          lastToastRef.current = { key: msg, ts: now };
        }
      }
      
      setHasMore(newData.length === 150);
    } catch (e) {
      setError(t.errors.fetchFailed + e.message);
      addToast(t.toasts.insightsFailed, "error");
    }
    setLoading(false);
  }, [filters, t, language, page]);

  // Auto-fetch when filters change (debounced for query input) - reset pagination
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchInsights(false);
    }, filters.query ? 500 : 0);
    return () => clearTimeout(timer);
  }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const showIntelligence = activeTab === "intelligence";
  const showReports = activeTab === "reports";
  const showConfiguration = activeTab === "configuration" && !isMobile;

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
      />

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* 移动端隐藏侧边栏，导航移至顶部，释放左侧空间 */}
        {!isMobile && (
          <Sidebar
            darkMode={darkMode}
            language={language}
            activeTab={activeTab}
            onTabChange={setActiveTab}
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
          onClose={() => setShowReportModal(false)}
          onStarted={() => addToast(language === "zh" ? "报告已开始生成，进度见顶部进度条" : "Report generation started — see the progress bar at the top", "info")}
          onTemplatesChanged={() => backendApi.getReportTemplates().then(r => setReportTemplates(r.data || [])).catch(() => {})}
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
