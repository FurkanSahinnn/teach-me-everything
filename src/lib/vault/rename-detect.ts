// Phase 7.4.F — Rename detection (pure matcher).
//
// Why: `mv old.md new.md` typically arrives at the watcher as two
// events in the same debounced batch: `remove old.md` + `create
// new.md`. Without detection the reconciler runs delete-note(old) +
// import-new(new), which preserves the content but loses the Dexie id
// (and therefore every wikilink that referenced the old note's id +
// every backlink + every flashcard / SRS state tied to the note).
// Detecting the rename keeps the id stable; only `path` and
// (optionally) `title` change.
//
// How: pure pairwise matching by KIND + INDEX membership. A
// `remove(R)` where R is in pathIndex pairs with the first `create(C)`
// in the same batch where C is NOT in pathIndex. We do NOT confirm
// content equality here — that requires fs+Dexie reads which belong
// in the dispatcher. The pure matcher returns CANDIDATES; the
// dispatcher does the async hash-compare before committing.
//
// Greedy first-match: if multiple creates could pair with one remove,
// we pick the first. Pathological cases (e.g. user splits a file into
// two with identical content) fall back to standard delete + import
// on hash mismatch.
//
// Same-batch only: a rename that splits across two watcher batches
// (very long debounce or process pause between events) will not be
// caught — falls back to the standard delete + import flow. The
// 500ms debounce default + Tauri's batching should cover the common
// case.

import type { PathIndex } from "./reconcile";
import { isMarkdownPath, type VaultWatchEvent } from "./watcher";

export type RenameCandidate = {
  /** The `remove` event whose path is in the path index. */
  remove: VaultWatchEvent;
  /** The `create` event whose path is NOT in the path index. */
  create: VaultWatchEvent;
  /** The Dexie id pulled from pathIndex.get(remove.path). */
  noteId: string;
};

export type FindRenamesResult = {
  /** Candidate (remove, create) pairs the dispatcher must confirm. */
  candidates: RenameCandidate[];
  /** Events that did NOT participate in a rename — fall through to
   * standard per-event reconciliation. */
  leftover: VaultWatchEvent[];
};

/**
 * Pure pairwise rename matcher. No fs / Dexie access — the dispatcher
 * confirms each candidate via hash compare before committing.
 *
 * Pairs are formed greedily in the order events arrive. A `remove`
 * without an indexed path is ignored (not a candidate). A `create`
 * for an already-indexed path is ignored (it would mean we have a
 * stale or duplicate index entry — defer to the standard flow).
 */
export function findRenameCandidates(
  events: ReadonlyArray<VaultWatchEvent>,
  pathIndex: PathIndex,
): FindRenamesResult {
  const candidates: RenameCandidate[] = [];
  const usedRemovePaths = new Set<string>();
  const usedCreatePaths = new Set<string>();

  // Pre-compute the list of create-event paths (and their original
  // event objects) that COULD pair with a remove. Walking by index
  // means greedy first-match is stable and easy to test.
  const indexedRemoves: VaultWatchEvent[] = [];
  const orphanCreates: VaultWatchEvent[] = [];
  for (const event of events) {
    if (event.kind === "remove" && isMarkdownPath(event.path) && pathIndex.has(event.path)) {
      indexedRemoves.push(event);
    } else if (
      event.kind === "create" &&
      isMarkdownPath(event.path) &&
      !pathIndex.has(event.path)
    ) {
      orphanCreates.push(event);
    }
  }

  for (const removeEvent of indexedRemoves) {
    const noteId = pathIndex.get(removeEvent.path);
    if (noteId === undefined) continue;
    for (const createEvent of orphanCreates) {
      if (usedCreatePaths.has(createEvent.path)) continue;
      candidates.push({ remove: removeEvent, create: createEvent, noteId });
      usedRemovePaths.add(removeEvent.path);
      usedCreatePaths.add(createEvent.path);
      break;
    }
  }

  const leftover: VaultWatchEvent[] = [];
  for (const event of events) {
    if (event.kind === "remove" && usedRemovePaths.has(event.path)) continue;
    if (event.kind === "create" && usedCreatePaths.has(event.path)) continue;
    leftover.push(event);
  }

  return { candidates, leftover };
}
