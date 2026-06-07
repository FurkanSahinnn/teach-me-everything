// Phase 7.4.E — Folder cascade expansion.
//
// Why: when the user deletes a folder externally (Finder, Obsidian
// "Move folder to trash", `rm -rf Sub/`), the filesystem watcher
// emits exactly one remove event for the folder path itself — at
// least on macOS FSEvents and Linux inotify. Individual file remove
// events for the now-vanished children are NOT guaranteed. Without
// cascade detection the reconciler would see one event for
// `~/vault/Sub` (no `.md` suffix, dropped or noop'd), and the notes
// `Sub/A.md`, `Sub/B.md`, `Sub/C.md` would stay in Dexie forever,
// pointing at paths that no longer exist on disk.
//
// How: when a non-`.md` remove arrives, treat the path as a potential
// directory prefix. Look up every indexed note path that lives under
// that prefix (string startsWith on the normalised path + trailing
// separator so `~/v/Sub` does not collide with `~/v/Subscript.md`).
// Emit one synthetic remove event per matched child path. Pass-through
// for everything else (markdown removes, all create/modify/other
// events).
//
// Trade-off: if a watcher DOES emit per-file remove events alongside
// the folder remove (Windows ReadDirectoryChangesW often does), the
// cascade and the native events both fire. The dispatcher's
// per-path FIFO lock plus the dedupe `seen` Set in the expansion keep
// each path's reconcile pass single-shot — the second event sees the
// note already deleted and noop's. Net effect: idempotent.

import type { PathIndex } from "./reconcile";
import type { VaultWatchEvent } from "./watcher";
import { isMarkdownPath } from "./watcher";

/**
 * Expand folder-remove events into per-note synthetic remove events.
 *
 * - `.md` remove events pass through unchanged.
 * - Non-`.md` remove events trigger a path-index sweep — every
 *   indexed entry under the directory prefix becomes its own
 *   synthetic remove event. If no children match, the event is
 *   dropped (the folder either had no tracked notes or already
 *   cascaded on a prior tick).
 * - Non-remove events pass through unchanged. The watcher boundary
 *   already gated them to `.md`.
 *
 * Output is deduped on path so a folder remove + an explicit child
 * remove in the same batch don't yield two events for the same
 * note. Order is preserved within each input event's expansion.
 */
export function expandFolderRemoves(
  events: ReadonlyArray<VaultWatchEvent>,
  pathIndex: PathIndex,
): VaultWatchEvent[] {
  const out: VaultWatchEvent[] = [];
  const seen = new Set<string>();

  const push = (event: VaultWatchEvent): void => {
    if (event.kind === "remove" && seen.has(event.path)) return;
    out.push(event);
    if (event.kind === "remove") seen.add(event.path);
  };

  for (const event of events) {
    if (event.kind !== "remove") {
      out.push(event);
      continue;
    }

    if (isMarkdownPath(event.path)) {
      push(event);
      continue;
    }

    // Non-`.md` remove → potential folder cascade.
    const prefix = withTrailingSeparator(event.path);
    for (const indexedPath of pathIndex.keys()) {
      if (isUnderDirectory(indexedPath, prefix)) {
        push({ kind: "remove", path: indexedPath });
      }
    }
    // If nothing matched, the event is silently dropped — it's either a
    // stale folder TME never indexed, or a non-note file unrelated to
    // the vault.
  }

  return out;
}

function withTrailingSeparator(path: string): string {
  if (path.endsWith("/") || path.endsWith("\\")) return path;
  // Use forward slash for the normalised comparison; the downstream
  // check normalises both sides anyway.
  return path + "/";
}

function isUnderDirectory(filePath: string, dirPrefixWithSep: string): boolean {
  const f = normaliseSeparators(filePath);
  const d = normaliseSeparators(dirPrefixWithSep);
  return f.startsWith(d);
}

function normaliseSeparators(path: string): string {
  return path.replace(/\\/g, "/");
}
