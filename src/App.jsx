import { useState, useCallback, useEffect } from "react";
import ApiConfig from "./components/ApiConfig";
import InsightsGenerator from "./components/InsightsGenerator";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import FilterBar from "./components/FilterBar";
import InsightCard from "./components/InsightCard";
import AiDrawer from "./components/AiDrawer";
import { ToastContainer } from "./components/Toast";
import { storage } from "./utils/storage";
import { api } from "./utils/api";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "./constants/theme";
import { i18n } from "./constants/i18n";
import { DEFAULT_FILTERS } from "./constants/taxonomy";
import "./styles/responsive.css";

function SkeletonCard({ darkMode }) {
  const bg = darkMode ? "#2a2d3a" : "#eee";
  return (
    <div style={{
      background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
      borderRadius: BORDER_RADIUS.xl,
      padding: "18px 20px",
      border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
      boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
      height: "100%",
      boxSizing: "border-box"
    }}>
      <div style={{ background: bg, height: 16, width: "75%", borderRadius: 6, marginBottom: 12 }} />
      <div style={{ background: bg, height: 12, width: "45%", borderRadius: 6, marginBottom: 20 }} />
      <div style={{ background: bg, height: 12, width: "95%", borderRadius: 6, marginBottom: 8 }} />
      <div style={{ background: bg, height: 12, width: "90%", borderRadius: 6, marginBottom: 8 }} />
      <div style={{ background: bg, height: 12, width: "60%", borderRadius: 6 }} />
    </div>
  );
}

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
  const [activeTab, setActiveTab] = useState("feed");
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

  const hideItem = (item) => {
    const newHidden = [...hidden, item.title];
    setHidden(newHidden);
    addToast(language === "zh" ? "已隐藏该文章" : "Article hidden", "info");
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
    if (!apiConfig || !apiConfig.apiKey) {
      setShowApiConfig(true);
      addToast(t.toasts.apiKeyRequired, "error");
      return;
    }

    setLoading(true);
    setError(null);
    setInsights([]);

    try {
      const newItems = await api.fetchInsights({
        selectedFocus: [],
        selectedRegions: [],
        search: filters.query,
        dateRange: filters.dateRange,
        businessDomain: filters.businessDomain,
        enterpriseType: filters.enterpriseType,
        sourceType: filters.sourceType
      }, language);

      const cartTitles = new Set(cart.map(c => c.title));
      const dedupedItems = newItems.filter(item => !cartTitles.has(item.title));
      setInsights(dedupedItems);
      setFetched(true);
      const message = typeof t.toasts.insightsFetched === "function"
        ? t.toasts.insightsFetched(newItems.length)
        : t.toasts.insightsFetched;
      addToast(message, "success");
    } catch (e) {
      setError(t.errors.fetchFailed + e.message);
      addToast(t.toasts.insightsFailed, "error");
    }
    setLoading(false);
  }, [filters, apiConfig, language, cart, t]);

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

  const displayItems = activeTab === "bookmarks" ? bookmarks : insights;
  const visibleItems = displayItems.filter(item => !hidden.includes(item.title));

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
        <Sidebar darkMode={darkMode} language={language} />

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
              {t.competitiveIntelligence.pageTitle}
            </h1>

            <div style={{
              display: "flex",
              gap: 4,
              background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
              borderRadius: BORDER_RADIUS.lg,
              padding: 4,
              border: `1px solid ${border}`
            }}>
              {["feed", "bookmarks"].map(tab => (
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
                  {tab === "feed" ? t.tabs.feed : `${t.tabs.bookmarks} (${bookmarks.length})`}
                </button>
              ))}
            </div>
          </div>

          {activeTab === "feed" && (
            <FilterBar
              darkMode={darkMode}
              language={language}
              filters={filters}
              onChange={setFilters}
              onSearch={fetchInsights}
              loading={loading}
            />
          )}

          {cart.length > 0 && activeTab === "feed" && (
            <div style={{
              background: COLORS.primaryLight,
              border: `1.5px solid ${COLORS.primary}`,
              borderRadius: BORDER_RADIUS.lg,
              padding: "12px 18px",
              marginBottom: 20,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 10
            }}>
              <div style={{ fontSize: FONT_SIZES.md, color: COLORS.primary, fontWeight: 600 }}>
                🛒 {cart.length} insight{cart.length > 1 ? "s" : ""} {t.cart.itemsSelected}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => {
                  setCart([]);
                  storage.saveCart([]);
                  addToast(t.toasts.cartCleared, "info");
                }} style={{
                  padding: "5px 12px",
                  borderRadius: BORDER_RADIUS.sm,
                  border: `1px solid ${COLORS.primary}`,
                  background: "transparent",
                  color: COLORS.primary,
                  fontSize: FONT_SIZES.sm,
                  cursor: "pointer"
                }}>{t.buttons.clearCart}</button>
                <button onClick={generateNewsletter} disabled={summarizing} style={{
                  padding: "5px 14px",
                  borderRadius: BORDER_RADIUS.sm,
                  border: "none",
                  background: COLORS.primary,
                  color: "#fff",
                  fontSize: FONT_SIZES.sm,
                  fontWeight: 700,
                  cursor: summarizing ? "not-allowed" : "pointer"
                }}>
                  {summarizing ? t.buttons.generating : t.buttons.generateNewsletter}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div style={{
              background: "#fff0f0",
              border: "1px solid #fcc",
              borderRadius: BORDER_RADIUS.lg,
              padding: "14px 18px",
              color: "#c00",
              fontSize: FONT_SIZES.base,
              marginBottom: 20
            }}>
              {error}
            </div>
          )}

          {loading && (
            <div className="insight-grid" style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 16
            }}>
              {[1, 2, 3, 4, 5, 6].map(i => <SkeletonCard key={i} darkMode={darkMode} />)}
            </div>
          )}

          {!loading && visibleItems.length > 0 && (
            <>
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12
              }}>
                <div style={{ fontSize: FONT_SIZES.sm, color: sub }}>
                  {activeTab === "feed" ? t.hints.clickToAdd : ""}
                </div>
                <div style={{ fontSize: FONT_SIZES.sm, color: sub }}>
                  {visibleItems.length} {language === "zh" ? "条结果" : "results"}
                </div>
              </div>
              <div className="insight-grid" style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                gap: 16
              }}>
                {visibleItems.map((item, i) => {
                  const inCart = !!cart.find(c => c.title === item.title);
                  const bookmarked = !!bookmarks.find(b => b.title === item.title);
                  return (
                    <div
                      key={item.id || i}
                      onClick={() => toggleCart(item)}
                      className="insight-card-wrapper"
                      style={{ cursor: "pointer", position: "relative" }}
                    >
                      {inCart && (
                        <div style={{
                          position: "absolute",
                          top: 10,
                          left: 10,
                          zIndex: 5,
                          background: COLORS.primary,
                          color: "#fff",
                          borderRadius: "50%",
                          width: 22,
                          height: 22,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 13,
                          fontWeight: 700
                        }}>✓</div>
                      )}
                      <InsightCard
                        item={item}
                        darkMode={darkMode}
                        language={language}
                        bookmarked={bookmarked}
                        onBookmark={(e) => { e?.stopPropagation(); toggleBookmark(item); }}
                        onHide={(e) => { e?.stopPropagation(); hideItem(item); }}
                        onAiInterpret={(e) => { e?.stopPropagation(); openAiDrawer(item); }}
                      />
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {!loading && activeTab === "bookmarks" && bookmarks.length === 0 && (
            <div style={{ textAlign: "center", padding: "80px 20px", color: "#aaa" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🔖</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#bbb" }}>{t.placeholders.noBookmarks}</div>
            </div>
          )}

          {!loading && !fetched && activeTab === "feed" && (
            <div style={{ textAlign: "center", padding: "80px 20px", color: "#aaa" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>⚡</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#bbb" }}>{t.placeholders.noInsights}</div>
            </div>
          )}

          {!loading && fetched && activeTab === "feed" && visibleItems.length === 0 && (
            <div style={{ textAlign: "center", padding: "80px 20px", color: "#aaa" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#bbb" }}>{t.competitiveIntelligence.noResults}</div>
            </div>
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
