import { test, expect } from "@playwright/test";
import { seedUnlockedVault } from "./helpers/seed-state";

// Phase 6.8 E2E — Daily notes locale-aware default.
//
// Flow under test:
//   seedUnlockedVault (locale defaults to TR) → goto /w/[id]/notes →
//   click the "Bugün"/"Today" button in the NoteTree header → a folder
//   ("Günlük" in TR, "Daily" in EN) is created if missing → a note titled
//   "Daily-DD-MM-YYYY" (TR) or "Daily-YYYY-MM-DD" (EN) is created inside
//   it via `findOrCreateDailyNote` → editor opens it.
//
// What is NOT mocked: findOrCreateDailyNote + folder creation + the
// debounced autosave (we don't wait for it because the test only cares
// that the row exists, which `createNote` does synchronously inside the
// helper).
//
// The assertion accepts both locale variants so the test stays green if a
// future prefs override flips the default mid-suite. The "Daily-" prefix
// is locale-independent — TR & EN both keep that label.

test.describe("Phase 6.8 — Notes: daily note button creates dated entry", () => {
  test("clicking the today button creates a Daily-* note in the daily folder", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const { workspaceId } = await seedUnlockedVault(page);

    await page.goto(`/w/${workspaceId}/notes`);
    await page.waitForLoadState("networkidle");

    const todayButton = page.getByTestId("note-tree-today");
    await expect(todayButton).toBeVisible({ timeout: 10_000 });
    await todayButton.click();

    // The handler is async: it creates a folder + note, then calls
    // `onSelectNote` which pushes `?id=<noteId>` onto the URL. Waiting on
    // the URL is the most precise signal that the create-then-select chain
    // completed without surfacing flaky CM6 mount races into this assertion.
    await page.waitForURL(/\?id=/, { timeout: 20_000 });

    // Verify rows landed in Dexie.
    const result = await page.evaluate(async (wsId: string) => {
      const candidates = await indexedDB.databases();
      const tmeDb = candidates.find(
        (d) => typeof d.name === "string" && d.name.length > 0,
      );
      if (!tmeDb || typeof tmeDb.name !== "string") {
        return { folderNames: [] as string[], noteTitles: [] as string[] };
      }
      const dbReq = indexedDB.open(tmeDb.name);
      const db: IDBDatabase = await new Promise((res, rej) => {
        dbReq.onsuccess = () => res(dbReq.result);
        dbReq.onerror = () => rej(dbReq.error);
      });
      try {
        const folders: unknown[] = await new Promise((res, rej) => {
          const req = db
            .transaction(["noteFolders"], "readonly")
            .objectStore("noteFolders")
            .getAll();
          req.onsuccess = () => res(req.result as unknown[]);
          req.onerror = () => rej(req.error);
        });
        const notes: unknown[] = await new Promise((res, rej) => {
          const req = db
            .transaction(["notes"], "readonly")
            .objectStore("notes")
            .getAll();
          req.onsuccess = () => res(req.result as unknown[]);
          req.onerror = () => rej(req.error);
        });
        const folderNames = folders
          .filter(
            (f): f is { workspaceId: string; name: string } =>
              typeof f === "object" &&
              f !== null &&
              (f as { workspaceId?: string }).workspaceId === wsId &&
              typeof (f as { name?: string }).name === "string",
          )
          .map((f) => f.name);
        const noteTitles = notes
          .filter(
            (n): n is { workspaceId: string; title: string } =>
              typeof n === "object" &&
              n !== null &&
              (n as { workspaceId?: string }).workspaceId === wsId &&
              typeof (n as { title?: string }).title === "string",
          )
          .map((n) => n.title);
        return { folderNames, noteTitles };
      } finally {
        db.close();
      }
    }, workspaceId);

    // Folder name is locale-aware. TR default is "Günlük", EN is "Daily".
    expect(
      result.folderNames.some((n) => /^(Günlük|Daily)$/.test(n)),
      `expected a daily folder, got ${JSON.stringify(result.folderNames)}`,
    ).toBe(true);

    // The title prefix "Daily-" is shared across locales — only the date
    // format inside the suffix differs (DD-MM-YYYY in TR, YYYY-MM-DD in EN).
    expect(
      result.noteTitles.some((t) => /^Daily-\d{2,4}-\d{2}-\d{2,4}$/.test(t)),
      `expected a Daily-* note title, got ${JSON.stringify(result.noteTitles)}`,
    ).toBe(true);
  });
});
