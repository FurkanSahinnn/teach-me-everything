import { test, expect, type Page } from "@playwright/test";
import { seedUnlockedVault } from "./helpers/seed-state";
import { installAiMocks } from "./helpers/mock-ai-routes";

// Phase 6.9.9 E2E — Notes-as-Source: dirty detection + resync.
//
// Flow under test:
//   seedUnlockedVault → installAiMocks → seed one note + one already-synced
//   linked source (lastEmbeddedContentHash matches sha256(note.content)) +
//   one seed chunk → goto /w/[id]/notes?id=<id> → button reads
//   data-state="synced" (the seeded hash matches the current note content)
//   → capture lastEmbeddedAt + hash → dispatch a content append via
//   window.__tmeEditorView → autosave (800ms debounce) + button hash
//   debounce (300ms) flip the button to data-state="dirty" → click → wait
//   for data-state="synced" → assert lastEmbeddedContentHash changed and
//   lastEmbeddedAt advanced.
//
// Why pre-seed the source row instead of running 6.9.9-create's flow twice:
// keeps the two tests independent (a failure here doesn't cascade from a
// 6.9.9-create failure) and exercises the dirty-detection path directly
// without relying on the create path's embed mock having fired.

const SEEDED_NOTE_ID = "note_e2e_embed_sync";
const SEEDED_SOURCE_ID = "src_e2e_embed_sync";
const SEEDED_CHUNK_ID = "ck_e2e_embed_sync_1";
const INITIAL_CONTENT =
  "# Embedded Note\n\nThe original baseline content for sync detection tests. This sentence is long enough that the chunker emits at least one chunk.";

async function seedEmbeddedNote(
  page: Page,
  workspaceId: string,
): Promise<void> {
  await page.evaluate(
    async (args: {
      wsId: string;
      noteId: string;
      sourceId: string;
      chunkId: string;
      content: string;
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
        throw new Error("seedEmbeddedNote: no IndexedDB database");
      }

      // Mirror `computeNoteHash` exactly so the seeded source row reads
      // "synced" on first paint without needing a re-embed handshake.
      const enc = new TextEncoder();
      const digestBuf = await crypto.subtle.digest(
        "SHA-256",
        enc.encode(args.content),
      );
      const hashHex = Array.from(new Uint8Array(digestBuf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const dbReq = indexedDB.open(tmeDb.name);
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        dbReq.onsuccess = () => resolve(dbReq.result);
        dbReq.onerror = () => reject(dbReq.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(
            ["notes", "sources", "chunks"],
            "readwrite",
          );
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          const now = Date.now();

          tx.objectStore("notes").put({
            id: args.noteId,
            workspaceId: args.wsId,
            folderId: null,
            title: "Embedded Note",
            content: args.content,
            tags: [],
            wikilinks: [],
            path: "Embedded Note.md",
            createdAt: now,
            updatedAt: now,
          });

          tx.objectStore("sources").put({
            id: args.sourceId,
            workspaceId: args.wsId,
            type: "note",
            title: "Embedded Note",
            noteId: args.noteId,
            ingestStatus: "ready",
            embeddingStatus: "ready",
            lastEmbeddedContentHash: hashHex,
            lastEmbeddedAt: now,
            createdAt: now,
            updatedAt: now,
          });

          // Seed one matching chunk so the source has a non-empty body —
          // the orchestrator's per-chunk text-equality cache can then make
          // its reuse vs miss decision on a real baseline.
          const seedEmbedding = new Array(1536)
            .fill(0)
            .map((_, i) => Math.sin(i * 0.31));
          tx.objectStore("chunks").put({
            id: args.chunkId,
            sourceId: args.sourceId,
            workspaceId: args.wsId,
            index: 0,
            text: args.content,
            tokenCount: 32,
            section: "Section 1",
            headings: ["Embedded Note"],
            embedding: seedEmbedding,
            createdAt: now,
          });
        });
      } finally {
        db.close();
      }
    },
    {
      wsId: workspaceId,
      noteId: SEEDED_NOTE_ID,
      sourceId: SEEDED_SOURCE_ID,
      chunkId: SEEDED_CHUNK_ID,
      content: INITIAL_CONTENT,
    },
  );
}

type SourceMetadataSnapshot = {
  hash: string | undefined;
  lastEmbeddedAt: number | undefined;
};

async function readSourceMetadata(
  page: Page,
  sourceId: string,
): Promise<SourceMetadataSnapshot> {
  return await page.evaluate(async (id: string) => {
    const candidates = await indexedDB.databases();
    const tmeDb = candidates.find(
      (d) => typeof d.name === "string" && d.name.length > 0,
    );
    if (!tmeDb || typeof tmeDb.name !== "string") {
      return { hash: undefined, lastEmbeddedAt: undefined };
    }
    const dbReq = indexedDB.open(tmeDb.name);
    const db: IDBDatabase = await new Promise((res, rej) => {
      dbReq.onsuccess = () => res(dbReq.result);
      dbReq.onerror = () => rej(dbReq.error);
    });
    try {
      const tx = db.transaction(["sources"], "readonly");
      const req = tx.objectStore("sources").get(id);
      const row = await new Promise<unknown>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      if (!row || typeof row !== "object") {
        return { hash: undefined, lastEmbeddedAt: undefined };
      }
      const r = row as {
        lastEmbeddedContentHash?: string;
        lastEmbeddedAt?: number;
      };
      return {
        hash: r.lastEmbeddedContentHash,
        lastEmbeddedAt: r.lastEmbeddedAt,
      };
    } finally {
      db.close();
    }
  }, sourceId);
}

test.describe("Phase 6.9.9 — Notes-as-Source: dirty detection + resync", () => {
  test("edit a synced note, button flips to dirty, click re-syncs", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const { workspaceId } = await seedUnlockedVault(page);
    await installAiMocks(page);
    await seedEmbeddedNote(page, workspaceId);

    await page.goto(`/w/${workspaceId}/notes?id=${SEEDED_NOTE_ID}`);
    await page.waitForLoadState("networkidle");

    const editorHost = page.getByTestId("note-editor-host");
    await expect(editorHost).toBeVisible({ timeout: 15_000 });

    const embedButton = page.getByTestId("note-embed-button");
    await expect(embedButton).toBeVisible({ timeout: 10_000 });

    // The seeded source's hash matches sha256(note.content), so once the
    // live-query lands and the 300ms hash debounce fires, the button derives
    // "synced". A generous timeout absorbs the initial CM6 mount + the two
    // debounces stacking.
    await expect(embedButton).toHaveAttribute("data-state", "synced", {
      timeout: 15_000,
    });

    const beforeSync = await readSourceMetadata(page, SEEDED_SOURCE_ID);
    expect(
      beforeSync.hash,
      "seeded hash should be a 64-char sha256 hex",
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(
      beforeSync.lastEmbeddedAt ?? 0,
      "seeded lastEmbeddedAt should be a positive timestamp",
    ).toBeGreaterThan(0);

    // Dispatch a content append. Same rationale as notes-create.e2e.ts:
    // CM6 + Playwright synthetic typing is fragile; the test-only EditorView
    // handle on window dispatches a genuine transaction that triggers the
    // same docChanged path the user's keystrokes would.
    await page.waitForFunction(
      () =>
        !!(window as Window & { __tmeEditorView?: unknown }).__tmeEditorView,
      { timeout: 10_000 },
    );
    await page.evaluate(() => {
      const view = (
        window as Window & {
          __tmeEditorView?: {
            state: { doc: { length: number } };
            dispatch: (tr: unknown) => void;
          } | null;
        }
      ).__tmeEditorView;
      if (!view) throw new Error("editor view not exposed");
      const appended =
        "\n\nA fresh paragraph that invalidates the original embedding hash and forces a dirty state.";
      view.dispatch({
        changes: { from: view.state.doc.length, insert: appended },
      });
    });

    // Chain: CM6 docChanged → 800ms autosave → updateNote(Dexie) →
    // useLiveQuery refire → selectedNote.content prop updates → button
    // useEffect on [content] → 300ms hash debounce → currentHash changes →
    // deriveButtonState observes mismatch → data-state flips to "dirty".
    await expect(embedButton).toHaveAttribute("data-state", "dirty", {
      timeout: 15_000,
    });

    await embedButton.click();

    // Embedding fires → /api/ai/embed mock returns deterministic vectors →
    // markNoteSourceSynced writes new hash + lastEmbeddedAt → live-query
    // refires → button derives "synced".
    await expect(embedButton).toHaveAttribute("data-state", "synced", {
      timeout: 25_000,
    });

    const afterSync = await readSourceMetadata(page, SEEDED_SOURCE_ID);
    expect(
      afterSync.hash,
      "lastEmbeddedContentHash should change after re-embed",
    ).not.toBe(beforeSync.hash);
    expect(
      afterSync.hash,
      "post-resync hash is still a 64-char sha256 hex",
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(
      afterSync.lastEmbeddedAt ?? 0,
      "lastEmbeddedAt should advance after the resync",
    ).toBeGreaterThan(beforeSync.lastEmbeddedAt ?? 0);
  });
});
