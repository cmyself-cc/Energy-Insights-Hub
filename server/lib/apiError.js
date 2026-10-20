// Task 6b / 方案 A：结构化错误出口（2026-10-21 产品负责人拍板）。
//
// 背景：全仓 78 处 `res.status(...).json({ error: e.message })` 把数据库/LLM 的
// 原始内部报错直接回给任何登录用户（信息泄漏 + 英文技术话）。方案 A 的两件套：
//   · 故意的用户可见消息（如「邀请码无效」「不能停用最后一个管理员」）→ throw ApiError，
//     原样带 status + message 出去；
//   · 未知异常（better-sqlite3 / fetch / JSON.parse 等）→ sendError 统一回
//     500「服务器内部错误」+ 细节 console.error 进服务端日志（前端 toast 只读 error.error）。
//
// 判定口径（沿用 Task 6 账本）：try 块里抛出的 Error 文案是「写给人看的产品语言」
// 就是故意；try 块里可能冒出原始异常（DB/网络/解析）就是泄漏点。

export class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.expose = true;   // 消息可以安全地给前端看
  }
}

// 统一出口：已知 ApiError → 其 status+message；未知 → 500 泛化 + 服务端日志。
// res 形态保持 { error: "..." } 信封（Global Constraint），前端 backendApi.js:13-14
// 会把 error.error 直接变成 toast 文案 —— 所以这里出去的字样必须是人话。
export function sendError(res, e) {
  if (e instanceof ApiError) {
    return res.status(e.status).json({ error: e.message });
  }
  console.error("[api] unexpected error:", e);
  return res.status(500).json({ error: "Internal server error" });
}

// 便捷工厂：throw badRequest("...") 比 new ApiError("...", 400) 省几个字。
export const badRequest = (msg) => new ApiError(msg, 400);
export const notFound = (msg = "not found") => new ApiError(msg, 404);
