import { test, expect, type Page, type Route, type Request } from "@playwright/test";
import { seedUnlockedVault } from "./helpers/seed-state";

// Phase 5.5.F E2E happy path for the "Konu ara → Kaynak ekle" Brave Search
// modal (5.5.E).
//
// Flow under test:
//   workspace overview → "Konu ara" button (data-testid: open-search-sources-modal)
//   → SearchSourcesModal opens → user types a query → clicks "Ara" →
//   Brave returns 3 deterministic results → user ticks 2 rows → clicks
//   "Seçilenleri kaynak yap (2)" → each URL flows through `ingestResearchUrl`
//   using the default research provider (readability, via /api/ai/research
//   proxy) → 2 source rows land in IndexedDB with ingestStatus="ready".
//
// What is mocked (test-time only — production code is untouched):
//   - The upstream Brave Search Web API (`api.search.brave.com`). Without
//     this we'd burn real quota AND depend on Brave's uptime / result
//     stability for the test to remain green.
//   - The same-origin `/api/ai/research?url=...` proxy. The Readability
//     provider defaults to `useProxy=true` in production, so the browser
//     never reaches the article origin directly. Mocking the proxy returns
//     a deterministic article shell that Readability can parse.
//
// What is NOT mocked:
//   - lib/research/search/brave.ts             — runs real
//   - components/research/SearchSourcesModal   — runs real
//   - lib/research/providers/readability.ts    — runs real
//   - lib/research/ingest.ts + url-classifier  — runs real
//   - lib/db/sources.ts + chunks.ts            — write real rows to IDB
//
// Therefore a regression in any of those modules will fail this test.

const QUERY = "machine learning basics";
const BRAVE_KEY = "BSA-e2e-mocked-token";
const PROXY_PATH = "/api/ai/research";

// 3 deterministic Brave-shaped results. Hostnames are stable; we don't
// care about realism beyond what the modal renders.
const BRAVE_RESULTS = [
  {
    url: "https://example.com/ml-intro",
    title: "An Introduction to Machine Learning",
    description:
      "Machine learning is the study of algorithms that improve through experience.",
    age: "2 days ago",
    meta_url: { favicon: "https://example.com/favicon.ico" },
  },
  {
    url: "https://example.org/supervised-vs-unsupervised",
    title: "Supervised vs Unsupervised Learning",
    description:
      "A practical comparison of supervised and unsupervised paradigms with examples.",
    age: "1 week ago",
  },
  {
    url: "https://example.net/gradient-descent",
    title: "Gradient Descent: A Primer",
    description:
      "Understanding the workhorse optimization routine behind modern neural network training.",
  },
] as const;

const BRAVE_RESPONSE = { web: { results: BRAVE_RESULTS } };

function articleHtml(title: string, body: string): string {
  // Readability heuristics need: a <title>, an <article> or large body of
  // <p>, and enough text density to clear the score threshold. The shell
  // below works for the providers we exercise in this test — it's the same
  // shape that `add-url.e2e.ts` relies on.
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>
<body><article>
<h1>${title}</h1>
<p>${body}</p>
<p>This article expands on the headline idea with a second substantive paragraph so that the readability scorer has enough textual mass to identify the block as the primary article content rather than chrome or navigation.</p>
<p>A third paragraph reinforces the narrative and keeps the article's text density above the threshold that Mozilla Readability uses to short-circuit out of the "raw text" fallback branch.</p>
<h2>Background</h2>
<p>Additional context appears here for readers who want a deeper dive. The exact wording does not matter for the test; only that the article is recognisably an article.</p>
</article></body></html>`;
}

async function installBraveMock(
  page: Page,
): Promise<{ hits: () => number; lastQuery: () => string | null }> {
  let hits = 0;
  let lastQuery: string | null = null;
  await page.route(
    "**://api.search.brave.com/res/v1/web/search**",
    async (route: Route, req: Request) => {
      hits += 1;
      const requestUrl = new URL(req.url());
      lastQuery = requestUrl.searchParams.get("q");
      // Sanity-check the auth header — without it Brave returns 401 in prod.
      const sub = req.headers()["x-subscription-token"] ?? "";
      if (!sub) {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: "missing token" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(BRAVE_RESPONSE),
      });
    },
  );
  return { hits: () => hits, lastQuery: () => lastQuery };
}

async function installResearchProxyMock(
  page: Page,
): Promise<{ hits: () => number; urlsSeen: () => string[] }> {
  let hits = 0;
  const urlsSeen: string[] = [];
  await page.route(`**${PROXY_PATH}**`, async (route: Route, req: Request) => {
    hits += 1;
    const requestUrl = new URL(req.url());
    const target = requestUrl.searchParams.get("url") ?? "";
    urlsSeen.push(target);

    // Pick a body that's at least loosely keyed to the URL so a test
    // failure is easier to diagnose. Falls back to the first article when
    // the URL is unknown.
    const match = BRAVE_RESULTS.find((r) => r.url === target);
    const title = match?.title ?? "Untitled";
    const body = match?.description ?? "Article body.";
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: articleHtml(title, body),
    });
  });
  return { hits: () => hits, urlsSeen: () => urlsSeen };
}

test.describe("Phase 5.5.F — Find sources modal happy path", () => {
  test("Konu ara → select 2 results → bulk ingest → 2 sources persisted", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const brave = await installBraveMock(page);
    const proxy = await installResearchProxyMock(page);
    const { workspaceId } = await seedUnlockedVault(page, {
      extraApiKeys: [{ provider: "brave", plaintext: BRAVE_KEY }],
    });

    await page.goto(`/w/${workspaceId}`);
    await page.waitForLoadState("networkidle");

    // Open the Brave search modal. Workspace page renders this between
    // "URL / DOI ekle" and "Podcast oluştur" in the sources toolbar.
    await page.locator('[data-testid="open-search-sources-modal"]').click();
    const dialog = page.getByRole("dialog").first();
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Type query + submit.
    const queryInput = dialog.locator('[data-testid="search-query-input"]');
    await expect(queryInput).toBeVisible({ timeout: 5_000 });
    await queryInput.fill(QUERY);

    const submitBtn = dialog.locator('[data-testid="search-submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();

    // Wait for the result rows to render. The modal renders one button per
    // result with data-testid="search-result-row".
    const resultRows = dialog.locator('[data-testid="search-result-row"]');
    await expect(resultRows).toHaveCount(BRAVE_RESULTS.length, {
      timeout: 10_000,
    });

    expect(brave.hits()).toBe(1);
    expect(brave.lastQuery()).toBe(QUERY);

    // Tick rows 1 and 3 (skip the middle). The button toggles
    // data-selected when clicked. We use force-click + await stable state
    // between clicks so React's selected-set update propagates to the
    // bulk-ingest button's `(N)` label before we read it.
    await resultRows.nth(0).click();
    await expect(resultRows.nth(0)).toHaveAttribute("data-selected", "true", {
      timeout: 5_000,
    });
    await resultRows.nth(2).click();
    await expect(resultRows.nth(2)).toHaveAttribute("data-selected", "true", {
      timeout: 5_000,
    });
    await expect(resultRows.nth(1)).toHaveAttribute("data-selected", "false");

    // Bulk ingest. The button label includes `(N)` where N=selected.size —
    // waiting for `(2)` guarantees the React render committed both clicks
    // before we fire the bulk handler.
    const ingestBtn = dialog.locator('[data-testid="search-bulk-ingest"]');
    await expect(ingestBtn).toBeEnabled({ timeout: 5_000 });
    await expect(ingestBtn).toContainText(/\(2\)/, { timeout: 5_000 });

    // Pre-arm response waiters for both selected URLs BEFORE clicking the
    // button. Under parallel dev-server load the for-loop's iteration cadence
    // can race with React's state-update microtasks; subscribing to the
    // network events up front guarantees we observe them.
    const wait1 = page.waitForResponse(
      (r) => r.url().includes(encodeURIComponent(BRAVE_RESULTS[0]!.url)),
      { timeout: 30_000 },
    );
    const wait3 = page.waitForResponse(
      (r) => r.url().includes(encodeURIComponent(BRAVE_RESULTS[2]!.url)),
      { timeout: 30_000 },
    );

    await ingestBtn.click();
    await Promise.all([wait1, wait3]);

    // Wait for ingest to actually settle by polling Dexie directly. The
    // success toast is racy (auto-dismiss) AND the partial-failure variant
    // uses different copy ("N eklendi · M başarısız"), so polling for the
    // source count is the steadiest signal that the for-loop finished.
    await page.waitForFunction(
      async (wsId) => {
        const candidates = await indexedDB.databases();
        const tmeDb = candidates.find(
          (d) => typeof d.name === "string" && d.name.length > 0,
        );
        if (!tmeDb || typeof tmeDb.name !== "string") return false;
        const dbReq = indexedDB.open(tmeDb.name);
        const db: IDBDatabase = await new Promise((resolve, reject) => {
          dbReq.onsuccess = () => resolve(dbReq.result);
          dbReq.onerror = () => reject(dbReq.error);
        });
        try {
          return await new Promise<boolean>((resolve, reject) => {
            const tx = db.transaction(["sources"], "readonly");
            const req = tx.objectStore("sources").getAll();
            req.onsuccess = () => {
              const rows = req.result as Array<{
                workspaceId: string;
                ingestStatus: string;
              }>;
              const ready = rows.filter(
                (r) => r.workspaceId === wsId && r.ingestStatus === "ready",
              );
              resolve(ready.length >= 2);
            };
            req.onerror = () => reject(req.error);
          });
        } finally {
          db.close();
        }
      },
      workspaceId,
      { timeout: 45_000, polling: 500 },
    );

    // Proxy must have served exactly the two selected URLs. Surface the
    // observed URL list in the failure message so a 0/1/3 hit count is
    // immediately diagnosable.
    const urlsSeen = proxy.urlsSeen();
    const diag = `Proxy URLs seen: ${JSON.stringify(urlsSeen)} (hits=${proxy.hits()})`;
    expect(urlsSeen, diag).toContain(BRAVE_RESULTS[0]!.url);
    expect(urlsSeen, diag).toContain(BRAVE_RESULTS[2]!.url);
    expect(urlsSeen).not.toContain(BRAVE_RESULTS[1]!.url);

    // Verify Dexie state: exactly 2 source rows in this workspace, both ready.
    const persisted = await page.evaluate(
      async (args: { workspaceId: string }) => {
        const candidates = await indexedDB.databases();
        const tmeDb = candidates.find(
          (d) => typeof d.name === "string" && d.name.length > 0,
        );
        if (!tmeDb || typeof tmeDb.name !== "string") {
          throw new Error("find-sources.e2e: no IndexedDB database");
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
              ingestStatus: string;
              workspaceId: string;
              sourceUrl?: string;
            }>
          >((resolve, reject) => {
            const tx = db.transaction(["sources"], "readonly");
            const req = tx.objectStore("sources").getAll();
            req.onsuccess = () =>
              resolve(req.result as Array<{
                id: string;
                title: string;
                ingestStatus: string;
                workspaceId: string;
                sourceUrl?: string;
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

    expect(persisted).toHaveLength(2);
    for (const row of persisted) {
      expect(row.ingestStatus).toBe("ready");
    }
  });
});
