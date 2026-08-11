import { useState, useMemo, useEffect, useRef } from "react";
import FilterBar from "./FilterBar";
import InsightCard from "./InsightCard";
import { COLORS, FONT_SIZES, BORDER_RADIUS } from "../constants/theme";
import { i18n } from "../constants/i18n";

// 估算卡片高度（用于 masonry 分列）
function estimateCardHeight(item) {
  const summaryLen = (item.summary || "").length;
  const titleLen = (item.title || "").length;
  const summaryLines = Math.max(2, Math.ceil(summaryLen / 42));
  const titleLines = Math.max(1, Math.ceil(titleLen / 22));
  const keywords = (item.keywords || []).length;
  return 70 + titleLines * 22 + summaryLines * 20 + Math.min(keywords, 3) * 24 + 50;
}

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
    darkMode, language, subTab, subjectKeywords, filters, onFilterChange, onSearch, loading, fetched, error,
    insights, bookmarks, hidden, cart, onToggleCart, onToggleBookmark, onHide, onReclassify, onAiInterpret,
    onClearCart, onGenerateReport, onKeywordClick
  } = props;

  const t = i18n[language];
  const sub = darkMode ? "#aaa" : COLORS.text.secondary;

  const displayItems = subTab === "bookmarks" ? bookmarks : insights;
  // 按当前选中的监控类型兜底过滤（与后端保持一致；归类后不再匹配的卡片会实时从视图消失）
  const activePurposes = filters.purposes || [];
  const visibleItems = displayItems
    .filter(item => !hidden.includes(item.title))
    .filter(item => {
      if (activePurposes.length === 0) return true;
      const itemPurposes = Array.isArray(item.purposes) ? item.purposes : ["competitor"];
      return itemPurposes.some(p => activePurposes.includes(p));
    });

  // --- JS masonry：按容器宽度算列数，按估算高度贪心分列（跨浏览器稳定） ---
  const gridRef = useRef(null);
  const [colCount, setColCount] = useState(3);

  useEffect(() => {
    if (!gridRef.current) return;
    const update = () => {
      const w = gridRef.current.clientWidth;
      setColCount(Math.max(1, Math.floor(w / 340)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(gridRef.current);
    return () => ro.disconnect();
  }, [visibleItems.length]);

  const columns = useMemo(() => {
    const heights = Array(colCount).fill(0);
    const cols = Array.from({ length: colCount }, () => []);
    for (const item of visibleItems) {
      const idx = heights.indexOf(Math.min(...heights));
      cols[idx].push(item);
      heights[idx] += estimateCardHeight(item) + 16;
    }
    return cols;
  }, [visibleItems, colCount]);

  return (
    <div>
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
            Selected: {cart.length} insight{cart.length > 1 ? "s" : ""} {t.cart.itemsSelected}
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
            <button onClick={onGenerateReport} style={{
              padding: "5px 14px",
              borderRadius: BORDER_RADIUS.sm,
              border: "none",
              background: COLORS.primary,
              color: "#fff",
              fontSize: FONT_SIZES.sm,
              fontWeight: 700,
              cursor: "pointer"
            }}>
              {language === "zh" ? "生成报告" : "Generate Report"}
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
          <div ref={gridRef} data-masonry-grid style={{ display: "flex", gap: 16, alignItems: "flex-start", paddingBottom: 80 }}>
            {columns.map((col, ci) => (
              <div key={ci} data-masonry-col style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
                {col.map((item, i) => {
                  const inCart = !!cart.find(c => c.title === item.title);
                  const bookmarked = !!bookmarks.find(b => b.title === item.title);
                  return (
                    <div
                      key={item.id || i}
                      onClick={() => onToggleCart(item)}
                      style={{ cursor: "pointer", width: "100%" }}
                    >
                      <InsightCard
                        item={item}
                        darkMode={darkMode}
                        language={language}
                        subjectKeywords={subjectKeywords}
                        bookmarked={bookmarked}
                        inCart={inCart}
                        onBookmark={(e) => { e?.stopPropagation(); onToggleBookmark(item); }}
                        onHide={(reason) => { onHide(item, reason); }}
                        onReclassify={(purpose) => { onReclassify(item, purpose); }}
                        onAiInterpret={(e) => { e?.stopPropagation(); onAiInterpret(item); }}
                        onKeywordClick={onKeywordClick}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}

      {!loading && subTab === "bookmarks" && bookmarks.length === 0 && (
        <div style={{ textAlign: "center", padding: "80px 20px", color: "#aaa" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#bbb" }}>{t.placeholders.noBookmarks}</div>
        </div>
      )}

      {!loading && subTab === "feed" && !fetched && (
        <div style={{ textAlign: "center", padding: "80px 20px", color: "#aaa" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#bbb" }}>{t.placeholders.noInsights}</div>
        </div>
      )}

      {!loading && subTab === "feed" && fetched && visibleItems.length === 0 && (
        <div style={{ textAlign: "center", padding: "80px 20px", color: "#aaa" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#bbb" }}>{t.competitiveIntelligence.noResults}</div>
        </div>
      )}
    </div>
  );
}
