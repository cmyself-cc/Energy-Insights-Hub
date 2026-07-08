import { useState, useRef, useEffect } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS } from "../constants/theme";
import { i18n } from "../constants/i18n";

function InsightsGenerator({ items, onClose, darkMode, defaultLanguage, onGenerate }) {
  const [downloading, setDownloading] = useState(false);
  const [currentLanguage, setCurrentLanguage] = useState(defaultLanguage || "en");
  const [displayNewsletter, setDisplayNewsletter] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [activeSection, setActiveSection] = useState("overview");
  const [, setExpandedSections] = useState({});
  const contentRef = useRef(null);

  const handleLanguageChange = async (newLang) => {
    setCurrentLanguage(newLang);
    if (onGenerate) {
      await generateNewsletter(newLang);
    }
  };

  const generateNewsletter = async (lang = currentLanguage) => {
    if (!items || items.length === 0) return;
    setGenerating(true);
    try {
      const newNewsletter = await onGenerate(lang);
      setDisplayNewsletter(newNewsletter);
      setActiveSection("overview");
      setExpandedSections({});
    } catch (e) {
      console.error("Failed to generate newsletter:", e);
    }
    setGenerating(false);
  };

  useEffect(() => {
    if (items && items.length > 0 && !displayNewsletter) {
      generateNewsletter(defaultLanguage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, defaultLanguage]);

  const loadHtml2Canvas = () => new Promise((resolve, reject) => {
    if (window.html2canvas) { resolve(window.html2canvas); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    s.onload = () => resolve(window.html2canvas);
    s.onerror = reject;
    document.head.appendChild(s);
  });

  const loadJsPDF = () => new Promise((resolve, reject) => {
    if (window.jspdf) { resolve(window.jspdf); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    s.onload = () => resolve(window.jspdf);
    s.onerror = reject;
    document.head.appendChild(s);
  });

  // HTML escape to prevent XSS
  const escapeHtml = (text) => {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  };

  // Convert a block of consecutive "|" lines into an HTML table.
  // isScreen=true uses screen styling; false uses PDF styling.
  const renderTableBlock = (block, isScreen) => {
    const lines = block.trim().split("\n");
    const dataRows = lines.filter(l => !/^\|[\s:|\-]+\|$/.test(l.trim()));
    if (!dataRows.length) return "";
    const rows = dataRows.map((line, i) => {
      const cells = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(s => s.trim());
      if (i === 0) {
        return `<tr style="background:#1a6b3c;color:#fff;">${
          cells.map(c =>
            `<th style="padding:${isScreen ? "8px 12px" : "7px 10px"};text-align:left;font-weight:600;` +
            `border-right:1px solid rgba(255,255,255,0.15);font-size:${isScreen ? "13px" : "12px"};">${c}</th>`
          ).join("")
        }</tr>`;
      }
      const bg = i % 2 === 0 ? "#f7faf8" : "#ffffff";
      return `<tr style="background:${bg};">${
        cells.map(c =>
          `<td style="padding:${isScreen ? "6px 12px" : "5px 10px"};border-bottom:1px solid #e8f5ee;` +
          `border-right:1px solid #edf5f0;font-size:${isScreen ? "13px" : "12px"};">${c}</td>`
        ).join("")
      }</tr>`;
    }).join("");
    return isScreen
      ? `<div style="overflow-x:auto;margin:8px 0 12px;"><table style="width:100%;border-collapse:collapse;border:1px solid #dde8e3;box-shadow:0 1px 4px rgba(0,0,0,0.06);">${rows}</table></div>`
      : `<table style="width:100%;border-collapse:collapse;margin:8px 0;border:1px solid #dde8e3;">${rows}</table>`;
  };

  // Parse markdown → HTML.
  // Tables are extracted first (placeholder) so the \n→<br> pass can't corrupt them.
  // id attributes are added to headings so the sidebar can scroll to them.
  const toId = s => s.toLowerCase().replace(/\s+/g, "-");

  const parseMarkdown = (content) => {
    const escaped = escapeHtml(content);
    const tables = [];
    const noTables = escaped.replace(/((?:^|\n)\|[^\n]+)+/g, (block) => {
      const html = renderTableBlock(block, true);
      if (!html) return block;
      const idx = tables.length;
      tables.push(html);
      return `\n\x02T${idx}\x03\n`;
    });
    let html = noTables
      .replace(/^# (.+)$/gm,   (_, t) => `<h1 id="${toId(t)}" style="font-size:20px;font-weight:800;color:#1a6b3c;border-bottom:2px solid #e8f5ee;padding-bottom:6px;margin:2px 0 4px;">${t}</h1>`)
      .replace(/^&gt; (.+)$/gm, (_, t) => `<div style="font-size:15px;font-weight:600;color:#4a7a5a;font-style:italic;margin:0 0 14px;padding:5px 0 5px 12px;border-left:3px solid #a0c8a0;">${t}</div>`)
      .replace(/^## (.+)$/gm,  (_, t) => `<h2 id="${toId(t)}" style="font-size:15px;font-weight:700;color:#1a6b3c;margin:12px 0 4px;">${t}</h2>`)
      .replace(/^### (.+)$/gm, (_, t) => `<h3 id="${toId(t)}" style="font-size:13px;font-weight:700;color:#444;margin:8px 0 3px;">${t}</h3>`)
      .replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight:700;">$1</strong>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#1a6b3c;text-decoration:none;font-weight:500;">$1</a>')
      .replace(/^- (.+)$/gm, '<li style="margin:0;line-height:1.5;">$1</li>')
      .replace(/(<li[^>]*>.+<\/li>\n?)+/g, '<ul style="margin:4px 0;padding-left:16px;">$&</ul>')
      .replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid #eee;margin:8px 0;">')
      // Collapse 2+ consecutive blank lines → single break, then convert remaining \n
      .replace(/(\n){3,}/g, "\n\n")
      .replace(/\n\n/g, "<br>")
      .replace(/\n/g, "<br>")
      // Remove <br> injected between list items by the \n→<br> pass
      .replace(/<\/li><br><li/g, "</li><li")
      .replace(/<\/li><br><\/ul>/g, "</li></ul>");
    tables.forEach((t, i) => { html = html.replace(`\x02T${i}\x03`, t); });
    return html;
  };

  const downloadPDF = async () => {
    if (!displayNewsletter) return;
    setDownloading(true);
    let container = null;

    try {
      container = document.createElement("div");
      container.style.cssText = `
        position: fixed; left: -9999px; top: 0;
        width: 794px; padding: 0 56px 0 56px;
        background: white; box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
          "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
        font-size: 13.5px; line-height: 1.6; color: #222;
      `;

      // Build PDF inner HTML (same placeholder-based table renderer, PDF mode)
      const escaped = escapeHtml(displayNewsletter);
      const pdfTables = [];
      const noTables = escaped.replace(/((?:^|\n)\|[^\n]+)+/g, (block) => {
        const html = renderTableBlock(block, false);
        if (!html) return block;
        const idx = pdfTables.length;
        pdfTables.push(html);
        return `\n\x02P${idx}\x03\n`;
      });
      let pdfHtml = noTables
        .replace(/^# (.+)$/gm,   '<h1 style="color:#1a6b3c;font-size:21px;font-weight:800;margin:0 0 8px;border-bottom:2px solid #1a6b3c;padding-bottom:7px;">$1</h1>')
        .replace(/^&gt; (.+)$/gm, '<div style="font-size:14px;font-weight:600;color:#4a7a5a;font-style:italic;margin:0 0 14px;padding:4px 0 4px 10px;border-left:2px solid #a0c8a0;">$1</div>')
        .replace(/^## (.+)$/gm,  '<h2 style="color:#1a6b3c;font-size:16px;font-weight:700;margin:16px 0 7px;">$1</h2>')
        .replace(/^### (.+)$/gm, '<h3 style="color:#333;font-size:13px;font-weight:700;margin:12px 0 4px;">$1</h3>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" style="color:#1a6b3c;text-decoration:none;font-weight:500;">$1</a>')
        .replace(/^- (.+)$/gm, '<li style="margin:0;line-height:1.5;">$1</li>')
        .replace(/(<li[^>]*>.+<\/li>\n?)+/g, '<ul style="margin:4px 0;padding-left:18px;">$&</ul>')
        .replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid #ddd;margin:12px 0;">')
        .replace(/(\n){3,}/g, "\n\n")
        .replace(/\n\n/g, "<br>")
        .replace(/\n/g, "<br>")
        .replace(/<\/li><br><li/g, "</li><li")
        .replace(/<\/li><br><\/ul>/g, "</li></ul>");
      pdfTables.forEach((t, i) => { pdfHtml = pdfHtml.replace(`\x02P${i}\x03`, t); });

      const pdfLocale = currentLanguage === "zh" ? "zh-CN" : "en-US";
      const pdfTitle = currentLanguage === "zh" ? "能源洞察简报" : "Energy Insights Newsletter";
      const pdfDate = new Date().toLocaleDateString(pdfLocale, { year: "numeric", month: "long", day: "numeric" });
      // jsPDF built-in fonts only support ASCII — use English-only strings for pdf.text()
      const pdfHeaderTitle = "Energy Insights Newsletter";
      const pdfHeaderDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

      // Strip the leading h1 — the cover banner already carries the title
      const pdfHtmlNoH1 = pdfHtml.replace(/^(<br>\s*)*<h1[^>]*>[\s\S]*?<\/h1>(<br>\s*)*/i, "");

      container.innerHTML = `
        <div style="text-align:center;background:#1a6b3c;color:white;
             padding:26px 56px;margin:0 -56px 14px -56px;">
          <div style="font-size:22px;font-weight:800;">${pdfTitle}</div>
          <div style="font-size:12px;margin-top:5px;opacity:0.85;">${pdfDate}</div>
        </div>
        ${pdfHtmlNoH1}
      `;

      document.body.appendChild(container);
      await document.fonts.ready;
      // Give browser time to finish layout so offsetTop values are stable
      await new Promise(r => setTimeout(r, 250));

      // Collect table boundary positions as fractions of total scroll height
      const totalH = container.scrollHeight;
      const tableRanges = Array.from(container.querySelectorAll("table")).map(el => ({
        start: el.offsetTop / totalH,
        end: (el.offsetTop + el.offsetHeight) / totalH,
      }));

      const html2canvas = await loadHtml2Canvas();
      const { jsPDF } = await loadJsPDF();

      const canvas = await html2canvas(container, {
        scale: 2, useCORS: true, allowTaint: true,
        backgroundColor: "#ffffff", logging: false,
      });

      // PDF dimensions (A4)
      const pdf = new jsPDF("p", "mm", "a4");
      const PW = pdf.internal.pageSize.getWidth();   // 210 mm
      const PH = pdf.internal.pageSize.getHeight();  // 297 mm

      // 60 px header/footer ≈ 16 mm (at 96 dpi: 60/96*25.4)
      const M = 16;
      const contentH = PH - 2 * M;  // usable content height per page (mm)

      const imgW = PW;
      const imgH = canvas.height * PW / canvas.width;  // total content height in mm

      // Compute page-break positions (mm into the image), avoiding table splits
      const breaks = [0];
      let next = contentH;
      while (next < imgH) {
        let adjusted = next;
        for (const r of tableRanges) {
          const tStart = r.start * imgH;
          const tEnd   = r.end   * imgH;
          if (next > tStart && next < tEnd) {
            // Break falls inside a table — move break to just before it
            if (tStart > breaks[breaks.length - 1] + 20) {
              adjusted = tStart;
            }
            break;
          }
        }
        breaks.push(adjusted);
        next = adjusted + contentH;
      }

      const scale_px_per_mm = canvas.height / imgH;

      for (let i = 0; i < breaks.length; i++) {
        const startMM = breaks[i];
        const endMM   = i + 1 < breaks.length ? breaks[i + 1] : imgH;
        const segH_MM = endMM - startMM;

        // Slice the canvas for this page segment
        const startPx = Math.floor(startMM * scale_px_per_mm);
        const segH_Px = Math.ceil(segH_MM  * scale_px_per_mm);
        const segCanvas = document.createElement("canvas");
        segCanvas.width  = canvas.width;
        segCanvas.height = segH_Px;
        const ctx = segCanvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, segCanvas.width, segCanvas.height);
        ctx.drawImage(canvas, 0, startPx, canvas.width, segH_Px, 0, 0, canvas.width, segH_Px);
        const segImg = segCanvas.toDataURL("image/jpeg", 0.92);

        if (i > 0) pdf.addPage();

        // Content segment (placed below header margin)
        pdf.addImage(segImg, "JPEG", 0, M, imgW, segH_MM);

        // ── Header ──────────────────────────────────────────────────────────
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, PW, M, "F");
        pdf.setDrawColor(26, 107, 60);
        pdf.setLineWidth(0.4);
        pdf.line(10, M - 2, PW - 10, M - 2);
        pdf.setFontSize(8);
        pdf.setTextColor(26, 107, 60);
        pdf.text(pdfHeaderTitle, 10, M - 5);
        pdf.setTextColor(160, 160, 160);
        pdf.text(pdfHeaderDate, PW - 10, M - 5, { align: "right" });

        // ── Footer ──────────────────────────────────────────────────────────
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, PH - M, PW, M, "F");
        pdf.setDrawColor(200, 220, 210);
        pdf.setLineWidth(0.3);
        pdf.line(10, PH - M + 2, PW - 10, PH - M + 2);
        pdf.setFontSize(8);
        pdf.setTextColor(160, 160, 160);
        pdf.text("Energy Insights Hub", 10, PH - M + 7);
        pdf.text(`${i + 1} / ${breaks.length}`, PW - 10, PH - M + 7, { align: "right" });
      }

      const dateStr = new Date().toISOString().split("T")[0];
      pdf.save(`energy-insights-${dateStr}.pdf`);

    } catch (e) {
      alert("PDF generation failed: " + e.message);
      console.error("PDF generation error:", e);
    } finally {
      if (container && container.parentNode) document.body.removeChild(container);
      setDownloading(false);
    }
  };

  const tl = i18n[currentLanguage] || i18n.en;
  const htmlContent = displayNewsletter ? parseMarkdown(displayNewsletter) : null;

  // Extract sections for sidebar navigation
  const extractSections = (content) => {
    if (!content) return [];
    const sections = [];
    content.split("\n").forEach(line => {
      if (line.startsWith("## ")) {
        const title = line.slice(3);
        sections.push({ id: toId(title), title });
      }
    });
    return sections;
  };

  const sections = extractSections(displayNewsletter);

  // Scroll the content panel to a heading by its id
  const scrollTo = (id) => {
    setActiveSection(id);
    const el = document.getElementById(id);
    if (el && contentRef.current) {
      const containerRect = contentRef.current.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      contentRef.current.scrollTop += elRect.top - containerRect.top;
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.6)", zIndex: 1000,
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      overflowY: "auto", padding: "40px 20px"
    }}>
      <div style={{
        background: darkMode ? COLORS.background.cardDark : "#fff",
        borderRadius: BORDER_RADIUS["2xl"],
        width: "100%", maxWidth: 900,
        boxShadow: "0 24px 72px rgba(0,0,0,0.25)",
        display: "flex", flexDirection: "column",
        maxHeight: "90vh"
      }}>
        {/* ── Top bar ── */}
        <div style={{
          background: COLORS.primary, borderRadius: "16px 16px 0 0",
          padding: "20px 28px",
          display: "flex", justifyContent: "space-between",
          alignItems: "center", flexWrap: "wrap", gap: 12
        }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: FONT_SIZES["2xl"] }}>{tl.newsletter.title}</div>
            <div style={{ color: "rgba(255,255,255,0.8)", fontSize: FONT_SIZES.sm, marginTop: 3 }}>
              {new Date().toLocaleDateString(currentLanguage === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "long", day: "numeric" })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ color: "#fff", fontSize: FONT_SIZES.sm, fontWeight: 500 }}>{tl.newsletter.language}</div>
            <select
              value={currentLanguage}
              onChange={(e) => handleLanguageChange(e.target.value)}
              style={{
                padding: "7px 14px", borderRadius: BORDER_RADIUS.md,
                border: "1px solid rgba(255,255,255,0.3)",
                background: "rgba(255,255,255,0.1)", color: "#fff",
                fontSize: FONT_SIZES.sm, cursor: "pointer", minWidth: 110
              }}
            >
              <option value="en" style={{ color: "#333" }}>🇺🇸 English</option>
              <option value="zh" style={{ color: "#333" }}>🇨🇳 中文</option>
            </select>
            <button
              onClick={downloadPDF}
              disabled={downloading || !displayNewsletter}
              style={{
                padding: "9px 18px", borderRadius: BORDER_RADIUS.md, border: "none",
                background: downloading ? "rgba(255,255,255,0.5)" : "#fff",
                color: COLORS.primary, fontWeight: 700, fontSize: FONT_SIZES.md,
                cursor: downloading || !displayNewsletter ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", gap: 5
              }}
            >
              {downloading ? tl.buttons.generatingPDF : tl.buttons.downloadPDF}
            </button>
            <button
              onClick={onClose}
              style={{
                padding: "9px 14px", borderRadius: BORDER_RADIUS.md,
                border: "1.5px solid rgba(255,255,255,0.4)",
                background: "transparent", color: "#fff",
                fontWeight: 700, fontSize: FONT_SIZES.md, cursor: "pointer"
              }}
            >✕ {tl.buttons.close}</button>
          </div>
        </div>

        {/* ── Main body ── */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Sidebar */}
          <div style={{
            width: 220,
            borderRight: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
            background: darkMode ? COLORS.background.dark : "#f8f9fa",
            padding: "16px 14px", overflowY: "auto", flexShrink: 0
          }}>
            <div style={{
              fontSize: 12, fontWeight: 700,
              color: darkMode ? COLORS.primary : COLORS.primary,
              marginBottom: 12, paddingBottom: 8,
              borderBottom: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`
            }}>{tl.newsletter.sidebarTitle}</div>

            {sections.map((sec, idx) => (
              <button key={idx} onClick={() => scrollTo(sec.id)} style={{
                display: "block", width: "100%",
                padding: "7px 10px",
                borderRadius: BORDER_RADIUS.md, border: "none",
                background: activeSection === sec.id ? COLORS.primaryLight : "transparent",
                color: activeSection === sec.id ? COLORS.primary : darkMode ? "#e8e8e8" : "#333",
                fontSize: "13px",
                cursor: "pointer", textAlign: "left",
                fontWeight: activeSection === sec.id ? 600 : 400, marginBottom: 2
              }}>{sec.title}</button>
            ))}
          </div>

          {/* Content panel */}
          <div
            ref={contentRef}
            style={{
              flex: 1, padding: "20px 24px", overflowY: "auto",
              fontSize: "14px", lineHeight: 1.5,
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
              color: darkMode ? "#e8e8e8" : "#333"
            }}
          >
            {generating ? (
              <div style={{ textAlign: "center", padding: "80px 20px" }}>
                <div style={{ fontSize: 44, marginBottom: 20 }}>⚡</div>
                <div style={{ fontSize: FONT_SIZES.lg, fontWeight: 600, marginBottom: 12 }}>{tl.newsletter.generatingMessage}</div>
                <div style={{ fontSize: FONT_SIZES.md, color: darkMode ? "#aaa" : "#666" }}>{tl.newsletter.generatingWait}</div>
              </div>
            ) : displayNewsletter ? (
              <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
            ) : (
              <div style={{ textAlign: "center", padding: "80px 20px" }}>
                <div style={{ fontSize: 44, marginBottom: 20 }}>📝</div>
                <div style={{ fontSize: FONT_SIZES.lg, fontWeight: 600, marginBottom: 12 }}>{tl.newsletter.readyMessage}</div>
                <button
                  onClick={() => generateNewsletter()}
                  style={{
                    padding: "11px 22px", borderRadius: BORDER_RADIUS.md, border: "none",
                    background: COLORS.primary, color: "#fff",
                    fontWeight: 700, fontSize: FONT_SIZES.md, cursor: "pointer"
                  }}
                >{tl.newsletter.generateButton}</button>
              </div>
            )}
          </div>
        </div>

        {/* ── Status bar ── */}
        <div style={{
          borderTop: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
          padding: "12px 28px", display: "flex", justifyContent: "space-between", alignItems: "center",
          background: darkMode ? COLORS.background.cardDark : "#f8f9fa"
        }}>
          <div style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#aaa" : "#666" }}>
            {tl.newsletter.generatedFrom(items?.length || 0)}
          </div>
          <div style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#aaa" : "#666" }}>
            {new Date().toLocaleTimeString()}
          </div>
        </div>
      </div>
    </div>
  );
}

export default InsightsGenerator;
