// Phase 7.4.C — Reconciliation engine (pure logic).
//
// Given a watcher event + a path-index + the disk and Dexie reads it
// produces a single `ReconcileAction` describing what to do. The action
// is executed by `reconcile-dispatch.ts` which calls the Dexie repos
// (and re-exports on conflict-dexie-wins). Keeping this side pure makes
// the conflict-triage matrix exhaustively testable without a real Tauri
// runtime or real Dexie.
//
// Conflict policy v1: last-write-wins on `mtimeMs vs note.updatedAt`.
// Disk wins when its mtime is >=; on `<` we emit `conflict-dexie-wins`
// so the dispatcher can re-export Dexie's content over the stale disk
// file. A future UI iteration can prompt the user instead of silently
// re-exporting; the action union already carries the data needed for
// that.
//
// Why on-the-fly hash instead of cached `NoteRecord.contentHash`: the
// Phase 6.9 content-hash cache lives on `SourceRecord` (chunk embedding
// invalidation). Notes don't have it. Per-event hash is ~5ms even for
// 10k-char notes (Web Crypto digest), and reconciliation runs at most
// once per debounced watcher window per path. No schema migration
// needed; the cost is bounded and acceptable.

import type { NoteFolderRecord, NoteRecord } from "@/lib/db/types";
import { VaultFsError, type VaultFileStat } from "./fs-adapter";
import { hashNormalizedContent } from "./hash";
import {
  buildNoteAbsolutePath,
  parseAbsolutePathToVaultRelative,
} from "./note-path";
import { normalizeForRead } from "./normalise";
import type { VaultWatchEvent } from "./watcher";

/** absPath → noteId. Built once per reconciliation pass. */
export type PathIndex = Map<string, string>;

/** Vault-relative POSIX folder path ("Parent/Child") → folderId. */
export type FolderPathIndex = Map<string, string>;

export type BuildPathIndexInput = {
  notes: ReadonlyArray<Pick<NoteRecord, "id" | "title" | "folderId">>;
  foldersById: Map<string, NoteFolderRecord>;
  vaultRoot: string;
};

/**
 * Compute the reverse `absPath → noteId` lookup. Uses the shared
 * `buildNoteAbsolutePath` helper so the index always matches what the
 * exporter wrote — no second source of truth.
 *
 * Collisions are theoretically possible if two notes slugify to the same
 * filename in the same folder, but the export filename suffix
 * (`-{6char-id}`) only kicks in when the path overflows Windows MAX_PATH
 * — short-title same-folder collisions would map to the same path. In
 * practice the slugifier preserves enough characters that this is rare;
 * when it happens, the latest write wins (Map semantics).
 */
export function buildPathIndex(input: BuildPathIndexInput): PathIndex {
  const index: PathIndex = new Map();
  for (const note of input.notes) {
    const { absPath } = buildNoteAbsolutePath({
      note,
      foldersById: input.foldersById,
      vaultRoot: input.vaultRoot,
    });
    index.set(absPath, note.id);
  }
  return index;
}

export type BuildFolderPathIndexInput = {
  folders: ReadonlyArray<NoteFolderRecord>;
};

/**
 * Lookup table for the import-new flow: when a disk path lives under
 * `Vault/Parent/Child/Note.md` we need to know which `folderId`
 * `Parent/Child` corresponds to. Folder.path is already POSIX
 * ("Parent/Child"), matching the value `parseAbsolutePathToVaultRelative`
 * returns.
 */
export function buildFolderPathIndex(
  input: BuildFolderPathIndexInput,
): FolderPathIndex {
  const index: FolderPathIndex = new Map();
  for (const f of input.folders) {
    if (f.path.length > 0) index.set(f.path, f.id);
  }
  return index;
}

export type ReconcileAction =
  | { kind: "noop"; reason: string }
  | { kind: "skip-hash-match"; noteId: string }
  | {
      kind: "import-update";
      noteId: string;
      content: string;
      mtimeMs: number;
    }
  | {
      kind: "import-new";
      absPath: string;
      content: string;
      folderId: string | null;
    }
  | { kind: "delete-note"; noteId: string }
  | {
      kind: "conflict-dexie-wins";
      noteId: string;
      diskContent: string;
      diskMtimeMs: number;
      noteUpdatedAt: number;
    }
  | {
      /**
       * Phase 7.4.F — synthesised by the dispatcher after a batch-level
       * rename matcher confirms `remove(oldPath) + create(newPath)` with
       * identical content hash. Executor updates the existing note's
       * content + patches the path index from oldPath → newPath. Keeps
       * the Dexie id stable so wikilinks/backlinks/SRS state survive.
       */
      kind: "rename";
      noteId: string;
      oldPath: string;
      newPath: string;
      content: string;
    };

export type ReconcileNoteSlice = Pick<
  NoteRecord,
  "id" | "content" | "updatedAt"
>;

export type ReconcileDeps = {
  pathIndex: PathIndex;
  folderPathIndex: FolderPathIndex;
  vaultRoot: string;
  getNote: (id: string) => Promise<ReconcileNoteSlice | undefined>;
  readTextFile: (path: string) => Promise<string>;
  statPath: (path: string) => Promise<VaultFileStat>;
};

/**
 * Triage a single watcher event into one `ReconcileAction`. Pure-ish:
 * does no Dexie writes, no file writes. The dispatcher executes the
 * action against the real repos.
 */
export async function reconcileWatchEvent(
  event: VaultWatchEvent,
  deps: ReconcileDeps,
): Promise<ReconcileAction> {
  if (event.kind === "other") {
    return { kind: "noop", reason: "event.kind=other" };
  }

  if (event.kind === "remove") {
    const noteId = deps.pathIndex.get(event.path);
    if (noteId === undefined) {
      return { kind: "noop", reason: "remove of unknown path" };
    }
    return { kind: "delete-note", noteId };
  }

  // create + modify share the same downstream flow: index-hit → update
  // triage, index-miss → import-new.
  const knownNoteId = deps.pathIndex.get(event.path);

  if (knownNoteId === undefined) {
    return reconcileImportNew(event.path, deps);
  }

  const note = await deps.getNote(knownNoteId);
  if (note === undefined) {
    // Path-index says a note exists at this path, but the repo doesn't
    // have it (stale index). Don't import-new — the index is supposed to
    // be authoritative; surfacing a noop keeps the data model consistent
    // and lets the next index rebuild reconcile.
    return { kind: "noop", reason: "path-index stale (no note record)" };
  }

  let stat: VaultFileStat;
  try {
    stat = await deps.statPath(event.path);
  } catch (err) {
    if (err instanceof VaultFsError) {
      return { kind: "noop", reason: `stat failed: ${err.message}` };
    }
    throw err;
  }
  if (!stat.isFile) {
    return { kind: "noop", reason: "not a file" };
  }

  let diskContent: string;
  try {
    diskContent = await deps.readTextFile(event.path);
  } catch (err) {
    if (err instanceof VaultFsError) {
      return { kind: "noop", reason: `read failed: ${err.message}` };
    }
    throw err;
  }

  const [diskHash, noteHash] = await Promise.all([
    hashNormalizedContent(diskContent),
    hashNormalizedContent(note.content),
  ]);
  if (diskHash === noteHash) {
    return { kind: "skip-hash-match", noteId: knownNoteId };
  }

  // Diverging content. Last-write-wins on mtime. On exact tie we let
  // disk win — the event fired because the OS observed a write, so the
  // disk side is the most recent observable change.
  const normalisedContent = normalizeForRead(diskContent);

  // Unknown mtime: the watcher only fired because the OS observed a write to
  // this file, so the disk side IS the freshest observable change. Defaulting
  // a null mtime to 0 would always lose the `>= note.updatedAt` comparison and
  // silently clobber the external edit with Dexie's content (data loss). Treat
  // unknown-mtime divergence as disk-wins (import-update is read-only into
  // Dexie — no file is overwritten).
  if (stat.mtimeMs === null || stat.mtimeMs === undefined) {
    return {
      kind: "import-update",
      noteId: knownNoteId,
      content: normalisedContent,
      mtimeMs: note.updatedAt,
    };
  }

  const mtimeMs = stat.mtimeMs;
  if (mtimeMs >= note.updatedAt) {
    return {
      kind: "import-update",
      noteId: knownNoteId,
      content: normalisedContent,
      mtimeMs,
    };
  }

  return {
    kind: "conflict-dexie-wins",
    noteId: knownNoteId,
    diskContent: normalisedContent,
    diskMtimeMs: mtimeMs,
    noteUpdatedAt: note.updatedAt,
  };
}

async function reconcileImportNew(
  absPath: string,
  deps: ReconcileDeps,
): Promise<ReconcileAction> {
  let stat: VaultFileStat;
  try {
    stat = await deps.statPath(absPath);
  } catch (err) {
    if (err instanceof VaultFsError) {
      return { kind: "noop", reason: `stat failed: ${err.message}` };
    }
    throw err;
  }
  if (!stat.isFile) return { kind: "noop", reason: "not a file" };

  let content: string;
  try {
    content = await deps.readTextFile(absPath);
  } catch (err) {
    if (err instanceof VaultFsError) {
      return { kind: "noop", reason: `read failed: ${err.message}` };
    }
    throw err;
  }

  const parsed = parseAbsolutePathToVaultRelative(absPath, deps.vaultRoot);
  if (parsed === null) {
    return { kind: "noop", reason: "path outside vault root" };
  }
  const folderId = resolveFolderIdFromPath(parsed.folderPath, deps.folderPathIndex);
  return {
    kind: "import-new",
    absPath,
    content: normalizeForRead(content),
    folderId,
  };
}

function resolveFolderIdFromPath(
  folderPath: string,
  index: FolderPathIndex,
): string | null {
  if (folderPath.length === 0) return null;
  return index.get(folderPath) ?? null;
}
