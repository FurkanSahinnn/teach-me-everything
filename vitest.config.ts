import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(here, "src"),
    },
  },
  test: {
    environment: "node",
    // Vitest discovers ALL *.test.ts / *.spec.ts by default; Playwright lives
    // in tests/e2e/*.e2e.ts and uses an incompatible runner — exclude here
    // defensively so `npm run test:run` stays scoped to unit/dom suites even
    // if someone later names an E2E file `*.test.ts`.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "tests/e2e/**",
    ],
    environmentMatchGlobs: [
      ["src/lib/db/**/*.test.ts", "jsdom"],
      ["src/lib/crypto/**/*.test.ts", "jsdom"],
      ["src/lib/ai/tool-handlers.test.ts", "jsdom"],
      ["src/components/**/*.test.tsx", "jsdom"],
      ["**/*.dom.test.ts", "jsdom"],
    ],
    setupFiles: ["./vitest.setup.ts"],
    globals: false,
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/app/**",
        "src/components/**",
        "src/i18n/**",
        "src/stores/**",
        "src/hooks/**",
        "src/lib/fixtures/**",
        "src/lib/db/hooks.ts",
        "src/lib/db/seed.ts",
        "src/**/*.d.ts",
      ],
    },
  },
});
