import { test, expect } from "@playwright/test";
import { seedUnlockedVault } from "./helpers/seed-state";
import { installAiMocks } from "./helpers/mock-ai-routes";

// Phase 6.9.9 E2E — Notes-as-Source: create + first embed.
//
// Flow under test:
//   seedUnlockedVault (openai key already seeded) → installAiMocks (mocks
//   /api/ai/embed to deterministic vectors) → goto /w/[id]/notes → create
//   blank note via empty-pane CTA → dispatch markdown content via
//   window.__tmeEditorView → wait for autosave to flush → click
//   note-embed-button while it reads data-state="idle" → wait for
//   data-state="synced" → assert Dexie has a source row (type:"note",
//   noteId set, lastEmbeddedContentHash a 64-char hex) plus >= 1 chunk
//   linked to that source.
//
// What is NOT mocked: embedNoteAsSource, the markdown chunker, the
// production embedder-factory wiring. The factory reads usePrefs (default
// embedPresetId falls back to "openai-3-small" in 6.9.5) + useVault state;
// the vault is unlocked by seedUnlockedVault and the openai api-key row is
// pre-encrypted into Dexie, so the factory resolves to a real OpenAI embed
// provider that POSTs to /api/ai/embed (intercepted by the mock).
//
// The chat /api/ai/chat mock is installed but unused; the notes page never
// calls chat in this flow.

test.describe("Phase 6.9.9 — Notes-as-Source: create + embed", () => {
  test("create a note, click embed, see source + chunks land in Dexie", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const { workspaceId } = await seedUnlockedVault(page);
    await installAiMocks(page);

    await page.goto(`/w/${workspaceId}/notes`);
    await page.waitForLoadState("networkidle");

    // Step 1 — create the note via the empty-pane CTA (same affordance the
    // notes-create.e2e.ts test uses).
    const emptyCta = page.getByTestId("notes-empty-create");
    await expect(emptyCta).toBeVisible({ timeout: 10_000 });
    await emptyCta.click();

    const editorHost = page.getByTestId("note-editor-host");
    await expect(editorHost).toBeVisible({ timeout: 15_000 });

    // Step 2 — drive content via the test-only EditorView handle. CM6's
    // contentEditable + Playwright's synthetic key events fight each other
    // (see notes-create.e2e.ts comment for the full rationale); dispatching
    // the same transaction CM6 would generate from real typing is the
    // robust path. The autosave plugin still fires `docChanged` and the
    // round-trip through Dexie is identical to a human user's.
    await page.waitForFunction(
      () =>
        !!(window as Window & { __tmeEditorView?: unknown }).__tmeEditorView,
      { timeout: 10_000 },
    );

    const NOTE_BODY =
      "# Sample Note\n\nQuantum mechanics describes the behavior of matter and energy at the smallest scales. Wave-particle duality is a central concept that this paragraph is long enough to embed.";

    await page.evaluate((text: string) => {
      const view = (
        window as Window & {
          __tmeEditorView?: {
            state: { doc: { length: number } };
            dispatch: (tr: unknown) => void;
          } | null;
        }
      ).__tmeEditorView;
      if (!view) throw new Error("editor view not exposed");
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    }, NOTE_BODY);

    // Step 3 — wait for autosave to flush. embedNoteAsSource reads
    // note.content from Dexie (not the editor's transient state), so we have
    // to know the row is durable before firing the click.
    await expect
      .poll(
        async () =>
          await page.evaluate(async (wsId: string) => {
            const candidates = await indexedDB.databases();
            const tmeDb = candidates.find(
              (d) => typeof d.name === "string" && d.name.length > 0,
            );
            if (!tmeDb || typeof tmeDb.name !== "string") return "";
            const dbReq = indexedDB.open(tmeDb.name);
            const db: IDBDatabase = await new Promise((res, rej) => {
              dbReq.onsuccess = () => res(dbReq.result);
              dbReq.onerror = () => rej(dbReq.error);
            });
            try {
              const tx = db.transaction(["notes"], "readonly");
              const req = tx.objectStore("notes").getAll();
              const rows = await new Promise<unknown[]>((res, rej) => {
                req.onsuccess = () => res(req.result as unknown[]);
                req.onerror = () => rej(req.error);
              });
              return rows
                .filter(
                  (r): r is { workspaceId: string; content: string } =>
                    typeof r === "object" &&
                    r !== null &&
                    (r as { workspaceId?: string }).workspaceId === wsId &&
                    typeof (r as { content?: string }).content === "string",
                )
                .map((r) => r.content)
                .join("\n");
            } finally {
              db.close();
            }
          }, workspaceId),
        { timeout: 15_000, intervals: [200, 400, 800] },
      )
      .toMatch(/Sample Note/);

    // Step 4 — embed. The button starts at "idle" (no linked source yet);
    // clicking fires the orchestrator → chunker → embed (mock intercepts) →
    // atomic chunk replace + markNoteSourceSynced → useNoteSource live-query
    // sees the new row → derives "synced" on the next render.
    const embedButton = page.getByTestId("note-embed-button");
    await expect(embedButton).toBeVisible({ timeout: 10_000 });
    await expect(embedButton).toHaveAttribute("data-state", "idle", {
      timeout: 10_000,
    });
    await embedButton.click();

    await expect(embedButton).toHaveAttribute("data-state", "synced", {
      timeout: 25_000,
    });

    // Step 5 — verify Dexie. The note-typed source row must reference the
    // note via `noteId`, carry a non-empty `lastEmbeddedContentHash` (64-char
    // sha256 hex from computeNoteHash), and have at least one chunk linked
    // via `sourceId`.
    const result = await page.evaluate(async (wsId: string) => {
      const candidates = await indexedDB.databases();
      const tmeDb = candidates.find(
        (d) => typeof d.name === "string" && d.name.length > 0,
      );
      if (!tmeDb || typeof tmeDb.name !== "string") {
        return {
          noteSources: [] as Array<{
            id: string;
            noteId?: string;
            lastEmbeddedContentHash?: string;
          }>,
          chunkCount: 0,
        };
      }
      const dbReq = indexedDB.open(tmeDb.name);
      const db: IDBDatabase = await new Promise((res, rej) => {
        dbReq.onsuccess = () => res(dbReq.result);
        dbReq.onerror = () => rej(dbReq.error);
      });
      try {
        const tx = db.transaction(["sources", "chunks"], "readonly");
        const srcReq = tx.objectStore("sources").getAll();
        const allSources = await new Promise<unknown[]>((res, rej) => {
          srcReq.onsuccess = () => res(srcReq.result as unknown[]);
          srcReq.onerror = () => rej(srcReq.error);
        });
        const noteSources = allSources
          .filter(
            (
              s,
            ): s is {
              id: string;
              workspaceId: string;
              type: string;
              noteId?: string;
              lastEmbeddedContentHash?: string;
            } =>
              typeof s === "object" &&
              s !== null &&
              (s as { workspaceId?: string }).workspaceId === wsId &&
              (s as { type?: string }).type === "note",
          )
          .map((s) => ({
            id: s.id,
            noteId: s.noteId,
            lastEmbeddedContentHash: s.lastEmbeddedContentHash,
          }));

        const chunkReq = tx.objectStore("chunks").getAll();
        const allChunks = await new Promise<unknown[]>((res, rej) => {
          chunkReq.onsuccess = () => res(chunkReq.result as unknown[]);
          chunkReq.onerror = () => rej(chunkReq.error);
        });
        const firstSourceId = noteSources[0]?.id;
        const chunkCount = !firstSourceId
          ? 0
          : allChunks.filter(
              (c) =>
                typeof c === "object" &&
                c !== null &&
                (c as { sourceId?: string }).sourceId === firstSourceId,
            ).length;

        return { noteSources, chunkCount };
      } finally {
        db.close();
      }
    }, workspaceId);

    expect(
      result.noteSources,
      "expected exactly one note-typed source row to land",
    ).toHaveLength(1);
    expect(
      result.noteSources[0]?.noteId,
      "source.noteId should point at the created note",
    ).toBeTruthy();
    expect(
      result.noteSources[0]?.lastEmbeddedContentHash,
      "lastEmbeddedContentHash should be a 64-char sha256 hex",
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(
      result.chunkCount,
      "at least one chunk should be embedded under the new source",
    ).toBeGreaterThan(0);
  });
});
