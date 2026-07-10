import db from "../db.js";

export const SUPPORTED_IMPORT_TYPES = ["wechat", "website"];

export class ImportValidationError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

export function normalizeImportType(source) {
  if (!source || !SUPPORTED_IMPORT_TYPES.includes(source.type)) {
    throw new ImportValidationError(
      `Unsupported source type: ${source ? source.type : "undefined"}`
    );
  }
  return source;
}

function sourceUrl(source) {
  if (source.url) return source.url;
  if (source.type === "wechat" && source.identifier) {
    return `https://mp.weixin.qq.com/s/${source.identifier}`;
  }
  return "";
}

export function importSources(sources, mode = "append") {
  if (mode === "replace") {
    // Delete previously imported sources by matching name, then clear the import log.
    db.prepare("DELETE FROM sources WHERE name IN (SELECT name FROM source_imports)").run();
    db.prepare("DELETE FROM source_imports").run();
  }

  const existing = new Set(db.prepare("SELECT name FROM sources").all().map(r => r.name));
  const insertSource = db.prepare(
    "INSERT INTO sources (name, url, type, active, config) VALUES (?, ?, ?, 1, ?)"
  );
  const insertImport = db.prepare(
    "INSERT INTO source_imports (name, identifier, type, url, active, config) VALUES (?, ?, ?, ?, 1, ?)"
  );

  let imported = 0;
  let skipped = 0;

  const tx = db.transaction((rows) => {
    for (const s of rows) {
      if (!s.name || !s.type || existing.has(s.name)) {
        skipped++;
        continue;
      }
      const url = sourceUrl(s);
      const config = s.config || null;
      insertSource.run(s.name, url, s.type, config);
      insertImport.run(s.name, s.identifier || null, s.type, url, config);
      existing.add(s.name);
      imported++;
    }
  });

  tx(sources);
  return { imported, skipped };
}
