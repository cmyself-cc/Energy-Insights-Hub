import db from "../db.js";

const LIMIT = 10;

function parse(row) {
  if (!row) return row;
  let filters = {};
  try { filters = JSON.parse(row.filters || "{}"); } catch { /* keep {} */ }
  return { ...row, filters };
}

export function listViews(userId) {
  return db.prepare("SELECT * FROM user_views WHERE user_id = ? ORDER BY sort_order, id").all(userId).map(parse);
}

export function getView(userId, id) {
  return parse(db.prepare("SELECT * FROM user_views WHERE id = ? AND user_id = ?").get(id, userId));
}

export function createView(userId, { name, filters }) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM user_views WHERE user_id = ?").get(userId).c;
  if (count >= LIMIT) return { error: `view limit reached (${LIMIT})` };
  const cleanName = String(name || "").trim().slice(0, 40);
  if (!cleanName) return { error: "view name required" };
  const isDefault = count === 0 ? 1 : 0;
  const info = db.prepare(
    "INSERT INTO user_views (user_id, name, filters, is_default) VALUES (?, ?, ?, ?)"
  ).run(userId, cleanName, JSON.stringify(filters || {}), isDefault);
  return { view: getView(userId, info.lastInsertRowid) };
}

export function updateView(userId, id, patch) {
  const existing = getView(userId, id);
  if (!existing) return { error: "not found" };
  const name = patch.name != null ? String(patch.name).trim().slice(0, 40) || existing.name : existing.name;
  // existing.filters 已被 parse() 换成对象；直接绑进 SQL 会让 better-sqlite3 把它当命名
  // 参数容器，位置参数不足而抛 RangeError。必须重新序列化回 JSON 文本。
  const filters = patch.filters != null ? JSON.stringify(patch.filters) : JSON.stringify(existing.filters);
  db.prepare("UPDATE user_views SET name=?, filters=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?")
    .run(name, filters, id, userId);
  return { view: getView(userId, id) };
}

export function deleteView(userId, id) {
  return db.prepare("DELETE FROM user_views WHERE id=? AND user_id=?").run(id, userId).changes > 0;
}

export function setDefault(userId, id) {
  if (!getView(userId, id)) return false;
  const tx = db.transaction(() => {
    db.prepare("UPDATE user_views SET is_default=0 WHERE user_id=?").run(userId);
    db.prepare("UPDATE user_views SET is_default=1 WHERE id=? AND user_id=?").run(id, userId);
  });
  tx();
  return true;
}

// 邀请码开通时落首个视角（有 default_view 才建）
export function applyInviteDefaults(userId, inviteRow) {
  try {
    if (!inviteRow?.default_view) return;
    let dv;
    // 配置不合法是正常降级路径（邀请码没填 default_view / 填坏了），静默返回，
    // 不刷错误日志——下面的外层 catch 只管真正的异常（如外键失败）。
    try { dv = JSON.parse(inviteRow.default_view); } catch { return; }
    // 数组也是 typeof "object"，但不是一个视角配置；漏掉它会静默建出垃圾视角。
    if (!dv || typeof dv !== "object" || Array.isArray(dv)) return;
    // createView 失败（如已达 10 个上限）时必须立刻返回：否则下面的 setDefault 会在
    // 什么都没建成的情况下，把该用户的 default 静默搬到 id 最小的既有视角上。
    const created = createView(userId, { name: dv.name || "初始视角", filters: dv.filters || {} });
    if (created.error) return;
    const first = db.prepare("SELECT id FROM user_views WHERE user_id=? ORDER BY id LIMIT 1").get(userId);
    if (first) setDefault(userId, first.id);
  } catch (e) {
    // 调用方（auth.js 注册流程）在事务外、try/catch 外调本函数。抛出会让失败形态变成
    // 「用户已建 + 邀请码已计数 + 500」，所以这里吞掉异常，只留日志。
    console.error("[views] applyInviteDefaults failed:", e?.message || e);
  }
}
