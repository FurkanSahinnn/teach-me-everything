// Phase 7.4.B — watcher suppression for our own writes.
//
// Why: when `atomicWriteTextFile` renames a `.tmp.*` over the
// destination, the FS watcher will fire a "modify" (or "create") event
// for that destination path some milliseconds later. Without
// suppression, the reconciliation engine in 7.4.C would see our own
// write as an external change and do unnecessary work — or worse,
// clobber a freshly-written file with stale Dexie content during a
// race.
//
// How: a time-windowed sentinel map. `markRecentWrite(path, ttlMs)`
// stamps an expiry on a path; `wasRecentlyWritten(path)` checks the
// stamp + expiry. Lazy GC: each call that hits an expired entry deletes
// it. The default TTL of 2000 ms comfortably covers the watcher's
// debounce window (500 ms) + filesystem propagation latency.

type Suppressions = Map<string, number>;

const suppressions: Suppressions = new Map();

type Now = () => number;
let nowFn: Now = () => Date.now();

export const DEFAULT_SUPPRESS_TTL_MS = 2000;

export function markRecentWrite(
  path: string,
  ttlMs: number = DEFAULT_SUPPRESS_TTL_MS,
): void {
  suppressions.set(path, nowFn() + Math.max(0, ttlMs));
}

export function wasRecentlyWritten(path: string): boolean {
  const expiry = suppressions.get(path);
  if (expiry === undefined) return false;
  if (nowFn() > expiry) {
    suppressions.delete(path);
    return false;
  }
  return true;
}

/** Test seam — inject a deterministic clock; pass `null` to restore Date.now. */
export function _setNowForTests(fn: Now | null): void {
  nowFn = fn ?? (() => Date.now());
}

/** Test seam — drop all suppression entries. */
export function _clearRecentWritesForTests(): void {
  suppressions.clear();
}
