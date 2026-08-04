import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // All DB-backed suites share data/test-energy_insights.db; run files
    // sequentially so one file's DELETE/INSERT cleanup cannot interleave
    // with another file's assertions.
    fileParallelism: false
  }
});
