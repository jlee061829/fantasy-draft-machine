import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Real-Postgres tests share one physical fantasy_draft_test database
    // with no per-test transaction isolation — mirrors apps/web and
    // packages/database's vitest config for the same reason.
    fileParallelism: false,
  },
});
