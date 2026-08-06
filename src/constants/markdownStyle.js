// 网页版报告的 Markdown 渲染样式（所见即所得：网页 / PDF 导出共用同一套）
// 注意：不包含 font-size（由使用方设置），其余完全与报告页一致。
export const MARKDOWN_CSS = `
.markdown-body { overflow-wrap: break-word; }
.markdown-body h1 { font-size: 20px; font-weight: 800; color: #1a6b3c; margin: 18px 0 10px; padding-bottom: 6px; border-bottom: 1px solid rgba(26,107,60,0.25); }
.markdown-body h2 { font-size: 16px; font-weight: 700; color: #1a6b3c; margin: 16px 0 8px; }
.markdown-body h3 { font-size: 14px; font-weight: 700; margin: 12px 0 6px; }
.markdown-body p { margin: 8px 0; line-height: 1.8; text-indent: 2em; }
.markdown-body ul { margin: 8px 0; padding-left: 2em; }
.markdown-body ol { margin: 8px 0; padding-left: 0; list-style-position: inside; }
.markdown-body li { margin: 4px 0; line-height: 1.8; }
.markdown-body li p { text-indent: 0; }
.markdown-body a { color: #1a6b3c; text-decoration: none; font-weight: 500; }
.markdown-body strong { font-weight: 700; }
.markdown-body blockquote { border-left: 3px solid #1a6b3c; margin: 10px 0; padding: 4px 0 4px 14px; color: #666; }
.markdown-body blockquote p { text-indent: 0; }
.markdown-body table { border-collapse: collapse; margin: 10px 0; width: 100%; }
.markdown-body th, .markdown-body td { border: 1px solid #ddd; padding: 6px 12px; font-size: 13px; text-align: left; }
.markdown-body th { background: rgba(26,107,60,0.08); font-weight: 600; }
.markdown-body code { background: rgba(0,0,0,0.06); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
.markdown-body pre { background: rgba(0,0,0,0.05); padding: 10px 14px; border-radius: 6px; overflow-x: auto; }
.markdown-body pre code { background: none; padding: 0; }
.markdown-body hr { border: none; border-top: 1px solid rgba(0,0,0,0.12); margin: 16px 0; }
`;
