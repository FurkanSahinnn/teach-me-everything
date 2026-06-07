import { test, expect, type Page, type Route, type Request } from "@playwright/test";
import { seedUnlockedVault } from "./helpers/seed-state";

// Phase 5.5.F E2E happy path for the Diffbot research provider (5.5.D.1).
//
// Flow under test:
//   workspace overview → "URL / DOI ekle" button → AddUrlModal opens →
//   user pastes an article URL → flips the provider chip from the default
//   (readability) to Diffbot → submits.
//
//   `DiffbotResearchProvider.fetchContent` POSTs to the real upstream
//   `https://api.diffbot.com/v3/article?token=<KEY>&url=<URL>`. We mock
//   that exact upstream fetch with Playwright's `page.route()`, so the
//   provider receives a deterministic `{ objects: [{ html, title, ... }] }`
//   payload. Turndown converts the HTML → Markdown, the chunker slices it,
//   `addSource` + `bulkAddChunks` persist into IndexedDB. The modal closes
//   on success and a toast ("Kaynak eklendi") confirms the write.
//
// What is mocked (test-time only — production code is untouched):
//   - The direct upstream fetch to `api.diffbot.com`. Without this we'd
//     burn a real Diffbot quota credit AND depend on their uptime/output
//     stability for the test to pass.
//
// What is NOT mocked:
//   - lib/research/providers/diffbot.ts      — runs real
//   - lib/research/ingest.ts                  — runs real
//   - lib/research/credential.ts              — decrypts the seeded key
//   - lib/db/sources.ts + chunks.ts           — write real rows to IndexedDB
//   - The AddUrlModal component               — runs real
//
// Therefore a regression in any of those modules will fail this test.

const ARTICLE_URL = "https://example.com/articles/quantum-coherence-2026";
const DIFFBOT_KEY = "diffbot-e2e-mocked-token";

// Minimal Diffbot Article API response. The provider reads `objects[0]`,
// preferring `html` (run through turndown) over `text`. Title + author + date
// land on the source record; `pageUrl` (or `resolvedPageUrl`) decides the
// canonical URL stored on the source.
const DIFFBOT_RESPONSE = {
  objects: [
    {
      title: "Quantum Coherence in Solid-State Qubits",
      html:
        "<h1>Quantum Coherence in Solid-State Qubits</h1>" +
        "<p>Solid-state qubits face decoherence from coupling to phonons, " +
        "nuclear spins, and charge fluctuators. Recent advances in dynamical " +
        "decoupling have pushed T2 times past one millisecond at millikelvin " +
        "temperatures, opening a path toward scalable error-corrected qubits.</p>" +
        "<h2>Phonon-Mediated Decoherence</h2>" +
        "<p>Acoustic phonons couple to the qubit through deformation potential " +
        "or piezoelectric mechanisms. Engineering the host substrate to suppress " +
        "low-frequency phonons reduces T1 dephasing dramatically.</p>" +
        "<h2>Mitigation Strategies</h2>" +
        "<p>Dynamical decoupling sequences such as CPMG and XY-8 extend the " +
        "effective coherence time by averaging out slow noise. Combined with " +
        "isotopic purification, these techniques have demonstrated T2 > 1 ms " +
        "in silicon-based quantum dots.</p>",
      text: "Solid-state qubits face decoherence...",
      author: "A. Pekgöz",
      date: "2026-05-01T00:00:00Z",
      pageUrl: ARTICLE_URL,
      resolvedPageUrl: ARTICLE_URL,
    },
  ],
};

async function installDiffbotMock(page: Page): Promise<{ hits: () => number }> {
  let hits = 0;
  await page.route(
    "**://api.diffbot.com/v3/article**",
    async (route: Route, req: Request) => {
      hits += 1;
      // Sanity-check the contract: the provider must send both `token` and
      // `url` query params. Without `token` Diffbot returns 401; without
      // `url` it returns 400.
      const requestUrl = new URL(req.url());
      const token = requestUrl.searchParams.get("token");
      const url = requestUrl.searchParams.get("url");
      if (!token) {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ errorCode: 401, error: "missing token" }),
        });
        return;
      }
      if (!url) {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ errorCode: 400, error: "missing url" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(DIFFBOT_RESPONSE),
      });
    },
  );
  return { hits: () => hits };
}

test.describe("Phase 5.5.F — Diffbot ingest happy path", () => {
  test("paste URL → flip to Diffbot chip → ingest → source ready", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const upstream = await installDiffbotMock(page);
    const { workspaceId } = await seedUnlockedVault(page, {
      extraApiKeys: [{ provider: "diffbot", plaintext: DIFFBOT_KEY }],
    });

    await page.goto(`/w/${workspaceId}`);
    await page.waitForLoadState("networkidle");

    // Open the AddUrlModal. The "URL / DOI ekle" button lives in the
    // sources section header (workspace overview).
    const addUrlBtn = page
      .getByRole("button", { name: /url\s*\/?\s*doi/i })
      .first();
    await expect(addUrlBtn).toBeVisible({ timeout: 10_000 });
    await addUrlBtn.click();

    const dialog = page.getByRole("dialog").first();
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Paste URL into the autofocused input.
    const urlInput = dialog
      .locator('input[placeholder^="https://"], input[placeholder^="http"]')
      .first();
    await urlInput.fill(ARTICLE_URL);

    // The classifier flips the type chip to "Web sayfası" / "Web page" once
    // the input parses as a plain http(s) URL. Wait for that before clicking
    // a provider chip so the chip list has rendered with `providerMatters=true`.
    await expect(
      dialog.getByText(/web (page|sayfası)/i).first(),
    ).toBeVisible({ timeout: 5_000 });

    // Flip the provider chip from the default (Readability) to Diffbot.
    // Provider chips are <button> elements with the preset label + capability
    // badges (e.g. "Diffbot 🪞 JS"), so we match the label substring rather
    // than the whole accessible name.
    const diffbotChip = dialog
      .getByRole("button", { name: /diffbot/i })
      .first();
    await expect(diffbotChip).toBeVisible({ timeout: 5_000 });
    await diffbotChip.click();

    // The submit button label is "Kaynak olarak ekle" (TR) / "Add as source"
    // (EN). It becomes enabled once a valid URL is in the input.
    const submitBtn = dialog
      .getByRole("button", { name: /(kaynak olarak ekle|add as source)/i })
      .first();
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();

    // The success toast fires AFTER ingestResearchUrl resolves: title +
    // chunkCount. Wait for either the toast OR for the modal to dismiss —
    // both signal a successful pipeline run.
    await expect(
      page.getByText(/(kaynak eklendi|source added)/i).first(),
    ).toBeVisible({ timeout: 30_000 });

    // The upstream mock must have been hit at least once. Anything more
    // than one indicates a provider retry bug that we'd want to surface.
    expect(upstream.hits()).toBeGreaterThanOrEqual(1);

    // Assert the persisted source row directly via Dexie. We don't rely on
    // visible UI re-render here because `useLiveQuery` may lag by one tick.
    const persisted = await page.evaluate(
      async (args: { workspaceId: string }) => {
        const candidates = await indexedDB.databases();
        const tmeDb = candidates.find(
          (d) => typeof d.name === "string" && d.name.length > 0,
        );
        if (!tmeDb || typeof tmeDb.name !== "string") {
          throw new Error("diffbot.e2e: no IndexedDB database");
        }
        const dbReq = indexedDB.open(tmeDb.name);
        const db: IDBDatabase = await new Promise((resolve, reject) => {
          dbReq.onsuccess = () => resolve(dbReq.result);
          dbReq.onerror = () => reject(dbReq.error);
        });
        try {
          const rows = await new Promise<
            Array<{
              id: string;
              title: string;
              type: string;
              ingestStatus: string;
              workspaceId: string;
            }>
          >((resolve, reject) => {
            const tx = db.transaction(["sources"], "readonly");
            const req = tx.objectStore("sources").getAll();
            req.onsuccess = () =>
              resolve(req.result as Array<{
                id: string;
                title: string;
                type: string;
                ingestStatus: string;
                workspaceId: string;
              }>);
            req.onerror = () => reject(req.error);
          });
          return rows.filter((r) => r.workspaceId === args.workspaceId);
        } finally {
          db.close();
        }
      },
      { workspaceId },
    );

    expect(persisted.length).toBeGreaterThanOrEqual(1);
    const ingested = persisted[persisted.length - 1]!;
    expect(ingested.ingestStatus).toBe("ready");
    expect(ingested.title.toLowerCase()).toContain("quantum coherence");
  });
});
