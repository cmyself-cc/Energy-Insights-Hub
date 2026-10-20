import { describe, it, expect, vi, afterEach } from "vitest";
import { ApiError, sendError, badRequest, notFound } from "./apiError.js";

// Task 6b / 方案 A 的安全性质：故意的消息透传、未知异常泛化 + 进日志。
// 这是 sendError 的直接单元观察者（路由层只验证端到端，不钉这两个分支的区分）。

function fakeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}

describe("sendError —— 方案 A 的两分支出口", () => {
  afterEach(() => vi.restoreAllMocks());

  it("ApiError → 原样 status + message（用户该看的还能看到）", () => {
    const res = fakeRes();
    sendError(res, new ApiError("Provider not found", 404));
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Provider not found" });
  });

  it("🔴 未知异常（DB/LLM/fetch 原始错误）→ 500 泛化文案，message 不外泄", () => {
    const res = fakeRes();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const raw = new Error('no such column: owner_id -- SQLITE_ERROR: near "?": syntax error');
    sendError(res, raw);
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.error).toBe("Internal server error");
    expect(JSON.stringify(body)).not.toContain("SQLITE");
    expect(JSON.stringify(body)).not.toContain("owner_id");
    // 细节进服务端日志（排障仍在）
    expect(spy).toHaveBeenCalledWith("[api] unexpected error:", raw);
  });

  it("ImportValidationError 等 ApiError 子类同样透传", () => {
    class Sub extends ApiError {}
    const res = fakeRes();
    sendError(res, new Sub("子类消息", 400));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "子类消息" });
  });

  it("便捷工厂：badRequest=400 / notFound=404，且 expose 标记为 true", () => {
    const b = badRequest("x");
    expect(b.status).toBe(400);
    expect(b.expose).toBe(true);
    const n = notFound();
    expect(n.status).toBe(404);
    expect(n.message).toBe("not found");
  });
});
