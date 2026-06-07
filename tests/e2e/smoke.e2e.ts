import { test, expect } from "@playwright/test";

// Smoke layer: verifies the dev server boots, App Router serves the entry
// surfaces, and there are no UNCAUGHT exceptions reaching the page. We
// distinguish carefully:
//   - `pageerror` = an exception that escaped every error boundary; this
//     fails the suite because the page is effectively broken for the user.
//   - `console.error` = anything written to console.error, including errors
//     that React error boundaries already caught + reported. We DO NOT fail
//     on these (would be noisy + dev-only) but expose the count for triage.
//
// Each route is fetched with a fresh storage context so first-visit behaviour
// (Setup redirect, vault locked banner, fresh-IndexedDB Dexie open) is
// exercised honestly.

test.describe("smoke — public routes load without uncaught exceptions", () => {
  for (const route of ["/", "/dashboard", "/setup", "/settings"]) {
    test(`${route} renders`, async ({ page }) => {
      const uncaught: string[] = [];
      const consoleErrors: string[] = [];
      page.on("pageerror", (err) => uncaught.push(err.message));
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });

      const response = await page.goto(route);
      expect(response?.status(), `HTTP status for ${route}`).toBeLessThan(500);
      await page.waitForLoadState("networkidle");

      // <body> must be non-empty; an empty body almost always means a runtime
      // crash inside a server component or client boundary.
      const bodyText = await page.locator("body").innerText();
      expect(bodyText.length, `body text for ${route}`).toBeGreaterThan(0);

      // Hard gate: NO uncaught exceptions. Soft signal: log console errors
      // for the report but do not fail (catches dev-only noise + framework
      // warnings + boundary-caught Dexie startup churn).
      if (consoleErrors.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[${route}] ${consoleErrors.length} console.error events:`,
          consoleErrors,
        );
      }
      expect(uncaught, `uncaught exceptions on ${route}`).toEqual([]);
    });
  }
});
