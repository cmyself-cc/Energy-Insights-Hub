import { useState, useCallback, useEffect } from "react";
import ApiConfig from "./components/ApiConfig";
import InsightsGenerator from "./components/InsightsGenerator";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import IntelligencePage from "./components/IntelligencePage";
import AiDrawer from "./components/AiDrawer";
import ReportsPage from "./components/ReportsPage";
import SourcesPage from "./components/SourcesPage";
import TrackerSettingsPage from "./components/TrackerSettingsPage";
import { ToastContainer } from "./components/Toast";
import { storage } from "./utils/storage";
import { api } from "./utils/api";
import { backendApi } from "./utils/backendApi";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "./constants/theme";
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
  const [summarizing, setSummarizing] = useState(false);
  const [newsletter, setNewsletter] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const [bookmarks, setBookmarks] = useState([]);
  const [hidden, setHidden] = useState([]);
  const [activeTab, setActiveTab] = useState("intelligence");
  const [showApiConfig, setShowApiConfig] = useState(false);
  const [apiConfig, setApiConfig] = useState(null);
  const [language, setLanguage] = useState("en");
  const [toasts, setToasts] = useState([]);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);

  const t = i18n[language];

  useEffect(() => {
    setDarkMode(storage.getDarkMode());
    setBookmarks(storage.getBookmarks());
    setCart(storage.getCart());
    setApiConfig(storage.getApiConfig());
    const savedLanguage = storage.getLanguage();
    setLanguage(savedLanguage);
    loadInsightsFromBackend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadInsightsFromBackend = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await backendApi.getInsights({ pageSize: 100 });
      setInsights(res.data || []);
      setFetched(true);
    } catch (e) {
      setError(language === "zh" ? "无法连接到后端服务，请确认已运行 npm run dev:server" : "Cannot connect to backend. Please run npm run dev:server");
      console.error("Backend load failed:", e);
    }
    setLoading(false);
  };

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
    addToast(newCart.length > cart.length ? t.toasts.addedToCart : t.toasts.removedFromCart, "info");
  };

  const toggleBookmark = (item) => {
    const newBookmarks = bookmarks.find(b => b.title === item.title)
      ? bookmarks.filter(b => b.title !== item.title)
      : [...bookmarks, item];
    setBookmarks(newBookmarks);
    storage.saveBookmarks(newBookmarks);
    addToast(newBookmarks.length > bookmarks.length ? t.toasts.addedToBookmarks : t.toasts.removedFromBookmarks, "success");
  };

  const hideItem = async (item) => {
    try {
      if (item.id) {
        await backendApi.hideInsight(item.id);
      }
      const newHidden = [...hidden, item.title];
      setHidden(newHidden);
      addToast(language === "zh" ? "已隐藏该文章" : "Article hidden", "info");
    } catch (e) {
      console.error("Hide failed:", e);
    }
  };

  const clearCart = () => {
    setCart([]);
    storage.saveCart([]);
    addToast(t.toasts.cartCleared, "info");
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

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = {
        pageSize: 100,
        search: filters.query || undefined,
        businessDomain: filters.businessDomain !== "all" ? filters.businessDomain : undefined,
        enterpriseType: filters.enterpriseType !== "all" ? filters.enterpriseType : undefined,
        sourceType: filters.sourceType !== "all" ? filters.sourceType : undefined
      };
      const res = await backendApi.getInsights(params);
      setInsights(res.data || []);
      setFetched(true);
      const count = res.data?.length || 0;
      const message = typeof t.toasts.insightsFetched === "function"
        ? t.toasts.insightsFetched(count)
        : t.toasts.insightsFetched;
      addToast(message, "success");
    } catch (e) {
      setError(t.errors.fetchFailed + e.message);
      addToast(t.toasts.insightsFailed, "error");
    }
    setLoading(false);
  }, [filters, t]);

  const generateNewsletter = useCallback(async (overrideLang) => {
    if (!cart.length) return;
    if (!apiConfig || !apiConfig.apiKey) {
      setShowApiConfig(true);
      addToast(t.toasts.apiKeyRequired, "error");
      return;
    }

    const lang = overrideLang || language;
    setSummarizing(true);
    try {
      const txt = await api.generateNewsletter(cart, lang);
      setNewsletter(txt);
      addToast(t.toasts.newsletterGenerated, "success");
    } catch (e) {
      addToast(t.toasts.newsletterFailed + e.message, "error");
    }
    setSummarizing(false);
  }, [cart, apiConfig, language, t]);

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
  const showSources = activeTab === "sources";
  const showSettings = activeTab === "settings";

  const bg = darkMode ? COLORS.background.dark : "#f8f8fc";
  const text = darkMode ? "#e8e8e8" : COLORS.text.primary;
  const sub = darkMode ? "#aaa" : COLORS.text.secondary;
  const border = darkMode ? COLORS.border.dark : COLORS.border.light;

  return (
    <div style={{
      minHeight: "100vh",
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
        onApiConfig={() => setShowApiConfig(true)}
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
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 20,
            flexWrap: "wrap",
            gap: 12
          }}>
            <h1 style={{
              fontSize: FONT_SIZES["3xl"],
              fontWeight: 700,
              color: text,
              margin: 0
            }}>
              {activeTab === "reports"
                ? (language === "zh" ? "报告" : "Reports")
                : activeTab === "sources"
                  ? (language === "zh" ? "数据来源" : "Data Sources")
                  : activeTab === "bookmarks"
                    ? t.tabs.bookmarks
                    : t.competitiveIntelligence.pageTitle}
            </h1>

            <div style={{
              display: "flex",
              gap: 4,
              background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
              borderRadius: BORDER_RADIUS.lg,
              padding: 4,
              border: `1px solid ${border}`
            }}>
              {["intelligence", "sources", "reports", "bookmarks", "settings"].map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{
                  padding: "6px 14px",
                  borderRadius: 7,
                  border: "none",
                  background: activeTab === tab ? COLORS.primary : "transparent",
                  color: activeTab === tab ? "#fff" : darkMode ? "#aaa" : sub,
                  fontWeight: activeTab === tab ? 700 : 400,
                  fontSize: FONT_SIZES.md,
                  cursor: "pointer"
                }}>
                  {tab === "intelligence"
                    ? t.tabs.feed
                    : tab === "sources"
                      ? (language === "zh" ? "来源" : "Sources")
                      : tab === "reports"
                        ? (language === "zh" ? "报告" : "Reports")
                        : tab === "settings"
                          ? t.competitiveIntelligence.settings
                          : `${t.tabs.bookmarks} (${bookmarks.length})`}
                </button>
              ))}
            </div>
          </div>

          {(showIntelligence || activeTab === "bookmarks") && (
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
              onGenerateNewsletter={generateNewsletter}
              summarizing={summarizing}
              defaultSubTab={activeTab === "bookmarks" ? "bookmarks" : "feed"}
            />
          )}

          {!loading && showReports && (
            <ReportsPage
              darkMode={darkMode}
              language={language}
              onViewReport={(report) => {
                setNewsletter(report.content);
              }}
            />
          )}

          {!loading && showSources && (
            <SourcesPage darkMode={darkMode} language={language} />
          )}

          {!loading && showSettings && (
            <TrackerSettingsPage darkMode={darkMode} language={language} />
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
        {darkMode ? "☀" : "🌙"}
      </button>

      <ToastContainer toasts={toasts} removeToast={removeToast} darkMode={darkMode} />
    </div>
  );
}
