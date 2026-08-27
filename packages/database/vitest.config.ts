import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // src/drafts and src/auth tests hit real Postgres and share one physical
    // test database with no per-test transaction isolation (see
    // src/test-support/db.ts) — running test files in parallel would let
    // them truncate/insert into that database at the same time and stomp on
    // each other. Mirrors apps/web's vitest config for the same reason.
    fileParallelism: false,
  },
});
