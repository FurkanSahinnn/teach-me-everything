import { test, expect } from "@playwright/test";
import { installAiMocks } from "./helpers/mock-ai-routes";
import { seedUnlockedVault } from "./helpers/seed-state";

// Playwright resolves test files via its CJS loader, so `import.meta.url`
// isn't usable here. The cwd when `npm run test:e2e` runs is the repo root,
// so a project-relative path is the simplest stable handle.
const FIXTURE_PDF = "tests/e2e/fixtures/sample.pdf";

// Core regression net for the product's promise: PDF in → cited answer out.
// The AI proxies are mocked at the HTTP boundary so this runs deterministically
// without any real key. The pipeline under test is the entire client-side
// stack: pdfjs parse → chunker → embed worker → Dexie write → topKChunks
// retrieval → SSE stream parse → CitationChip rendering.
//
// Why the long timeout: dev-mode Turbopack first-bundle of pdfjs-dist
// legacy (~3 MB) on a cold cache can run 30-60 s before the worker even
// posts its first message. Warm cache lands closer to 10-15 s.
test.describe("notebook happy-path — PDF upload → chat Q&A with citation", () => {
  test("user uploads PDF, asks a question, sees streamed answer with citation chip", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const mocks = await installAiMocks(page);
    const { workspaceId } = await seedUnlockedVault(page);

    await page.goto(`/w/${workspaceId}`);
    await page.waitForLoadState("networkidle");

    // SourceUploader renders a real `<input type="file">` (line ~498 of
    // SourceUploader.tsx) that the openPicker button clicks. setInputFiles
    // bypasses the chooser dialog entirely and drives the same onChange path.
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(FIXTURE_PDF);

    // Wait for ingest to flip to "ready". Status copy is bilingual; the
    // source-row StatusBadge renders either "hazır" (TR) or "ready" (EN).
    await expect(
      page.getByText(/^(ready|hazır)$/i).first(),
    ).toBeVisible({ timeout: 120_000 });
    expect(mocks.embedHits()).toBeGreaterThanOrEqual(1);

    // The upload modal stays open after ingest finishes — close it so the
    // source-list link underneath is clickable.
    await page
      .getByRole("button", { name: /^(kapat|close)$/i })
      .first()
      .click();

    // The just-uploaded source becomes a Link to /w/{id}/read/{sourceId}.
    // SourceUploader strips the file extension before storing as title, so
    // the visible label is "sample" (not "sample.pdf").
    await page
      .getByRole("link")
      .filter({ hasText: /sample/i })
      .first()
      .click();
    await page.waitForLoadState("networkidle");

    // The thread sidebar starts empty ("Sohbet yok"); create a fresh thread
    // first so the composer has somewhere to write the user message.
    const newThreadBtn = page
      .getByRole("button", { name: /^(yeni sohbet|new chat)$/i })
      .first();
    if (await newThreadBtn.isVisible().catch(() => false)) {
      await newThreadBtn.click();
    }

    // Wait for the chat composer to be ready. Source is fetched via
    // useLiveQuery on mount; sendMessage returns early if source is null.
    const sendBtn = page
      .getByRole("button", { name: /^(gönder|send)$/i })
      .first();
    await expect(sendBtn).toBeEnabled({ timeout: 10_000 });

    const chatInput = page.locator("textarea").first();
    await chatInput.fill("What is this document about?");
    await sendBtn.click();

    // Streamed text from the mock should land verbatim in the chat panel.
    // We match the unique opener "This document is about" so we don't pick
    // up the PDF source text rendered alongside in the reader pane.
    await expect(
      page.getByText(/this document is about/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // The mock embeds [§ref:test-chunk-1] in the response — CitationChip
    // renders it as a button with data-citation-ref. The chip may be
    // disabled (no matching chunk) but the attribute and visibility hold.
    const citationChip = page.locator("[data-citation-ref]").first();
    await expect(citationChip).toBeVisible({ timeout: 5_000 });
    expect(mocks.chatHits()).toBe(1);
  });
});
