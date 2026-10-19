import db, { initDb } from "./db.js";

export async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  const { port } = server.address();
  return { port, close: () => new Promise(r => server.close(r)) };
}

export function makeCookieJar() {
  const jar = {};
  return {
    header: () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "),
    absorb: (res) => {
      const raw = res.headers.get("set-cookie");
      if (!raw) return;
      for (const c of raw.split(/,(?=\s*[A-Za-z0-9_.-]+=)/)) {
        const [pair] = c.split(";");
        const [k, v] = pair.trim().split("=");
        if (v === "" || v === "invalid") delete jar[k]; else jar[k] = v;
      }
    },
    cookies: jar
  };
}

export function insertTestUser({ unionid, role = "user", status = "active", nickname = `T-${unionid}` }) {
  initDb();
  db.prepare(
    "INSERT OR IGNORE INTO users (unionid, nickname, role, status) VALUES (?, ?, ?, ?)"
  ).run(unionid, nickname, role, status);
  return db.prepare("SELECT * FROM users WHERE unionid = ?").get(unionid);
}

export function clearAuthTables() {
  initDb();
  const tableExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?");
  for (const t of ["sessions", "pending_identities", "invite_codes", "user_views", "users"]) {
    if (tableExists.get(t)) db.prepare(`DELETE FROM ${t}`).run();
  }
}
