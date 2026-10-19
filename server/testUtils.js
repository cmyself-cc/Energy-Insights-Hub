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
      // getSetCookie() 是 undici 读取多条 Set-Cookie 的正确 API：headers.get("set-cookie")
      // 只返回第一条，而按逗号手工切分会误伤值或 Expires 属性里含逗号的 cookie。
      for (const raw of res.headers.getSetCookie()) {
        const [pair, ...attrs] = raw.split(";");
        const eq = pair.indexOf("=");
        if (eq < 1) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        // 「删除这条 cookie」按 Max-Age=0（或空值）判定，而不是去匹配某个路由文件里
        // clearSessionCookie 的魔法值 "invalid"——那样一旦魔法值改了，登出用例会继续
        // 通过却什么也没断言。
        const expired = value === "" || attrs.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a));
        if (expired) delete jar[name]; else jar[name] = value;
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
