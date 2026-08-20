import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType } from "docx";
import { marked } from "marked";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { MARKDOWN_CSS } from "../constants/markdownStyle.js";

const GREEN = "1A6B3C";          // 网页主色
const HEADER_BG = "E9F3EE";      // 表头浅绿底（≈ rgba(26,107,60,0.08)）
const BORDER_COLOR = "DDDDDD";   // 表格边框

export function sanitizeFilename(name) {
  return String(name || "report").replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 80) || "report";
}

function stripInline(text) {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1（$2）");
}

function inlineToRuns(text, opts = {}) {
  const runs = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let m;
  const push = (t, extra = {}) => {
    if (!t) return;
    runs.push(new TextRun({ text: t, ...(opts.color ? { color: opts.color } : {}), ...extra }));
  };
  while ((m = re.exec(text))) {
    if (m.index > last) push(text.slice(last, m.index));
    if (m[1] !== undefined) push(m[1], { bold: true });
    else if (m[2] !== undefined && m[3] !== undefined) push(`${m[2]}（${m[3]}）`, { underline: {} });
    last = m.index + m[0].length;
  }
  if (last < text.length) push(text.slice(last));
  if (runs.length === 0) push(text);
  return runs;
}

function isSepRow(line) {
  const t = String(line || "").trim();
  if (!t.includes("|")) return false;
  let cells = t.split("|").map(c => c.trim());
  if (cells[0] === "") cells.shift();
  if (cells[cells.length - 1] === "") cells.pop();
  return cells.length >= 2 && cells.every(c => /^[-:]+$/.test(c));
}

function hasCells(line) {
  const t = String(line || "").trim();
  if (!t.includes("|")) return false;
  let cells = t.split("|").map(c => c.trim());
  if (cells[0] === "") cells.shift();
  if (cells[cells.length - 1] === "") cells.pop();
  return cells.filter(c => c && !/^[-:]+$/.test(c)).length >= 2;
}

function parseTableBlock(lines) {
  const rows = [];
  for (const raw of lines) {
    let cells = raw.trim().split("|").map(c => c.trim());
    // 移除首尾空单元格
    if (cells[0] === "") cells.shift();
    if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
    // 跳过分隔行
    if (cells.every(c => /^[-:]+$/.test(c))) continue;
    // 只添加有内容的行
    if (cells.length > 0 && cells.some(c => c.trim())) {
      rows.push(cells.map(stripInline));
    }
  }
  return rows;
}

// 将 Markdown 解析为 docx 段落/表格结构（标题/列表/引用/粗体/链接/表格）
export function markdownToDocxSections(md) {
  const sections = [];
  const lines = String(md || "").split("\n");
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i].replace(/\r$/, "");
    const t = raw.trim();
    if (!t) { sections.push({ type: "empty" }); i++; continue; }
    if (/^#{1,3}\s/.test(t)) {
      const level = t.match(/^#+/)[0].length;
      sections.push({ type: "heading", level, text: inlineToRuns(t.replace(/^#+\s*/, ""), { color: GREEN }) });
      i++;
      continue;
    }
    // 表格块：含 | 且（下一行是分隔行 或 已连续出现表格行）
    if (hasCells(raw)) {
      const block = [raw];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j].replace(/\r$/, "");
        if (hasCells(next) || isSepRow(next)) { block.push(next); j++; }
        else break;
      }
      const rows = parseTableBlock(block);
      const sawSep = isSepRow(lines[i + 1] || "");
      if (rows.length >= 2 || (rows.length === 1 && sawSep)) {
        sections.push({ type: "table", rows });
        i = j;
        continue;
      }
      // 不构成表格 → 按普通段落处理
      sections.push({ type: "para", text: inlineToRuns(t) });
      i++;
      continue;
    }
    if (/^[-*•]\s+/.test(t)) {
      sections.push({ type: "bullet", text: inlineToRuns(t.replace(/^[-*•]\s+/, "")) });
      i++;
    } else if (/^\d+[.、)]\s+/.test(t)) {
      sections.push({ type: "numbered", text: inlineToRuns(t) });
      i++;
    } else if (/^>\s?/.test(t)) {
      sections.push({ type: "quote", text: inlineToRuns(t.replace(/^>\s?/, "")) });
      i++;
    } else {
      sections.push({ type: "para", text: inlineToRuns(t) });
      i++;
    }
  }
  return sections;
}

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR };

function mkCell(text, isHeader, colWidth) {
  return new TableCell({
    width: { size: colWidth, type: WidthType.PERCENTAGE },
    shading: isHeader ? { type: ShadingType.CLEAR, fill: HEADER_BG } : undefined,
    borders: { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      children: [new TextRun({ text, bold: isHeader, color: isHeader ? GREEN : undefined })],
      spacing: { after: 0 }
    })]
  });
}

function buildTable(rows) {
  if (!rows || rows.length === 0) return null;
  
  const cols = Math.max(...rows.map(r => r.length), 1);
  const colWidth = Math.floor(100 / cols);
  const headerRow = rows[0] || [];
  const bodyRows = rows.slice(1);
  
  const tableRows = [
    new TableRow({ 
      tableHeader: true, 
      children: headerRow.map(c => mkCell(c, true, colWidth)) 
    }),
    ...bodyRows.map(r => new TableRow({ 
      children: r.map(c => mkCell(c, false, colWidth)) 
    }))
  ];
  
  return new Table({ 
    width: { size: 100, type: WidthType.PERCENTAGE }, 
    rows: tableRows 
  });
}

export async function buildDocx(markdown) {
  const children = [];
  for (const s of markdownToDocxSections(markdown)) {
    if (s.type === "heading") {
      children.push(new Paragraph({
        children: s.text,
        heading: s.level === 1 ? HeadingLevel.HEADING_1 : s.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        spacing: { before: 240, after: 120 }
      }));
    } else if (s.type === "bullet") {
      children.push(new Paragraph({ 
        children: s.text, 
        bullet: { level: 0 }, 
        spacing: { before: 60, after: 60 } 
      }));
    } else if (s.type === "numbered") {
      children.push(new Paragraph({ 
        children: s.text, 
        spacing: { before: 60, after: 60 } 
      }));
    } else if (s.type === "quote") {
      children.push(new Paragraph({ 
        children: s.text, 
        indent: { left: 480 }, 
        spacing: { before: 120, after: 120 } 
      }));
    } else if (s.type === "table") {
      const table = buildTable(s.rows);
      if (table) {
        children.push(table);
        children.push(new Paragraph({ text: "", spacing: { after: 60 } }));
      }
    } else if (s.type === "para") {
      children.push(new Paragraph({ 
        children: s.text, 
        spacing: { before: 60, after: 120 } 
      }));
    } else {
      children.push(new Paragraph({ text: "" }));
    }
  }
  const yahei = { ascii: "微软雅黑", eastAsia: "微软雅黑", hAnsi: "微软雅黑" };
  const doc = new Document({
    styles: {
      default: { document: { run: { font: yahei, size: 24 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: yahei, size: 32, bold: true, color: GREEN } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: yahei, size: 28, bold: true, color: GREEN } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: yahei, size: 26, bold: true, color: GREEN } }
      ]
    },
    sections: [{ children }]
  });
  return Packer.toBlob(doc);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportMarkdown(title, content) {
  downloadBlob(new Blob([content], { type: "text/markdown;charset=utf-8" }), `${sanitizeFilename(title)}.md`);
}

export async function exportDocx(title, content) {
  const blob = await buildDocx(content);
  downloadBlob(blob, `${sanitizeFilename(title)}.docx`);
}

// A4 @96dpi：794 × 1123px；Word 标准页边距 上/下 96px、左/右 120px
const A4_W = 794;
const A4_H = 1123;
const PAGE_PADDING_TOP = 96;
const PAGE_PADDING_BOTTOM = 96;
const PAGE_CONTENT_H = A4_H - PAGE_PADDING_TOP - PAGE_PADDING_BOTTOM; // 931，留 26px 安全余量

const PDF_PAGE_CSS = `
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 14px; color: #222; }
  .pdf-page { width: ${A4_W}px; height: ${A4_H}px; box-sizing: border-box; padding: ${PAGE_PADDING_TOP}px 120px ${PAGE_PADDING_BOTTOM}px; background: #fff; overflow: hidden; }
  ${MARKDOWN_CSS}
  .pdf-page .markdown-body { padding: 0; }
  .pdf-page .markdown-body > p:first-child { font-size: 14px; font-weight: normal; color: #222; text-align: left; text-indent: 2em; margin: 8px 0; line-height: 1.8; }
  .pdf-page table { break-inside: avoid; page-break-inside: avoid; }
  .pdf-page tr { break-inside: avoid; page-break-inside: avoid; }
  .pdf-page h1, .pdf-page h2, .pdf-page h3 { break-after: avoid; page-break-after: avoid; }
`;

function createPdfPage() {
  const d = document.createElement("div");
  d.className = "pdf-page";
  const inner = document.createElement("div");
  inner.className = "markdown-body";
  d.appendChild(inner);
  return d;
}

// 直接生成 PDF 文件下载：先按 A4 内容高度逐块分页（不切割行/表格），再逐页渲染
export async function exportPdf(title, content) {
  // 配置 marked 选项
  marked.setOptions({
    breaks: false,
    gfm: true,
    headerIds: false,
    mangle: false
  });
  
  const html = marked.parse(content || "");
  const measure = document.createElement("div");
  measure.style.cssText = `position:absolute;left:-9999px;top:0;width:${A4_W}px;background:#fff;`;
  measure.innerHTML = `<style>${PDF_PAGE_CSS}</style>`;
  document.body.appendChild(measure);
  try {
    // 1) 全部内容放入测量页，读取顶层块高度
    const fullPage = createPdfPage();
    fullPage.querySelector(".markdown-body").innerHTML = html;
    measure.appendChild(fullPage);
    const blocks = Array.from(fullPage.querySelector(".markdown-body").children);
    const contentHeight = PAGE_CONTENT_H - 26; // 安全余量

    // 2) 按块分页：块放不下当前页则换页（单块超页时允许超出一页）
    const pages = [];
    let page = null;
    let used = 0;
    const newPage = () => {
      const p = createPdfPage();
      measure.appendChild(p); // 必须挂进 DOM，html2canvas 才能克隆到
      pages.push(p);
      return p;
    };
    for (const block of blocks) {
      const h = block.getBoundingClientRect().height;
      if (!page) { page = newPage(); used = 0; }
      if (used > 0 && used + h > contentHeight) {
        page = newPage();
        used = 0;
      }
      page.querySelector(".markdown-body").appendChild(block.cloneNode(true));
      used += h;
    }
    if (!page) newPage();
    measure.removeChild(fullPage);

    // 3) 逐页渲染进 PDF
    const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    for (let idx = 0; idx < pages.length; idx++) {
      const canvas = await html2canvas(pages[idx], {
        scale: 2,
        backgroundColor: "#ffffff",
        logging: false
      });
      if (idx > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageW, pageH);
    }
    pdf.save(`${sanitizeFilename(title)}.pdf`);
  } finally {
    document.body.removeChild(measure);
  }
}
