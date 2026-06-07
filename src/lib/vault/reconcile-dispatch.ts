// Phase 7.4.C — Reconciliation dispatcher.
//
// Glues `startVaultWatcher` (7.4.B) → per-path `withFileLock` (7.4.A) →
// `reconcileWatchEvent` (this phase) → Dexie repos + atomic-write (this
// phase, for the conflict-dexie-wins branch).
//
// Lifecycle:
//   1. On start: load the workspace's folders + notes once, build the
//      reverse path/folder indices.
//   2. Start the watcher rooted at `vaultRoot`; each batch of events
//      fans out per-path through `withFileLock` so two events for the
//      same path serialise but different paths run in parallel.
//   3. Each event runs through `reconcileWatchEvent` → `ReconcileAction`
//      → `executeAction` which calls the notes repo.
//   4. On import-new / delete-note we incrementally patch the in-memory
//      path index; on conflict-dexie-wins we atomic-write Dexie's
//      content back to disk (which marks the suppression so the
//      round-trip event is dropped).
//
// We do NOT rebuild the index on every event — vaults with a few
// thousand notes would otherwise pay an O(n) scan per debounced event.
// The incremental patch covers the common cases; explicit
// `rebuildIndex()` is exposed on the handle for callers that ran an
// out-of-band mutation (e.g. the "re-export all workspaces" button).

import {
  createNote,
  deleteNote,
  getNote as getNoteFromRepo,
  listNotesByWorkspace,
  updateNote,
} from "@/lib/db/notes";
import { listFoldersByWorkspace } from "@/lib/db/note-folders";
import type { NoteRecord } from "@/lib/db/types";
import { atomicWriteTextFile } from "./atomic-write";
import { expandFolderRemoves } from "./cascade";
import {
  applyConflictPolicy,
  DEFAULT_CONFLICT_POLICY,
  type ConflictPolicy,
} from "./conflict-policy";
import { VaultFsError, readTextFile, statPath } from "./fs-adapter";
import { hashNormalizedContent } from "./hash";
import { withFileLock } from "./lock";
import { normalizeForRead } from "./normalise";
import {
  buildFolderPathIndex,
  buildPathIndex,
  reconcileWatchEvent,
  type FolderPathIndex,
  type PathIndex,
  type ReconcileAction,
  type ReconcileDeps,
} from "./reconcile";
import {
  findRenameCandidates,
  type RenameCandidate,
} from "./rename-detect";
import { serializeNote } from "./serialize";
import {
  startVaultWatcher,
  type VaultWatchEvent,
  type VaultWatcherHandle,
} from "./watcher";

export type DispatchVaultReconcilerInput = {
  workspaceId: string;
  vaultRoot: string;
  delayMs?: number;
  recursive?: boolean;
  /**
   * Read the user's current conflict policy. Called per event so the
   * dispatcher always reflects the latest Settings value without
   * needing a restart. Defaults to LWW when not supplied.
   */
  getPolicy?: () => ConflictPolicy;
  /** Notified after each action is executed (for telemetry / toasts). */
  onAction?: (event: VaultWatchEvent, action: ReconcileAction) => void;
  /** Notified on unexpected throws (errors swallowed otherwise). */
  onError?: (event: VaultWatchEvent, err: unknown) => void;
  /** Test seam — override the Dexie + fs touch points. */
  overrides?: ReconcilerOverrides;
};

/**
 * Test seam. When supplied, the dispatcher routes every Dexie call /
 * fs call / watcher subscription through these instead of the real
 * impls. Production callers leave this undefined.
 */
export type ReconcilerOverrides = Partial<{
  loadFolders: typeof listFoldersByWorkspace;
  loadNotes: typeof listNotesByWorkspace;
  getNote: typeof getNoteFromRepo;
  createNote: typeof createNote;
  updateNote: typeof updateNote;
  deleteNote: typeof deleteNote;
  startWatcher: typeof startVaultWatcher;
  readTextFile: typeof readTextFile;
  statPath: typeof statPath;
  atomicWriteTextFile: typeof atomicWriteTextFile;
}>;

export type VaultReconcilerHandle = {
  stop: () => Promise<void>;
  /** Force a full index rebuild from Dexie. */
  rebuildIndex: () => Promise<void>;
  /**
   * Phase 7.4.F — Dev affordance. Inject a synthetic event into the
   * reconcile pipeline as if the watcher had fired it. Useful for
   * manual QA (e.g. devtools: `window.__tmeVaultReconciler.triggerEvent(...)`)
   * and integration tests that need to verify reactions without
   * touching disk. Returns once the event has finished being
   * processed.
   */
  triggerEvent: (event: VaultWatchEvent) => Promise<void>;
  /**
   * Phase 7.4.G — Undo a `conflict-dexie-wins` action by restoring the
   * captured disk version. Writes `diskContent` into the Dexie note
   * AND re-exports it back to disk so both sides converge on the
   * version the user originally had. Serialises under the per-path
   * lock to avoid racing the watcher's own re-fire; the atomic-write
   * suppression window then drops the round-trip event.
   */
  undoConflict: (input: UndoConflictInput) => Promise<void>;
};

export type UndoConflictInput = {
  noteId: string;
  /** Absolute path the conflict-dexie-wins write targeted. */
  path: string;
  /** The disk content captured at conflict time (normalised). */
  diskContent: string;
};

export async function dispatchVaultReconciler(
  input: DispatchVaultReconcilerInput,
): Promise<VaultReconcilerHandle> {
  const ov = input.overrides ?? {};
  const loadFolders = ov.loadFolders ?? listFoldersByWorkspace;
  const loadNotes = ov.loadNotes ?? listNotesByWorkspace;
  const getNote = ov.getNote ?? getNoteFromRepo;
  const createNoteFn = ov.createNote ?? createNote;
  const updateNoteFn = ov.updateNote ?? updateNote;
  const deleteNoteFn = ov.deleteNote ?? deleteNote;
  const startWatcher = ov.startWatcher ?? startVaultWatcher;
  const readTextFileFn = ov.readTextFile ?? readTextFile;
  const statPathFn = ov.statPath ?? statPath;
  const atomicWriteTextFileFn =
    ov.atomicWriteTextFile ?? atomicWriteTextFile;

  let pathIndex: PathIndex = new Map();
  let folderPathIndex: FolderPathIndex = new Map();

  const rebuildIndex = async (): Promise<void> => {
    const [folders, notes] = await Promise.all([
      loadFolders(input.workspaceId),
      loadNotes(input.workspaceId),
    ]);
    const foldersById = new Map(folders.map((f) => [f.id, f]));
    pathIndex = buildPathIndex({
      notes,
      foldersById,
      vaultRoot: input.vaultRoot,
    });
    folderPathIndex = buildFolderPathIndex({ folders });
  };

  await rebuildIndex();

  const processOne = async (event: VaultWatchEvent): Promise<void> => {
    try {
      const deps: ReconcileDeps = {
        pathIndex,
        folderPathIndex,
        vaultRoot: input.vaultRoot,
        getNote: (id) => getNote(id),
        readTextFile: readTextFileFn,
        statPath: statPathFn,
      };
      const raw = await reconcileWatchEvent(event, deps);
      const policy = input.getPolicy?.() ?? DEFAULT_CONFLICT_POLICY;
      const action = applyConflictPolicy(raw, policy);
      await executeAction(event, action);
      input.onAction?.(event, action);
    } catch (err) {
      input.onError?.(event, err);
    }
  };

  const executeAction = async (
    event: VaultWatchEvent,
    action: ReconcileAction,
  ): Promise<void> => {
    switch (action.kind) {
      case "noop":
      case "skip-hash-match":
        return;
      case "import-update":
        await updateNoteFn(action.noteId, { content: action.content });
        return;
      case "import-new": {
        const created = await createNoteFn({
          workspaceId: input.workspaceId,
          folderId: action.folderId,
          content: action.content,
        });
        pathIndex.set(action.absPath, created.id);
        return;
      }
      case "delete-note":
        await deleteNoteFn(action.noteId);
        pathIndex.delete(event.path);
        return;
      case "conflict-dexie-wins": {
        const note = await getNote(action.noteId);
        if (note === undefined) return;
        const body = serializeNote(note as NoteRecord);
        await atomicWriteTextFileFn(event.path, body);
        return;
      }
      case "rename": {
        // Update note content (extractTitle handles title shift if the
        // H1 changed) + swap the path index entry.
        await updateNoteFn(action.noteId, { content: action.content });
        pathIndex.delete(action.oldPath);
        pathIndex.set(action.newPath, action.noteId);
        return;
      }
    }
  };

  /**
   * Async-confirm a rename candidate via hash compare: read disk
   * content at the new path, hash it against the Dexie note's content
   * (both normalised). If they match, execute the rename + notify
   * onAction; if not, return the pair so the dispatcher can fall back
   * to standard delete + import-new processing. Fs / Dexie errors
   * also fall back.
   */
  const tryRename = async (
    cand: RenameCandidate,
  ): Promise<{ committed: boolean; fallback: VaultWatchEvent[] }> => {
    const fallback: VaultWatchEvent[] = [cand.remove, cand.create];
    try {
      const note = await getNote(cand.noteId);
      if (note === undefined) return { committed: false, fallback };
      const stat = await statPathFn(cand.create.path);
      if (!stat.isFile) return { committed: false, fallback };
      const diskContent = await readTextFileFn(cand.create.path);
      const [diskHash, noteHash] = await Promise.all([
        hashNormalizedContent(diskContent),
        hashNormalizedContent(note.content),
      ]);
      if (diskHash !== noteHash) return { committed: false, fallback };
      const renameAction: ReconcileAction = {
        kind: "rename",
        noteId: cand.noteId,
        oldPath: cand.remove.path,
        newPath: cand.create.path,
        content: normalizeForRead(diskContent),
      };
      await executeAction(cand.create, renameAction);
      input.onAction?.(cand.create, renameAction);
      return { committed: true, fallback: [] };
    } catch (err) {
      if (!(err instanceof VaultFsError)) {
        // Non-fs error — let onError see it, but still fall back so the
        // standard flow gets a shot.
        input.onError?.(cand.create, err);
      }
      return { committed: false, fallback };
    }
  };

  /**
   * Single processing pipeline shared by the watcher callback and the
   * `triggerEvent` dev affordance. Phase 7.4.E cascade + 7.4.F rename
   * matching + per-event reconcile fan-out.
   */
  const dispatchBatch = async (
    rawEvents: ReadonlyArray<VaultWatchEvent>,
  ): Promise<void> => {
    // (1) Phase 7.4.E — fan folder-remove events out into per-note
    // synthetic remove events.
    const expanded = expandFolderRemoves(rawEvents, pathIndex);

    // (2) Phase 7.4.F — pair remove/create as potential renames.
    const { candidates, leftover } = findRenameCandidates(expanded, pathIndex);

    // (3) Async-confirm each rename. Successes get executed inline;
    // failures push their two events back into the leftover queue.
    const queue: VaultWatchEvent[] = [...leftover];
    await Promise.all(
      candidates.map(async (cand) => {
        const result = await withFileLock(cand.create.path, () => tryRename(cand));
        if (!result.committed) queue.push(...result.fallback);
      }),
    );

    // (4) Standard per-event reconcile + execute.
    await Promise.all(
      queue.map((event) =>
        withFileLock(event.path, () => processOne(event)),
      ),
    );
  };

  const handle: VaultWatcherHandle = await startWatcher({
    rootPath: input.vaultRoot,
    delayMs: input.delayMs ?? 500,
    recursive: input.recursive ?? true,
    onChange: (events) => {
      // Fire-and-forget at the watcher boundary so the callback
      // returns immediately. Errors are routed through `onError`
      // inside `processOne` / `tryRename`.
      void dispatchBatch(events);
    },
  });

  const undoConflict = async ({
    noteId,
    path,
    diskContent,
  }: UndoConflictInput): Promise<void> => {
    await withFileLock(path, async () => {
      // Restore disk content into Dexie first so the subsequent re-
      // export reads back the user's intended version. updateNote bumps
      // updatedAt — the next reconcile pass (if any) sees disk + Dexie
      // in agreement via hash and skips.
      await updateNoteFn(noteId, { content: diskContent });
      const refreshed = await getNote(noteId);
      if (refreshed === undefined) return;
      const body = serializeNote(refreshed as NoteRecord);
      await atomicWriteTextFileFn(path, body);
    });
  };

  return {
    stop: () => handle.stop(),
    rebuildIndex,
    triggerEvent: async (event) => {
      await dispatchBatch([event]);
    },
    undoConflict,
  };
}
