import { resolveSession } from "./sessions.js";

export const SESSION_COOKIE = "eih_session";

export function parseCookieValue(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function requireAuth(req, res, next) {
  const hit = resolveSession(parseCookieValue(req, SESSION_COOKIE));
  if (!hit) return res.status(401).json({ error: "unauthorized" });
  req.user = hit.user;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "forbidden" });
  next();
}

export function setSessionCookie(res, token, production) {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=604800"
  ];
  if (production) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

export function clearSessionCookie(res, production) {
  const attrs = [`${SESSION_COOKIE}=invalid`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (production) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}
