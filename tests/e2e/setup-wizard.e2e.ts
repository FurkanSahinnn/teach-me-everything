import { test, expect } from "@playwright/test";

// Setup Wizard happy-path: we walk the 4-step flow without making any real
// LLM call. The "Test connection" button is intentionally NOT clicked — that
// would require network access to a real provider; saving an unverified key
// is a supported user path.
//
// We accept that some assertions are loose (matching by visible-text patterns
// instead of role/label) because the wizard copy is bilingual (TR/EN) and the
// effective locale depends on persisted prefs. These tests mostly verify
// "URL transitions land where expected" — Phase 3.5 follow-up will tighten
// selectors with data-testid attributes and add the PDF → Q&A round-trip
// on top of mocked /api/ai/chat + /api/ai/embed routes.

test.describe("setup wizard — happy path", () => {
  test("step 1 (welcome) loads at /setup", async ({ page }) => {
    const response = await page.goto("/setup");
    expect(response?.status() ?? 0).toBeLessThan(500);
    await page.waitForLoadState("networkidle");
    // The wizard is the visible content on /setup — body should not be
    // empty and we should see at least one navigable element (next button).
    const buttonCount = await page.locator("button, a[role='button']").count();
    expect(buttonCount).toBeGreaterThan(0);
  });

  test("step 2 (master password + key) is reachable", async ({ page }) => {
    const response = await page.goto("/setup/2");
    expect(response?.status() ?? 0).toBeLessThan(500);
    await page.waitForLoadState("networkidle");
    // Master password input must exist — the wizard renders a password
    // field labelled in TR or EN; we match by input[type="password"].
    const passwordCount = await page.locator("input[type='password']").count();
    expect(passwordCount).toBeGreaterThanOrEqual(1);
  });

  test("step 2 surfaces the quick-start preset chooser (5 tiles)", async ({
    page,
  }) => {
    await page.goto("/setup/2");
    await page.waitForLoadState("networkidle");
    // PresetChooser renders a radiogroup with one role=radio per quick-start
    // preset (currently 5: Gemini / Ollama / Groq / Anthropic / OpenRouter).
    // The radiogroup is *inside* the wizard's "Hızlı başlangıç" card so it
    // doesn't collide with the manual provider rows below.
    const group = page.getByRole("radiogroup").first();
    await expect(group).toBeVisible();
    const tiles = group.getByRole("radio");
    await expect(tiles).toHaveCount(5);
  });

  test("step 3 (examples) is reachable", async ({ page }) => {
    const response = await page.goto("/setup/3");
    expect(response?.status() ?? 0).toBeLessThan(500);
    await page.waitForLoadState("networkidle");
    expect(await page.locator("body").innerText()).not.toBe("");
  });

  test("step 4 (done) is reachable and offers entry actions", async ({
    page,
  }) => {
    const response = await page.goto("/setup/4");
    expect(response?.status() ?? 0).toBeLessThan(500);
    await page.waitForLoadState("networkidle");
    // DoneStep promises 3 quick-actions; a button or link count >= 2 is a
    // reasonable lower bound (covers the case where one action degrades to
    // disabled state when prereqs are missing).
    const ctaCount = await page
      .locator("a[href], button")
      .filter({ hasText: /.+/ })
      .count();
    expect(ctaCount).toBeGreaterThanOrEqual(2);
  });
});
