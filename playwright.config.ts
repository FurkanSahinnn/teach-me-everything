import { defineConfig, devices } from "@playwright/test";

// E2E tests live in tests/e2e/*.e2e.ts so they cannot collide with Vitest's
// default *.test.ts / *.spec.ts discovery. Playwright auto-starts `next dev`
// via webServer and reuses an already-running instance to keep iteration fast.
//
// Run: `npm run test:e2e` — boots dev server (if not already up), drives
// Chromium headless, returns within ~30-60 s on a warm cache.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // exactOptionalPropertyTypes rejects `undefined` for `workers`; conditional
  // spread keeps the field absent in dev so Playwright auto-detects, while CI
  // pins to a single worker for deterministic recording.
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? "github" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
