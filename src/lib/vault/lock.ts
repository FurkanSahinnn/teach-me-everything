// Phase 7.4.A — per-path serialising lock for in-process write
// coordination.
//
// Why: two concurrent writers for the same path race on the .tmp file
// rename and can leave behind orphan tmp files. The lock queues
// operations for a single path so each runs to completion before the
// next starts. Keyed by absolute path string; cross-path operations
// don't block each other.
//
// Scope: in-process only. Cross-process locks (Obsidian opens the same
// vault and writes the same file) are addressed in 7.4.G with a sentinel
// file pattern + EBUSY retry.

type LockEntry = { tail: Promise<unknown> };
const locks = new Map<string, LockEntry>();

export async function withFileLock<T>(
  path: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(path)?.tail ?? Promise.resolve();
  const next = previous.then(() => fn());
  // Tail must never reject — otherwise the chain poisons subsequent
  // waiters. The original `next` is what we await for the caller's
  // result; `safe` is what we store as the chain tail.
  const safe = next.catch(() => {});
  const entry: LockEntry = { tail: safe };
  locks.set(path, entry);
  try {
    return await next;
  } finally {
    // Only the most recent setter clears the slot. If another caller
    // queued behind us, their entry has already overwritten ours and
    // their finally block owns the cleanup.
    if (locks.get(path) === entry) {
      locks.delete(path);
    }
  }
}

export function isLocked(path: string): boolean {
  return locks.has(path);
}

/** Test seam — drop all pending lock entries. */
export function _clearLocksForTests(): void {
  locks.clear();
}
