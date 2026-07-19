import { useState } from "react";
import FilterBar from "./FilterBar";
import InsightCard from "./InsightCard";
import { COLORS, FONT_SIZES, BORDER_RADIUS } from "../constants/theme";
import { i18n } from "../constants/i18n";

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

export default function IntelligencePage(props) {
  const {
    darkMode, language, filters, onFilterChange, onSearch, loading, fetched, error,
    insights, bookmarks, hidden, cart, onToggleCart, onToggleBookmark, onHide, onAiInterpret,
    onClearCart, onGenerateNewsletter, summarizing, onKeywordClick
  } = props;
  const [subTab, setSubTab] = useState("feed");

  const t = i18n[language];
  const sub = darkMode ? "#aaa" : COLORS.text.secondary;
  const border = darkMode ? COLORS.border.dark : COLORS.border.light;

  const displayItems = subTab === "bookmarks" ? bookmarks : insights;
  const visibleItems = displayItems.filter(item => !hidden.includes(item.title));

  return (
    <div>
      <div style={{
        display: "flex", gap: 4, marginBottom: 20,
        background: darkMode ? COLORS.background.cardDark : COLORS.background.card,
        borderRadius: BORDER_RADIUS.lg, padding: 4, border: `1px solid ${border}`, width: "fit-content"
      }}>
        {["feed", "bookmarks"].map(tab => (
          <button key={tab} onClick={() => setSubTab(tab)} style={{
            padding: "6px 14px", borderRadius: 7, border: "none",
            background: subTab === tab ? COLORS.primary : "transparent",
            color: subTab === tab ? "#fff" : darkMode ? "#aaa" : sub,
            fontWeight: subTab === tab ? 700 : 400, fontSize: FONT_SIZES.md, cursor: "pointer"
          }}>
            {tab === "feed" ? t.tabs.feed : `${t.tabs.bookmarks} (${bookmarks.length})`}
          </button>
        ))}
      </div>

      {subTab === "feed" && (
        <FilterBar darkMode={darkMode} language={language} filters={filters} onChange={onFilterChange} onSearch={onSearch} loading={loading} />
      )}

      {cart.length > 0 && subTab === "feed" && (
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
            <button onClick={onClearCart} style={{
              padding: "5px 12px",
              borderRadius: BORDER_RADIUS.sm,
              border: `1px solid ${COLORS.primary}`,
              background: "transparent",
              color: COLORS.primary,
              fontSize: FONT_SIZES.sm,
              cursor: "pointer"
            }}>{t.buttons.clearCart}</button>
            <button onClick={onGenerateNewsletter} disabled={summarizing} style={{
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
        <div className="insight-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {[1, 2, 3, 4, 5, 6].map(i => <SkeletonCard key={i} darkMode={darkMode} />)}
        </div>
      )}

      {!loading && visibleItems.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: FONT_SIZES.sm, color: sub }}>
              {subTab === "feed" ? t.hints.clickToAdd : ""}
            </div>
            <div style={{ fontSize: FONT_SIZES.sm, color: sub }}>
              {visibleItems.length} {language === "zh" ? "条结果" : "results"}
            </div>
          </div>
          <div style={{
            columnWidth: 340,
            columnGap: 16,
            columnFill: "balance"
          }}>
            {visibleItems.map((item, i) => {
              const inCart = !!cart.find(c => c.title === item.title);
              const bookmarked = !!bookmarks.find(b => b.title === item.title);
              return (
                <div
                  key={item.id || i}
                  onClick={() => onToggleCart(item)}
                  style={{
                    cursor: "pointer",
                    position: "relative",
                    breakInside: "avoid",
                    marginBottom: 16
                  }}
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
                    onBookmark={(e) => { e?.stopPropagation(); onToggleBookmark(item); }}
                    onHide={(e) => { e?.stopPropagation(); onHide(item); }}
                    onAiInterpret={(e) => { e?.stopPropagation(); onAiInterpret(item); }}
                    onKeywordClick={onKeywordClick}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}

      {!loading && subTab === "bookmarks" && bookmarks.length === 0 && (
        <div style={{ textAlign: "center", padding: "80px 20px", color: "#aaa" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔖</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#bbb" }}>{t.placeholders.noBookmarks}</div>
        </div>
      )}

      {!loading && subTab === "feed" && !fetched && (
        <div style={{ textAlign: "center", padding: "80px 20px", color: "#aaa" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚡</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#bbb" }}>{t.placeholders.noInsights}</div>
        </div>
      )}

      {!loading && subTab === "feed" && fetched && visibleItems.length === 0 && (
        <div style={{ textAlign: "center", padding: "80px 20px", color: "#aaa" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#bbb" }}>{t.competitiveIntelligence.noResults}</div>
        </div>
      )}
    </div>
  );
}
