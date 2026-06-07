// Phase 7.4.D — Conflict resolution policy.
//
// `reconcile.ts` always emits the LWW (last-write-wins) action: disk
// wins on `mtime >= updatedAt`, Dexie wins otherwise. The user can
// override that decision per workspace via Settings → Tercihler:
//
//   - "lww" (default): the reconcile decision passes through unchanged.
//   - "always-disk": even when Dexie is newer, force `import-update`
//     so the disk version overwrites Dexie. Useful when the user
//     primarily edits in Obsidian / VS Code and TME is read-only-ish.
//   - "always-dexie": even when disk is newer, force
//     `conflict-dexie-wins` so the dispatcher re-exports Dexie's
//     content over the disk file. Useful when TME is the canonical
//     editor and disk is a passive mirror.
//
// `prompt` (modal-on-conflict) is deferred until a follow-up phase —
// the union and Settings UI leave room for it without a breaking
// change.
//
// The function is pure: same action + policy → same action. It does
// not call the fs or Dexie. The dispatcher pipes reconcile output
// through here BEFORE executing.

import type { ReconcileAction } from "./reconcile";

export type ConflictPolicy = "lww" | "always-disk" | "always-dexie";

export const CONFLICT_POLICIES: readonly ConflictPolicy[] = [
  "lww",
  "always-disk",
  "always-dexie",
];

export const DEFAULT_CONFLICT_POLICY: ConflictPolicy = "lww";

export function isConflictPolicy(value: unknown): value is ConflictPolicy {
  return (
    typeof value === "string" &&
    (CONFLICT_POLICIES as readonly string[]).includes(value)
  );
}

/**
 * Post-process a reconcile action against the user's conflict policy.
 * Only `import-update` and `conflict-dexie-wins` can be remapped — every
 * other action passes through (noop / skip-hash-match / import-new /
 * delete-note are unrelated to the conflict triage).
 *
 * `noteUpdatedAt: 0` is a sentinel emitted when remapping import-update
 * → conflict-dexie-wins under always-dexie. The dispatcher's
 * conflict-dexie-wins executor only needs `noteId` and the path; the
 * updatedAt field is telemetry data for the future prompt UI.
 */
export function applyConflictPolicy(
  action: ReconcileAction,
  policy: ConflictPolicy,
): ReconcileAction {
  if (policy === "lww") return action;

  if (policy === "always-disk") {
    if (action.kind === "conflict-dexie-wins") {
      return {
        kind: "import-update",
        noteId: action.noteId,
        content: action.diskContent,
        mtimeMs: action.diskMtimeMs,
      };
    }
    return action;
  }

  // always-dexie
  if (action.kind === "import-update") {
    return {
      kind: "conflict-dexie-wins",
      noteId: action.noteId,
      diskContent: action.content,
      diskMtimeMs: action.mtimeMs,
      noteUpdatedAt: 0,
    };
  }
  return action;
}
