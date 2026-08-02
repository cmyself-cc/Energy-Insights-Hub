import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
// Test isolation: when running under vitest (NODE_ENV=test), use a dedicated
// test database so test cleanup statements (DELETE FROM ...) can NEVER touch
// the real production database at data/energy_insights.db.
const IS_TEST = process.env.NODE_ENV === "test";
const DB_PATH = process.env.DB_PATH || (
  IS_TEST
    ? path.join(DATA_DIR, "test-energy_insights.db")
    : path.join(DATA_DIR, "energy_insights.db")
);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

export function initDb() {
  const migrationsDir = path.join(__dirname, "migrations");
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql"))
    .sort();

  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    filename TEXT PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);

  const isApplied = db.prepare("SELECT 1 FROM _migrations WHERE filename = ?");
  const record = db.prepare("INSERT INTO _migrations (filename) VALUES (?)");

  for (const file of files) {
    if (isApplied.get(file)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    const apply = db.transaction(() => {
      db.exec(sql);
      record.run(file);
    });
    apply();
  }
}

export default db;
