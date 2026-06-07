// Phase 7.3 — Note → markdown serializer for the vault exporter.
//
// Output is plain markdown — wikilinks (`[[target]]`) are preserved
// verbatim so Obsidian-compatible vaults round-trip cleanly. Daily notes
// (Phase 6.7) are routed to a fixed `Daily/` folder name on disk so
// Obsidian's Daily Notes plugin discovers them without extra config; the
// in-Dexie folder name (`Günlük` / `Daily`) is locale-dependent and we
// don't want a locale switch to migrate file paths.
//
// `serializeNote` returns the file BODY only. Filename and parent dir
// resolution happens in `export.ts` so the serializer stays pure and the
// `.md` extension lives in one place.

import type { NoteRecord, NoteFolderRecord } from "@/lib/db/types";
import { VAULT_DAILY_FOLDER_NAME } from "./constants";

const DAILY_NOTE_TITLE_RE = /^Daily-(\d{2,4})-(\d{2})-(\d{2,4})$/;
const TRAILING_NEWLINES = /\n+$/;

/**
 * Detect whether `note` is a daily note by checking the title shape that
 * Phase 6.7's `buildDailyTitle(dateString)` emits. Both TR (`DD-MM-YYYY`)
 * and EN (`YYYY-MM-DD`) formats match the same regex pattern, so we
 * can route both to the same `Daily/` folder regardless of locale.
 */
export function isDailyNote(note: Pick<NoteRecord, "title">): boolean {
  return DAILY_NOTE_TITLE_RE.test(note.title);
}

/**
 * Compute the folder path inside the vault where this note should live.
 * Daily notes always route to `Daily/` (overrides the Dexie folder).
 * Other notes use the folder's stored path (Phase 6 `folder.path` is
 * already POSIX-segmented). Root notes return an empty string.
 *
 * `foldersById` is passed in rather than queried so the exporter can
 * batch-load the folder set once per workspace.
 */
export function resolveNoteFolderPath(
  note: Pick<NoteRecord, "title" | "folderId">,
  foldersById: Map<string, NoteFolderRecord>,
): string {
  if (isDailyNote(note)) return VAULT_DAILY_FOLDER_NAME;
  if (note.folderId === null) return "";
  const folder = foldersById.get(note.folderId);
  if (!folder) return "";
  return folder.path;
}

/**
 * Serialize note content to disk-ready markdown. Guarantees exactly one
 * trailing newline so the file ends cleanly (POSIX convention, also avoids
 * `git diff` "no newline at end of file" warnings if the user version-
 * controls the vault).
 *
 * Wikilinks are NOT rewritten — `[[target]]` and `[[source:abc]]` round-
 * trip as-is so Obsidian and TME share the same on-disk format. Phase
 * 7.4 (two-way sync) is where wikilink path resolution happens; here the
 * raw form is the canonical storage shape.
 */
export function serializeNote(note: Pick<NoteRecord, "content">): string {
  const body = typeof note.content === "string" ? note.content : "";
  // Ensure single trailing newline. Empty content still produces a
  // single-newline file so `cat` works on it.
  return `${body.replace(TRAILING_NEWLINES, "")}\n`;
}
