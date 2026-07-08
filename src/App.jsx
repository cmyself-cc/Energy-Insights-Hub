import { useState, useCallback, useEffect } from "react";
import ApiConfig from "./components/ApiConfig";
import InsightsGenerator from "./components/InsightsGenerator";
import { ToastContainer } from "./components/Toast";
import { storage } from "./utils/storage";
import { api } from "./utils/api";
import { COLORS, FONT_SIZES, BORDER_RADIUS, TRANSITIONS } from "./constants/theme";
import { i18n, FOCUS_AREAS, REGIONS, TIME_RANGE_KEYS } from "./constants/i18n";
import "./styles/responsive.css";

function Chip({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 14px",
      borderRadius: BORDER_RADIUS.full,
      border: active ? "none" : "1.5px solid #e0e0e0",
      background: active ? COLORS.primary : "#fff",
      color: active ? "#fff" : COLORS.text.secondary,
      fontSize: FONT_SIZES.md,
      cursor: "pointer",
      fontWeight: active ? 600 : 400,
      transition: `all ${TRANSITIONS.fast}`,
      whiteSpace: "nowrap"
    }}>{label}</button>
  );
}

function InsightCard({ item, selected, onToggle, darkMode, linkText = "🔗 View original" }) {
  return (
    <div onClick={onToggle} style={{
      background: selected ? COLORS.primaryLight : darkMode ? COLORS.background.cardDark : COLORS.background.card,
      borderRadius: BORDER_RADIUS.xl,
      padding: "20px 24px",
      boxShadow: selected ? "0 0 0 2px #1a6b3c" : "0 1px 4px rgba(0,0,0,0.08)",
      border: selected ? "2px solid #1a6b3c" : `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
      cursor: "pointer",
      transition: `all ${TRANSITIONS.fast}`,
      position: "relative"
    }}>
      {selected && (
        <div style={{
          position: "absolute",
          top: 12,
          right: 12,
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
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {item.tags?.map(t => (
          <span key={t} style={{
            fontSize: 11,
            fontWeight: 600,
            color: COLORS.primary,
            background: COLORS.primaryLight,
            borderRadius: 6,
            padding: "2px 8px",
            textTransform: "uppercase",
            letterSpacing: 0.5
          }}>{t}</span>
        ))}
      </div>
      <div style={{
        fontWeight: 700,
        fontSize: FONT_SIZES.xl,
        color: darkMode ? "#e8e8e8" : "#111",
        lineHeight: 1.4,
        marginBottom: 8
      }}>{item.title}</div>
      <div style={{
        fontSize: FONT_SIZES.base,
        color: darkMode ? "#aaa" : COLORS.text.secondary,
        lineHeight: 1.6,
        marginBottom: 8
      }}>{item.summary}</div>
      <div style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#888" : COLORS.text.light, paddingRight: "44px" }}>
        {item.source && <span style={{ fontWeight: 500, color: COLORS.text.tertiary }}>{item.source}</span>}
        {item.source && item.date && <span> · </span>}
        {item.date && <span>{item.date}</span>}
        {item.url && (
          <div style={{ marginTop: 4 }}>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{
                color: COLORS.primary,
                textDecoration: "none",
                fontSize: FONT_SIZES.sm,
                fontWeight: 500,
                display: "inline-flex",
                alignItems: "center",
                gap: 4
              }}
            >
              {linkText}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}



export default function App() {
  const [selectedFocus, setSelectedFocus] = useState([]);
  const [selectedRegions, setSelectedRegions] = useState([]);
  const [search, setSearch] = useState("");
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fetched, setFetched] = useState(false);
  const [cart, setCart] = useState([]);
  const [summarizing, setSummarizing] = useState(false);
  const [newsletter, setNewsletter] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const [bookmarks, setBookmarks] = useState([]);
  const [activeTab, setActiveTab] = useState("feed");
  const [showApiConfig, setShowApiConfig] = useState(false);
  const [apiConfig, setApiConfig] = useState(null);
  const [language, setLanguage] = useState("en");
  const [timeRange, setTimeRange] = useState("noLimit");
  const [toasts, setToasts] = useState([]);

  const t = i18n[language];

  useEffect(() => {
    const savedDarkMode = storage.getDarkMode();
    setDarkMode(savedDarkMode);

    const savedBookmarks = storage.getBookmarks();
    setBookmarks(savedBookmarks);

    const savedCart = storage.getCart();
    setCart(savedCart);

    const savedApiConfig = storage.getApiConfig();
    setApiConfig(savedApiConfig);

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

  const toggleItem = (list, setList, item) => setList(prev => prev.includes(item) ? prev.filter(x => x !== item) : [...prev, item]);
  const toggleCart = (item) => {
    const newCart = cart.find(c => c.title === item.title) ? cart.filter(c => c.title !== item.title) : [...cart, item];
    setCart(newCart);
    storage.saveCart(newCart);
    addToast(newCart.length > cart.length ? t.toasts.addedToCart : t.toasts.removedFromCart, "info");
  };
  const toggleBookmark = (item) => {
    const newBookmarks = bookmarks.find(b => b.title === item.title) ? bookmarks.filter(b => b.title !== item.title) : [...bookmarks, item];
    setBookmarks(newBookmarks);
    storage.saveBookmarks(newBookmarks);
    addToast(newBookmarks.length > bookmarks.length ? t.toasts.addedToBookmarks : t.toasts.removedFromBookmarks, "success");
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
      const newItems = await api.fetchInsights({ selectedFocus, selectedRegions, search, timeRange }, language);
      // Deduplicate: hide insights whose titles already appear in the cart
      const cartTitles = new Set(cart.map(c => c.title));
      const dedupedItems = newItems.filter(item => !cartTitles.has(item.title));
      setInsights(dedupedItems);
      setFetched(true);
      const message = typeof t.toasts.insightsFetched === 'function' 
        ? t.toasts.insightsFetched(newItems.length) 
        : t.toasts.insightsFetched;
      addToast(message, "success");
    } catch (e) {
      setError(t.errors.fetchFailed + e.message);
      addToast(t.toasts.insightsFailed, "error");
    }
    setLoading(false);
  }, [selectedFocus, selectedRegions, search, apiConfig, language, t]);

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

  const displayItems = activeTab === "bookmarks" ? bookmarks : insights;

  const bg = darkMode ? COLORS.background.dark : COLORS.background.light;
  const card = darkMode ? COLORS.background.cardDark : COLORS.background.card;
  const text = darkMode ? "#e8e8e8" : COLORS.text.primary;
  const sub = darkMode ? "#aaa" : COLORS.text.secondary;
  const border = darkMode ? COLORS.border.dark : COLORS.border.light;

  return (
    <div style={{ minHeight: "100vh", background: bg, fontFamily: "'Inter',system-ui,sans-serif", transition: `background ${TRANSITIONS.normal}` }}>
      <div style={{
        background: darkMode ? COLORS.background.cardDark : card,
        borderBottom: `1px solid ${border}`,
        padding: "16px 32px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 100
      }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: FONT_SIZES["3xl"], color: darkMode ? "#fff" : text, letterSpacing: -0.5 }}>{t.header.title}</div>
          <div style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#888" : sub, marginTop: 1 }}>{t.header.subtitle}</div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button
            onClick={() => setShowApiConfig(true)}
            style={{
              padding: "7px 14px",
              borderRadius: BORDER_RADIUS.md,
              border: `1.5px solid ${border}`,
              background: "transparent",
              color: darkMode ? "#fff" : text,
              fontSize: FONT_SIZES.md,
              cursor: "pointer",
              fontWeight: 500
            }}
          >
            {t.buttons.apiConfig}
          </button>
          {cart.length > 0 && (
            <button onClick={generateNewsletter} disabled={summarizing} style={{
              padding: "8px 16px",
              borderRadius: BORDER_RADIUS.md,
              border: "none",
              background: summarizing ? "#aaa" : COLORS.primary,
              color: "#fff",
              fontWeight: 700,
              fontSize: FONT_SIZES.md,
              cursor: summarizing ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6
            }}>
              {summarizing ? t.buttons.generating : `${t.buttons.summarize} (${cart.length})`}
            </button>
          )}
          <button onClick={handleDarkModeToggle} style={{
            padding: "7px 14px",
            borderRadius: BORDER_RADIUS.md,
            border: `1.5px solid ${border}`,
            background: "transparent",
            color: darkMode ? "#fff" : text,
            fontSize: FONT_SIZES.md,
            cursor: "pointer",
            fontWeight: 500
          }}>{darkMode ? t.buttons.lightMode : t.buttons.darkMode}</button>
          <button onClick={handleLanguageToggle} style={{
            padding: "7px 14px",
            borderRadius: BORDER_RADIUS.md,
            border: `1.5px solid ${border}`,
            background: "transparent",
            color: darkMode ? "#fff" : text,
            fontSize: FONT_SIZES.md,
            cursor: "pointer",
            fontWeight: 500
          }}>{language === "en" ? "🇨🇳 中文" : "🇺🇸 English"}</button>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "28px 24px" }}>
        <div style={{
          display: "flex",
          gap: 4,
          marginBottom: 24,
          background: darkMode ? COLORS.background.cardDark : card,
          borderRadius: BORDER_RADIUS.lg,
          padding: 4,
          border: `1px solid ${border}`,
          width: "fit-content"
        }}>
          {["feed", "bookmarks"].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              padding: "7px 18px",
              borderRadius: 7,
              border: "none",
              background: activeTab === tab ? COLORS.primary : "transparent",
              color: activeTab === tab ? "#fff" : darkMode ? "#aaa" : sub,
              fontWeight: activeTab === tab ? 700 : 400,
              fontSize: FONT_SIZES.md,
              cursor: "pointer",
              textTransform: "capitalize"
            }}>
              {tab === "feed" ? t.tabs.feed : `${t.tabs.bookmarks} (${bookmarks.length})`}
            </button>
          ))}
        </div>

        {activeTab === "feed" && <>
          <input type="text" placeholder={t.search.placeholder}
            value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && fetchInsights()}
            style={{
              width: "100%",
              padding: "12px 18px",
              borderRadius: BORDER_RADIUS.lg,
              border: `1.5px solid ${border}`,
              fontSize: FONT_SIZES.base,
              outline: "none",
              background: darkMode ? COLORS.background.cardDark : card,
              color: darkMode ? "#e8e8e8" : text,
              boxSizing: "border-box",
              marginBottom: 20
            }} />

          <div style={{
            background: darkMode ? COLORS.background.cardDark : card,
            borderRadius: BORDER_RADIUS.xl,
            padding: "20px 24px",
            border: `1px solid ${border}`,
            marginBottom: 20
          }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#888",
                textTransform: "uppercase",
                letterSpacing: 0.8,
                marginBottom: 10
              }}>{t.filters.focusAreas}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {FOCUS_AREAS[language].map(f => <Chip key={f} label={f} active={selectedFocus.includes(f)} onClick={() => toggleItem(selectedFocus, setSelectedFocus, f)} />)}
              </div>
            </div>
            <div>
              <div style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#888",
                textTransform: "uppercase",
                letterSpacing: 0.8,
                marginBottom: 10
              }}>{t.filters.regions}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {REGIONS[language].map(r => <Chip key={r} label={r} active={selectedRegions.includes(r)} onClick={() => toggleItem(selectedRegions, setSelectedRegions, r)} />)}
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <div style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#888",
                textTransform: "uppercase",
                letterSpacing: 0.8,
                marginBottom: 10
              }}>{t.filters.timeRange}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {TIME_RANGE_KEYS.map(key => (
                  <Chip
                    key={key}
                    label={t.timeRanges[key]}
                    active={timeRange === key}
                    onClick={() => setTimeRange(key)}
                  />
                ))}
              </div>
            </div>
          </div>

          <button onClick={fetchInsights} disabled={loading} style={{
            width: "100%",
            padding: "13px",
            borderRadius: BORDER_RADIUS.lg,
            border: "none",
            background: loading ? "#aaa" : COLORS.primary,
            color: "#fff",
            fontSize: 15,
            fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer",
            marginBottom: 28
          }}>{loading ? t.buttons.fetching : fetched ? t.buttons.refreshInsights : t.buttons.getInsights}</button>

          {error && <div style={{
            background: "#fff0f0",
            border: "1px solid #fcc",
            borderRadius: 10,
            padding: "14px 18px",
            color: "#c00",
            fontSize: FONT_SIZES.base,
            marginBottom: 20
          }}>{error}</div>}
        </>}

        {cart.length > 0 && (
          <div style={{
            background: COLORS.primaryLight,
            border: "1.5px solid #1a6b3c",
            borderRadius: 10,
            padding: "12px 18px",
            marginBottom: 20,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
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
                borderRadius: 6,
                border: "1px solid #1a6b3c",
                background: "transparent",
                color: COLORS.primary,
                fontSize: FONT_SIZES.sm,
                cursor: "pointer"
              }}>{t.buttons.clearCart}</button>
              <button onClick={generateNewsletter} disabled={summarizing} style={{
                padding: "5px 14px",
                borderRadius: 6,
                border: "none",
                background: COLORS.primary,
                color: "#fff",
                fontSize: FONT_SIZES.sm,
                fontWeight: 700,
                cursor: "pointer"
              }}>
                {summarizing ? t.buttons.generating : t.buttons.generateNewsletter}
              </button>
            </div>
          </div>
        )}

        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
              <div key={i} style={{
                background: card,
                borderRadius: BORDER_RADIUS.xl,
                padding: "20px 24px",
                border: `1px solid ${border}`,
                opacity: 0.5
              }}>
                <div style={{ background: "#eee", height: 14, width: "30%", borderRadius: 6, marginBottom: 12 }} />
                <div style={{ background: "#eee", height: 18, width: "80%", borderRadius: 6, marginBottom: 10 }} />
                <div style={{ background: "#eee", height: 12, width: "95%", borderRadius: 6 }} />
              </div>
            ))}
          </div>
        )}

        {!loading && displayItems.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {activeTab === "feed" && <div style={{ fontSize: FONT_SIZES.sm, color: sub, marginBottom: 4 }}>💡 Click a card to add it to your newsletter selection</div>}
            {displayItems.map((item, i) => {
              const inCart = !!cart.find(c => c.title === item.title);
              const bookmarked = !!bookmarks.find(b => b.title === item.title);
              return (
                <div key={i} style={{ position: "relative" }}>
                  <InsightCard item={item} selected={inCart} onToggle={() => toggleCart(item)} inCart={inCart} darkMode={darkMode} linkText={t.insightCard.viewOriginal} />
                  <button onClick={(e) => { e.stopPropagation(); toggleBookmark(item); }} title={bookmarked ? "Remove bookmark" : "Bookmark"} style={{
                    position: "absolute",
                    bottom: 14,
                    right: 14,
                    background: bookmarked ? "#fff8e1" : (darkMode ? "#2a2d3a" : "#f5f5f5"),
                    border: bookmarked ? "1px solid #f5c518" : `1px solid ${darkMode ? "#3a3d4a" : "#ddd"}`,
                    borderRadius: 6,
                    padding: "3px 8px",
                    fontSize: FONT_SIZES.sm,
                    cursor: "pointer",
                    color: bookmarked ? "#e6a800" : (darkMode ? "#aaa" : "#888"),
                    fontWeight: 600
                  }}>{bookmarked ? "🔖" : "☆"}</button>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === "bookmarks" && bookmarks.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#aaa" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔖</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#bbb" }}>{t.placeholders.noBookmarks}</div>
          </div>
        )}

        {!loading && !fetched && activeTab === "feed" && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#aaa" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚡</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#bbb" }}>{t.placeholders.noInsights}</div>
          </div>
        )}
      </div>

      {newsletter && <InsightsGenerator 
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
      />}
      {showApiConfig && <ApiConfig onClose={() => setShowApiConfig(false)} onSave={handleApiConfigSave} currentConfig={apiConfig} darkMode={darkMode} language={language} />}
      <ToastContainer toasts={toasts} removeToast={removeToast} darkMode={darkMode} />
    </div>
  );
}