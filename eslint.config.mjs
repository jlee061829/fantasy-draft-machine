// Phase 6.4 — minimal, correctness-oriented lint baseline.
//
// Next.js 16 removed `next lint`, and `next build` no longer lints, so this is
// the only place React/Next rules (notably react-hooks) are checked. Rules are
// the recommended presets as shipped — no formatting/stylistic additions.
// Linting is deliberately NOT type-aware (no parserOptions.project), so it
// needs no build output and runs before the expensive CI steps.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

const WEB_FILES = ["apps/web/**/*.{js,jsx,mjs,ts,tsx,mts,cts}"];
const NON_WEB_FILES = [
  "apps/socket-server/**/*.{ts,mts,cts}",
  "packages/database/**/*.{ts,mts,cts}",
  "packages/shared/**/*.{ts,mts,cts}",
];

// eslint-config-next's objects target every file (or have no `files` at all),
// and its ignore-only objects use paths relative to the config location, which
// would not match apps/web/.next from the repo root. Scope each rule-bearing
// object to apps/web and drop the ignore-only ones in favor of the explicit
// global ignores below.
const scopeTo = (files, configs) =>
  configs
    .filter((config) => !(config.ignores && Object.keys(config).length === 1))
    .map((config) => ({ ...config, files }));

export default defineConfig([
  globalIgnores([
    "**/dist/**",
    "apps/web/.next/**",
    "apps/web/next-env.d.ts",
    "packages/database/src/generated/**",
  ]),

  ...scopeTo(WEB_FILES, [...nextVitals, ...nextTs]),
  {
    files: WEB_FILES,
    settings: { next: { rootDir: "apps/web/" } },
  },

  ...scopeTo(NON_WEB_FILES, tseslint.configs.recommended),
]);
