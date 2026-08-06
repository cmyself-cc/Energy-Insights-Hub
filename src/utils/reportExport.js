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
    if (cells[0] === "") cells.shift();
    if (cells[cells.length - 1] === "") cells.pop();
    if (cells.every(c => /^[-:]+$/.test(c))) continue; // 分隔行
    rows.push(cells.map(stripInline));
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
      sections.push({ type: "bullet", text: inlineToRuns(t.replace(/^[-*•]\s*/, "")) });
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
  const cols = Math.max(...rows.map(r => r.length), 1);
  const colWidth = 100 / cols;
  const headerRow = rows[0] || [];
  const bodyRows = rows.slice(1);
  const tableRows = [
    new TableRow({ tableHeader: true, children: headerRow.map(c => mkCell(c, true, colWidth)) }),
    ...bodyRows.map(r => new TableRow({ children: r.map(c => mkCell(c, false, colWidth)) }))
  ];
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tableRows });
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
      children.push(new Paragraph({ children: s.text, bullet: { level: 0 }, spacing: { after: 60 } }));
    } else if (s.type === "numbered") {
      children.push(new Paragraph({ children: s.text, spacing: { after: 60 } }));
    } else if (s.type === "quote") {
      children.push(new Paragraph({ children: s.text, indent: { left: 480 }, spacing: { after: 120 } }));
    } else if (s.type === "table") {
      children.push(buildTable(s.rows));
      children.push(new Paragraph({ text: "", spacing: { after: 60 } }));
    } else if (s.type === "para") {
      children.push(new Paragraph({ children: s.text, spacing: { after: 120 } }));
    } else {
      children.push(new Paragraph({ text: "" }));
    }
  }
  const doc = new Document({
    styles: { default: { document: { run: { font: "宋体", size: 24 } } } },
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

// 直接生成 PDF 文件下载（jsPDF + html2canvas，使用与网页版完全一致的 Markdown 样式，所见即所得）
export async function exportPdf(title, content) {
  const html = marked.parse(content || "");
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-12000px;top:0;width:794px;background:#fff;";
  container.innerHTML = `<style>
    html, body { margin: 0; padding: 0; }
    body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 14px; color: #222; }
    .pdf-page { width: 794px; box-sizing: border-box; padding: 96px 120px; background: #fff; }
    ${MARKDOWN_CSS}
    .pdf-page .markdown-body { padding: 0; }
  </style><div class="pdf-page"><div class="markdown-body">${html}</div></div>`;
  document.body.appendChild(container);
  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      windowWidth: container.scrollWidth,
      logging: false
    });
    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgH = (canvas.height * pageW) / canvas.width;
    let heightLeft = imgH;
    let position = 0;
    pdf.addImage(imgData, "JPEG", 0, position, pageW, imgH);
    heightLeft -= pageH;
    while (heightLeft > 0) {
      position -= pageH;
      pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, position, pageW, imgH);
      heightLeft -= pageH;
    }
    pdf.save(`${sanitizeFilename(title)}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}
