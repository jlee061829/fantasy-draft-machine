import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/seed/**/*.test.ts"],
  },
});
