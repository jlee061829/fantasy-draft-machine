import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    // Integration tests share one physical Postgres test database with no
    // per-test transaction isolation (see test/db.ts) — running test files
    // in parallel would let them truncate/insert into that database at the
    // same time and stomp on each other.
    fileParallelism: false,
  },
});
