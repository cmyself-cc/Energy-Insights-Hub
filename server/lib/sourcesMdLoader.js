import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_MD_PATH = process.env.SOURCES_MD_PATH || path.join(__dirname, "..", "..", "sources.md");

export function parseMarkdown(md) {
  const sources = [];
  const lines = md.split(/\r?\n/);
  let currentType = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("## ")) {
      if (line.includes("官方网站") || line.includes("网站")) {
        currentType = "website";
      } else if (line.includes("微信") || line.includes("公众号")) {
        currentType = "wechat";
      } else {
        currentType = null;
      }
      continue;
    }

    if (!currentType || !line.startsWith("- ")) continue;

    const content = line.slice(2).trim();

    if (currentType === "website") {
      const match = content.match(/^(https?:\/\/\S+)\s*[-–—]\s*(.+)$/);
      if (match) {
        sources.push({
          name: match[2].trim(),
          url: match[1].trim(),
          type: "website",
          active: 1,
          config: JSON.stringify({})
        });
      }
    } else if (currentType === "wechat") {
      const name = content.replace(/^[-\s]+/, "").trim();
      if (name) {
        sources.push({
          name,
          url: "",
          type: "wechat",
          active: 1,
          config: JSON.stringify({ accountName: name })
        });
      }
    }
  }

  return sources;
}

export function loadSourcesFromMd() {
  if (!fs.existsSync(SOURCES_MD_PATH)) {
    console.warn(`[sources-md] File not found: ${SOURCES_MD_PATH}`);
    return [];
  }
  const md = fs.readFileSync(SOURCES_MD_PATH, "utf-8");
  return parseMarkdown(md);
}
