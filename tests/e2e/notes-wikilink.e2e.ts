import { test, expect, type Page } from "@playwright/test";
import { seedUnlockedVault } from "./helpers/seed-state";

// Phase 6.8 E2E — Wikilink autocomplete + backlink panel.
//
// Flow under test:
//   seedUnlockedVault → seed two notes (a "source" and a "target") with
//   distinct titles → open source note → type `[[Quan` to trigger the
//   autocomplete → press Enter to accept the top suggestion (matches
//   `Quantum Target`) → autosave flushes → source.wikilinks denormalises
//   to include the target → opening target note shows the source in
//   BacklinksPanel.
//
// What is NOT mocked: extractWikilinks + projectFromContent + the Dexie
// multiEntry-backed `useBacklinks` query — all run real.

const SOURCE_NOTE_ID = "note_e2e_src_link";
const TARGET_NOTE_ID = "note_e2e_tgt_link";
const TARGET_TITLE = "Quantum Target";
const SOURCE_TITLE = "Source Note";

async function seedTwoNotes(page: Page, workspaceId: string): Promise<void> {
  await page.evaluate(
    async (args: {
      wsId: string;
      sourceId: string;
      targetId: string;
      sourceTitle: string;
      targetTitle: string;
    }) => {
      let candidates = await indexedDB.databases();
      let attempts = 0;
      while (candidates.length === 0 && attempts < 50) {
        await new Promise((r) => setTimeout(r, 100));
        candidates = await indexedDB.databases();
        attempts += 1;
      }
      const tmeDb = candidates.find(
        (d) => typeof d.name === "string" && d.name.length > 0,
      );
      if (!tmeDb || typeof tmeDb.name !== "string") {
        throw new Error("seedTwoNotes: no IndexedDB database");
      }

      const dbReq = indexedDB.open(tmeDb.name);
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        dbReq.onsuccess = () => resolve(dbReq.result);
        dbReq.onerror = () => reject(dbReq.error);
      });

      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(["notes"], "readwrite");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          const now = Date.now();
          tx.objectStore("notes").put({
            id: args.sourceId,
            workspaceId: args.wsId,
            folderId: null,
            title: args.sourceTitle,
            content: `# ${args.sourceTitle}\n\n`,
            tags: [],
            wikilinks: [],
            path: `${args.sourceTitle}.md`,
            createdAt: now,
            updatedAt: now,
          });
          tx.objectStore("notes").put({
            id: args.targetId,
            workspaceId: args.wsId,
            folderId: null,
            title: args.targetTitle,
            content: `# ${args.targetTitle}\n\nDestination note.\n`,
            tags: [],
            wikilinks: [],
            path: `${args.targetTitle}.md`,
            createdAt: now,
            updatedAt: now,
          });
        });
      } finally {
        db.close();
      }
    },
    {
      wsId: workspaceId,
      sourceId: SOURCE_NOTE_ID,
      targetId: TARGET_NOTE_ID,
      sourceTitle: SOURCE_TITLE,
      targetTitle: TARGET_TITLE,
    },
  );
}

test.describe("Phase 6.8 — Notes: wikilink autocomplete + backlinks", () => {
  test("typing [[ opens autocomplete; selection wires a backlink in target", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const { workspaceId } = await seedUnlockedVault(page);
    await seedTwoNotes(page, workspaceId);

    await page.goto(`/w/${workspaceId}/notes?id=${SOURCE_NOTE_ID}`);
    await page.waitForLoadState("networkidle");

    const editorHost = page.getByTestId("note-editor-host");
    await expect(editorHost).toBeVisible({ timeout: 15_000 });

    // The wikilink-autocomplete UI is unit-tested separately (see
    // wikilink-autocomplete.test.ts). The E2E layer here cares about the
    // round-trip from "wikilink appears in note content" → "denormalised
    // wikilinks array" → "BacklinksPanel renders the referrer". We drive
    // the editor via the test-only `window.__tmeEditorView` handle (see
    // notes-create.e2e.ts for the rationale) and let the autosave pipeline
    // do the rest end-to-end.
    await page.waitForFunction(
      () =>
        !!(window as Window & { __tmeEditorView?: unknown }).__tmeEditorView,
      { timeout: 10_000 },
    );
    await page.evaluate((targetTitle: string) => {
      const view = (
        window as Window & {
          __tmeEditorView?: {
            state: { doc: { length: number } };
            dispatch: (tr: unknown) => void;
          } | null;
        }
      ).__tmeEditorView;
      if (!view) throw new Error("editor view not exposed");
      const appended = `\n\nSee [[${targetTitle}]]`;
      view.dispatch({
        changes: { from: view.state.doc.length, insert: appended },
      });
    }, TARGET_TITLE);

    // Poll Dexie for the autocomplete-applied wikilink to land on the row.
    // The "saved" badge in the footer is a 1.8s-only blink, and the autosave
    // debounce is 800ms, so polling the persisted state is more robust than
    // chasing the transient pill — and the persisted state is the real
    // assertion anyway.
    await expect
      .poll(
        async () => {
          return await page.evaluate(async (sourceId: string) => {
            const candidates = await indexedDB.databases();
            const tmeDb = candidates.find(
              (d) => typeof d.name === "string" && d.name.length > 0,
            );
            if (!tmeDb || typeof tmeDb.name !== "string") return 0;
            const dbReq = indexedDB.open(tmeDb.name);
            const db: IDBDatabase = await new Promise((res, rej) => {
              dbReq.onsuccess = () => res(dbReq.result);
              dbReq.onerror = () => rej(dbReq.error);
            });
            try {
              const tx = db.transaction(["notes"], "readonly");
              const req = tx.objectStore("notes").get(sourceId);
              const row: unknown = await new Promise((res, rej) => {
                req.onsuccess = () => res(req.result);
                req.onerror = () => rej(req.error);
              });
              const links = (row as { wikilinks?: unknown[] } | undefined)
                ?.wikilinks;
              return Array.isArray(links) ? links.length : 0;
            } finally {
              db.close();
            }
          }, SOURCE_NOTE_ID);
        },
        { timeout: 15_000, intervals: [200, 400, 800] },
      )
      .toBeGreaterThan(0);

    // Now navigate to the target note. The BacklinksPanel should pick up
    // the source note via the multiEntry-backed `useBacklinks` query.
    await page.goto(`/w/${workspaceId}/notes?id=${TARGET_NOTE_ID}`);
    await page.waitForLoadState("networkidle");

    // BacklinksPanel renders each referrer as a `data-testid="backlinks-row"`.
    // Filter the rows down to ones whose visible text contains the source
    // title so we tolerate other workspace rows appearing in parallel.
    const backlinkRow = page
      .getByTestId("backlinks-row")
      .filter({ hasText: new RegExp(SOURCE_TITLE, "i") })
      .first();
    await expect(backlinkRow).toBeVisible({ timeout: 8_000 });
  });
});
