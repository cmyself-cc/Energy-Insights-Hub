import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // All DB-backed suites share data/test-energy_insights.db; run files
    // sequentially so one file's DELETE/INSERT cleanup cannot interleave
    // with another file's assertions.
    fileParallelism: false,
    // 把「跑完之后 auth 表是干净的」从数据性质的巧合提升成构建级性质：teardown 只读地
    // 检查 5 张 auth 表，非空就让整轮跑失败并点名是哪张表、多少行。
    // ⚠️ vitest 4.1.10 没有 globalTeardown 配置项 —— globalSetup 文件自己导出 teardown
    // 才是真契约，细节见 server/testGlobalSetup.js 顶部注释。
    globalSetup: ["./server/testGlobalSetup.js"]
  }
});
