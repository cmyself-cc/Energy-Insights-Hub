import { useState, useCallback, useEffect } from "react";
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
import { COLORS, FONT_SIZES, TRANSITIONS } from "./constants/theme";
import { i18n } from "./constants/i18n";
import { DEFAULT_FILTERS } from "./constants/taxonomy";
import "./styles/responsive.css";

export default function App() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fetched, setFetched] = useState(false);
  const [cart, setCart] = useState([]);
  const [newsletter, setNewsletter] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const [bookmarks, setBookmarks] = useState([]);
  const [hidden, setHidden] = useState([]);
  const [activeTab, setActiveTab] = useState("intelligence");
  const [showApiConfig, setShowApiConfig] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportTemplates, setReportTemplates] = useState([]);
  const [openReportId, setOpenReportId] = useState(null);
  const [apiConfig, setApiConfig] = useState(null);
  const [language, setLanguage] = useState("en");
  const [toasts, setToasts] = useState([]);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);

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
    const savedLanguage = storage.getLanguage();
    setLanguage(savedLanguage);
    loadInsightsFromBackend();
    backendApi.getReportTemplates().then(r => setReportTemplates(r.data || [])).catch(() => {});
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

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = {
        pageSize: 100,
        search: filters.query || undefined,
        sourceType: filters.sourceType !== "all" ? filters.sourceType : undefined,
        businessCategory: filters.businessCategory !== "all" ? filters.businessCategory : undefined,
        eventCategory: filters.eventCategory !== "all" ? filters.eventCategory : undefined,
        purposes: (filters.purposes || []).length > 0 ? filters.purposes.join(",") : undefined,
        ...getDateRange(filters.dateRange)
      };
      const res = await backendApi.getInsights(params);
      setInsights(res.data || []);
      setFetched(true);
      const count = res.data?.length || 0;
      const zh = storage.getLanguage() === "zh";
      addToast(zh ? `成功获取 ${count} 条洞察` : `Fetched ${count} insights`, "success");
    } catch (e) {
      setError(t.errors.fetchFailed + e.message);
      addToast(t.toasts.insightsFailed, "error");
    }
    setLoading(false);
  }, [filters, t]);

  // Auto-fetch when filters change (debounced for query input)
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchInsights();
    }, filters.query ? 500 : 0);
    return () => clearTimeout(timer);
  }, [filters, fetchInsights]);

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

  const showIntelligence = activeTab === "intelligence";
  const showReports = activeTab === "reports";
  const showConfiguration = activeTab === "configuration";

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
      />

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <Sidebar
          darkMode={darkMode}
          language={language}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        <main style={{
          flex: 1,
          overflowY: "auto",
          padding: "24px 28px",
          minWidth: 0
        }}>
          <h1 style={{
            fontSize: FONT_SIZES["3xl"],
            fontWeight: 700,
            color: text,
            margin: "0 0 20px"
          }}>
            {activeTab === "reports"
              ? (language === "zh" ? "报告" : "Reports")
              : activeTab === "configuration"
                ? (language === "zh" ? "配置" : "Configuration")
                : t.competitiveIntelligence.pageTitle}
          </h1>

          {showIntelligence && (
            <IntelligencePage
              darkMode={darkMode}
              language={language}
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
              onAiInterpret={openAiDrawer}
              onClearCart={clearCart}
              onGenerateReport={() => setShowReportModal(true)}
              onKeywordClick={(keyword) => {
                setFilters(prev => ({ ...prev, query: keyword }));
              }}
            />
          )}

          {showReports && (
            <ReportsPage
              darkMode={darkMode}
              language={language}
              openReportId={openReportId}
              onOpenReportHandled={() => setOpenReportId(null)}
              onViewReport={(report) => {
                setNewsletter(report.content);
              }}
            />
          )}

          {showConfiguration && (
            <ConfigurationPage
              darkMode={darkMode}
              language={language}
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
          onDone={(reportId) => { setOpenReportId(reportId); }}
          onOpenReports={() => { setShowReportModal(false); setActiveTab("reports"); }}
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
