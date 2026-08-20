import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig.json sets "jsx": "preserve" because Next's own SWC compiler
  // does the JSX transform for the app itself. Vite (oxc transform, this
  // Vite version's default) reads that same tsconfig and would otherwise
  // leave JSX untouched too, which it can't parse as JS on its own —
  // override it here so importing a .tsx page module in a test file works
  // without pulling in a React-rendering plugin/dependency.
  oxc: {
    jsx: { runtime: "automatic" },
  },
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
