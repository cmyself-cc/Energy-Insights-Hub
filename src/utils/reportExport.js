import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { marked } from "marked";

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
    } else if (t.includes("|")) {
      // 简易表格：单元格用制表符分隔
      sections.push({ type: "tableRow", cells: t.split("|").map(c => c.trim()).filter(c => c && !/^[-:]+$/.test(c)) });
    } else {
      sections.push({ type: "para", text: inlineToRuns(t) });
    }
  }
  return sections;
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
      children.push(new Paragraph({ children: s.text.map(r => ({ ...r, italics: true })), indent: { left: 480 }, spacing: { after: 120 } }));
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

export function exportPdf(title, content) {
  const html = marked.parse(content || "");
  const printCss = `
    @page { size: A4; margin: 2.54cm 3.17cm; }
    body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 14px; line-height: 1.8; color: #222; max-width: 720px; margin: 0 auto; }
    h1 { font-size: 22px; margin: 18px 0 10px; }
    h2 { font-size: 18px; margin: 16px 0 8px; }
    h3 { font-size: 15px; margin: 12px 0 6px; }
    p { margin: 8px 0; text-indent: 2em; }
    ul, ol { padding-left: 2em; }
    li { margin: 4px 0; }
    a { color: #1a6b3c; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    th, td { border: 1px solid #ccc; padding: 5px 10px; font-size: 13px; text-align: left; }
    blockquote { border-left: 3px solid #1a6b3c; margin: 10px 0; padding: 4px 0 4px 14px; color: #555; }
    code { background: #f2f2f2; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
    pre { background: #f5f5f5; padding: 10px 14px; border-radius: 6px; overflow-x: auto; }
    @media print { body { margin: 0; } }
  `;
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) { alert("请允许浏览器弹出窗口以导出 PDF"); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${sanitizeFilename(title)}</title><style>${printCss}</style></head><body>${html}</body></html>`);
  w.document.close();
  w.focus();
  // 等待渲染完成后调起打印（可另存为 PDF）
  setTimeout(() => { w.print(); }, 400);
}
