import { test, expect, type Page } from "@playwright/test";
import { seedUnlockedVault } from "./helpers/seed-state";

// Phase 5.A happy-path E2E.
//
// Flow under test:
//   workspace overview → "URL / DOI ekle" button → AddUrlModal opens →
//   user pastes a Wikipedia URL → ReadabilityResearchProvider uses
//   useProxy=false direct fetch (we mock that fetch with a stripped-down
//   article HTML) → Mozilla Readability extracts the article → Turndown
//   converts to Markdown → chunker → bulkAddChunks → source row appears
//   in the workspace's sources list with `ingestStatus: "ready"`.
//
// What is mocked (test-time only — production code is untouched):
//   - The direct upstream fetch to en.wikipedia.org. We use Playwright's
//     `page.route()` so the same `fetch(url)` call inside the readability
//     provider hits a deterministic article payload. Without this we'd
//     depend on Wikipedia uptime + body shape staying stable.
//
// What is NOT mocked:
//   - lib/research/providers/readability.ts — runs real
//   - lib/research/ingest.ts            — runs real
//   - lib/research/url-classifier.ts    — runs real
//   - lib/db/sources.ts + chunks.ts     — write real rows to IndexedDB
//   - The AddUrlModal component         — runs real
//
// Therefore a regression in any of those modules will fail this test.

const ARTICLE_URL = "https://en.wikipedia.org/wiki/Bayes_theorem";

// ReadabilityResearchProvider defaults to useProxy=true (the only working
// path under CSP in production), so the browser hits the same-origin Edge
// route `/api/ai/research?url=...` rather than the Wikipedia origin itself.
// Intercept that route to fulfill with a deterministic article HTML body —
// the real upstream fetch (Wikipedia) is never reached.
const PROXY_PATH = "/api/ai/research";

// A minimal but realistic article shell. Readability's heuristics need a
// non-trivial body with paragraph tags and a clear title to identify a
// "readable article" — too short and it returns null, falling back to the
// raw-text branch which produces less useful Markdown.
const ARTICLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Bayes' theorem - Wikipedia</title>
  <meta charset="utf-8">
</head>
<body>
  <article>
    <h1>Bayes' theorem</h1>
    <p><b>Bayes' theorem</b> (alternatively <b>Bayes' law</b> or <b>Bayes' rule</b>) describes the probability of an event, based on prior knowledge of conditions that might be related to the event. For example, if the risk of developing health problems is known to increase with age, Bayes' theorem allows the risk to an individual of a known age to be assessed more accurately by conditioning it relative to their age, rather than assuming that the individual is typical of the population as a whole.</p>
    <h2>Statement of theorem</h2>
    <p>Bayes' theorem is stated mathematically as the following equation: P(A | B) = (P(B | A) * P(A)) / P(B), where A and B are events and P(B) is not zero. P(A | B) is a conditional probability: the probability of event A occurring given that B is true.</p>
    <p>The theorem is named after the Reverend Thomas Bayes, who first provided an equation that allows new evidence to update beliefs. It was further developed by Pierre-Simon Laplace, who first published the modern formulation in his 1812 Théorie analytique des probabilités.</p>
    <h2>Examples</h2>
    <p>Suppose a particular test for whether someone has been using cannabis is 90% sensitive and 99% specific. The test correctly identifies 90% of cannabis users but also has a 1% false positive rate. Assuming 0.5% of people are users of cannabis, what is the probability that a random person who tests positive is really a cannabis user?</p>
    <p>Using Bayes' theorem we can compute: P(User | +) = (0.90 * 0.005) / (0.90 * 0.005 + 0.01 * 0.995) ≈ 0.311. So only about 31% of those who test positive are actual users — a surprising result that highlights base rate fallacy.</p>
  </article>
</body>
</html>`;

async function installReadabilityFetchMock(page: Page): Promise<{
  hits: () => number;
}> {
  let hits = 0;
  // Intercept the same-origin proxy route. We don't include the host in the
  // glob because the page's origin is whatever `baseURL` points at (dev
  // server, usually localhost:3000) — matching by path is portable.
  await page.route(`**${PROXY_PATH}**`, async (route) => {
    const url = new URL(route.request().url());
    const target = url.searchParams.get("url") ?? "";
    if (target !== ARTICLE_URL) {
      // Some other URL — fail loudly so a regression that changes the
      // outgoing target doesn't silently pass.
      await route.fulfill({ status: 502, body: `unexpected target: ${target}` });
      return;
    }
    hits += 1;
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: ARTICLE_HTML,
    });
  });
  return { hits: () => hits };
}

test.describe("Phase 5.A — Add URL happy path (readability)", () => {
  test("paste URL → ingest pipeline → source appears ready in workspace", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const upstream = await installReadabilityFetchMock(page);
    const { workspaceId } = await seedUnlockedVault(page);

    await page.goto(`/w/${workspaceId}`);
    await page.waitForLoadState("networkidle");

    // The "URL / DOI ekle" button lives in the section header next to the
    // file-upload button (workspace overview, around line 438). The TR
    // copy comes from i18n key `workspace.url_doi_ekle`; both locales pass.
    const addUrlBtn = page
      .getByRole("button", { name: /url\s*\/?\s*doi/i })
      .first();
    await expect(addUrlBtn).toBeVisible({ timeout: 10_000 });
    await addUrlBtn.click();

    // Modal opens — input is autoFocused.
    const urlInput = page.locator(
      'input[placeholder^="https://"], input[placeholder^="http"]',
    ).first();
    await expect(urlInput).toBeVisible({ timeout: 5_000 });
    await urlInput.fill(ARTICLE_URL);

    // Live classifier label flips to "Web page" / "Web sayfası" once the
    // input parses as a plain http(s) URL.
    await expect(
      page.getByText(/web (page|sayfası)/i).first(),
    ).toBeVisible({ timeout: 3_000 });

    // "Kaynak olarak ekle" / "Add as source" button — clicking kicks the
    // full pipeline (classify → fetch → readability → chunk → persist).
    const submitBtn = page
      .getByRole("button", { name: /(kaynak olarak ekle|add as source)/i })
      .first();
    await expect(submitBtn).toBeEnabled({ timeout: 3_000 });
    await submitBtn.click();

    // On success the modal closes and a toast fires ("Kaynak eklendi" /
    // "Source added"). Waiting for either the toast OR the modal to vanish
    // means we don't depend on which one renders first.
    await expect(
      page
        .getByText(/(kaynak eklendi|source added)/i)
        .first(),
    ).toBeVisible({ timeout: 30_000 });

    // The new source must show up in the sources list with status "ready" /
    // "hazır" — that's the contract `ingestResearchUrl` promises by
    // calling `setIngestStatus(id, "ready")` at the tail of the pipeline.
    await expect(
      page.getByText(/bayes('? theorem)?/i).first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/^(ready|hazır)$/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // The readability provider must have actually pulled the HTML — if the
    // pipeline short-circuited (e.g. classifier rejecting the URL) this
    // counter would stay at 0.
    expect(upstream.hits()).toBeGreaterThanOrEqual(1);
  });
});
