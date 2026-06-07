// Phase 7.4.C — Shared note-path builder + parser.
//
// Why: both `export.ts` (Dexie → disk) and `reconcile.ts` (disk → Dexie)
// need to compute the exact `{vaultRoot}/{folderPath}/{filename}` for a
// note. Keeping the logic in one place means the reverse index built by
// reconcile is guaranteed to match the paths the exporter writes — there
// is no second source of truth that can drift.
//
// `buildNoteAbsolutePath` mirrors the existing export.ts per-note loop
// 1:1. `parseAbsolutePathToVaultRelative` is the inverse: it takes an
// arbitrary abs path emitted by the watcher and decomposes it back into
// folder + filename, normalised to POSIX so the Dexie folder-path index
// (which stores `"Parent/Child"` regardless of host OS) matches.

import type { NoteFolderRecord, NoteRecord } from "@/lib/db/types";
import { buildMarkdownFilename, slugifyFilename } from "./filename";
import { joinPath, splitFolderPath } from "./paths";
import { resolveNoteFolderPath } from "./serialize";

export type BuildNoteAbsolutePathInput = {
  note: Pick<NoteRecord, "id" | "title" | "folderId">;
  foldersById: Map<string, NoteFolderRecord>;
  vaultRoot: string;
};

export type BuildNoteAbsolutePathResult = {
  /** The fully-resolved `{vaultRoot}/{folderPath}/{filename}` path. */
  absPath: string;
  /** Folder path in POSIX form ("Parent/Child" or "") — matches Dexie folder.path. */
  folderPath: string;
  /** Parent dir on disk: `vaultRoot` for root notes, else `vaultRoot/folderPath`. */
  parentDir: string;
  /** The bare `{slug}.md` filename (with Windows MAX_PATH truncation suffix when needed). */
  filename: string;
};

/**
 * Compute the absolute filesystem path a note serialises to. Pure: callers
 * pass in the pre-loaded `foldersById` map and a vault root string; this
 * function does no I/O.
 */
export function buildNoteAbsolutePath(
  input: BuildNoteAbsolutePathInput,
): BuildNoteAbsolutePathResult {
  const folderPath = resolveNoteFolderPath(input.note, input.foldersById);
  const parentDir =
    folderPath.length > 0
      ? joinPath(input.vaultRoot, ...splitFolderPath(folderPath))
      : input.vaultRoot;
  const slug = slugifyFilename(input.note.title);
  // Mirror export.ts: last 6 chars of the ULID-ish id are the collision
  // breaker when the slug needs to be truncated for Windows MAX_PATH.
  const suffix = input.note.id.slice(-6);
  const filename = buildMarkdownFilename(parentDir, slug, suffix);
  const absPath = joinPath(parentDir, filename);
  return { absPath, folderPath, parentDir, filename };
}

export type ParsedVaultPath = {
  /** Folder path in POSIX form ("Parent/Child" or "" for root). */
  folderPath: string;
  /** The trailing path segment — typically `something.md`. */
  filename: string;
};

/**
 * Decompose an absolute path into `{folderPath, filename}` relative to the
 * given vault root. Returns `null` if `absPath` does not start with the
 * vault root, so callers can ignore events that fired outside the watched
 * tree (defensive — the watcher's recursive=true should already prevent
 * this, but symlinks and edge cases happen).
 *
 * Comparison is case-sensitive even on Windows: NTFS preserves case but
 * resolves case-insensitively. Tauri's watcher emits paths with the
 * casing the user / OS used. If a user picks `C:\Users\Joe\Vault` and
 * the watcher emits `c:\users\joe\vault\Note.md`, we won't match — but
 * that's already a 7.5 polish concern; for now the watcher inherits the
 * casing from the vault-setup wizard's `dialog.open()` result, which is
 * canonical on every platform.
 */
export function parseAbsolutePathToVaultRelative(
  absPath: string,
  vaultRoot: string,
): ParsedVaultPath | null {
  if (absPath.length === 0 || vaultRoot.length === 0) return null;
  // Normalise both sides to forward slashes for the prefix check + segment
  // split. The folder path returned is in POSIX form regardless of host OS
  // so the caller can match it against Dexie's `folder.path` which is also
  // POSIX.
  const normAbs = absPath.replace(/[\\/]+/g, "/");
  const normRoot = vaultRoot.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  if (!normAbs.startsWith(normRoot + "/") && normAbs !== normRoot) {
    return null;
  }
  // Strip the root prefix + the single separator.
  const relative = normAbs.slice(normRoot.length).replace(/^\/+/, "");
  if (relative.length === 0) return null;
  const segments = relative.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  const filename = segments[segments.length - 1] ?? "";
  if (filename.length === 0) return null;
  const folderSegments = segments.slice(0, -1);
  const folderPath = folderSegments.join("/");
  return { folderPath, filename };
}
