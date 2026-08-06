import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { marked } from "marked";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

export function sanitizeFilename(name) {
  return String(name || "report").replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 80) || "report";
}

// 将 Markdown 文本解析为 docx 段落结构（支持标题/列表/引用/粗体/链接）
export function markdownToDocxSections(md) {
  const sections = [];
  for (const raw of String(md || "").split("\n")) {
    const line = raw.replace(/\r$/, "");
    const t = line.trim();
    if (!t) { sections.push({ type: "empty" }); continue; }
    if (/^#{1,3}\s/.test(t)) {
      const level = t.match(/^#+/)[0].length;
      sections.push({ type: "heading", level, text: inlineToRuns(t.replace(/^#+\s*/, "")) });
    } else if (/^[-*•]\s+/.test(t)) {
      sections.push({ type: "bullet", text: inlineToRuns(t.replace(/^[-*•]\s*/, "")) });
    } else if (/^\d+[.、)]\s+/.test(t)) {
      // 编号列表：保留编号，作为普通段落
      sections.push({ type: "numbered", text: inlineToRuns(t) });
    } else if (/^>\s?/.test(t)) {
      sections.push({ type: "quote", text: inlineToRuns(t.replace(/^>\s?/, "")) });
    } else if (/^\|.*\|/.test(t)) {
      // Markdown 表格行（以 | 开头且含 |）：单元格用制表符分隔
      sections.push({ type: "tableRow", cells: t.split("|").map(c => c.trim()).filter(c => c && !/^[-:]+$/.test(c)).map(stripInline) });
    } else {
      sections.push({ type: "para", text: inlineToRuns(t) });
    }
  }
  return sections;
}

function stripInline(text) {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1（$2）");
}

function inlineToRuns(text) {
  const runs = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push(new TextRun({ text: text.slice(last, m.index) }));
    if (m[1] !== undefined) {
      runs.push(new TextRun({ text: m[1], bold: true }));
    } else if (m[2] !== undefined && m[3] !== undefined) {
      runs.push(new TextRun({ text: `${m[2]}（${m[3]}）`, underline: {} }));
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push(new TextRun({ text: text.slice(last) }));
  return runs.length ? runs : [new TextRun({ text })];
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
    } else if (s.type === "tableRow" && s.cells.length > 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: s.cells.join("\t"), size: 21 })] , spacing: { after: 60 } }));
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

const PDF_PAGE_CSS = `
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 14px; line-height: 1.8; color: #222; }
  .pdf-page { width: 794px; box-sizing: border-box; padding: 96px 120px; background: #fff; }
  .pdf-page h1 { font-size: 22px; margin: 18px 0 10px; }
  .pdf-page h2 { font-size: 18px; margin: 16px 0 8px; }
  .pdf-page h3 { font-size: 15px; margin: 12px 0 6px; }
  .pdf-page p { margin: 8px 0; text-indent: 2em; }
  .pdf-page ul, .pdf-page ol { padding-left: 2em; }
  .pdf-page li { margin: 4px 0; }
  .pdf-page a { color: #1a6b3c; }
  .pdf-page table { border-collapse: collapse; width: 100%; margin: 10px 0; }
  .pdf-page th, .pdf-page td { border: 1px solid #ccc; padding: 5px 10px; font-size: 13px; text-align: left; }
  .pdf-page blockquote { border-left: 3px solid #1a6b3c; margin: 10px 0; padding: 4px 0 4px 14px; color: #555; }
  .pdf-page code { background: #f2f2f2; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  .pdf-page pre { background: #f5f5f5; padding: 10px 14px; border-radius: 6px; overflow-x: auto; }
`;

// 直接生成 PDF 文件下载（jsPDF + html2canvas 渲染，中文排版无损，不弹打印窗口）
export async function exportPdf(title, content) {
  const html = marked.parse(content || "");
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-12000px;top:0;width:794px;background:#fff;";
  container.innerHTML = `<style>${PDF_PAGE_CSS}</style><div class="pdf-page">${html}</div>`;
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
