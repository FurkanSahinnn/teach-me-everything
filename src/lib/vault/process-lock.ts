// Phase 7.4.G — Cross-process vault lock sentinel.
//
// Why: two TME instances pointed at the same vault would each subscribe
// their own watcher + reconciler and race on every write. The first one
// wins the in-process `withFileLock` chain (Phase 7.4.A) but the second
// is in a *different* process — its lock map is empty. A sentinel file
// (`.tme-lock`) at the vault root surfaces the situation to the user
// instead of letting silent corruption happen.
//
// How: on dispatcher boot the React provider attempts to acquire. If a
// fresh lock (acquired < `STALE_LOCK_AGE_MS` ago) exists we surface a
// toast with a "Take over" action button. If it's older than the
// threshold we assume the previous instance crashed without releasing
// and steal it silently. On clean shutdown we remove our own lock.
//
// Release is ownership-aware: we only remove the sentinel if the lockId
// inside still matches what we wrote, so a steal from another process
// doesn't get clobbered by our own teardown.
//
// The watcher already filters `.tme-lock` writes (see `isLockFile` in
// `watcher.ts`), so the sentinel can't trigger a reconcile loop on
// itself. Lock writes also bypass `atomic-write.ts` deliberately — a
// half-written lock is harmless (the corrupt-JSON branch in `parseLock`
// treats it as "no lock") and the atomic-write suppression window is
// shorter than the lock TTL.

import {
  mkdirRecursive,
  pathExists,
  readTextFile,
  removeFile,
  VaultFsError,
  writeTextFile,
} from "./fs-adapter";
import { joinPath } from "./paths";

export const LOCK_FILENAME = ".tme-lock";
export const STALE_LOCK_AGE_MS = 5 * 60 * 1000;

export type ProcessLockMetadata = {
  version: 1;
  /** Random per-acquire token used for ownership-aware release. */
  lockId: string;
  /** Epoch ms when this lock was written. Drives the staleness check. */
  acquiredAt: number;
  /** Optional app version string for human-readable diagnostics. */
  appVersion?: string;
};

export type AcquireLockResult =
  | {
      kind: "acquired";
      metadata: ProcessLockMetadata;
      release: () => Promise<void>;
    }
  | {
      kind: "held";
      existing: ProcessLockMetadata;
      /**
       * Force-acquire the lock, overwriting whatever is on disk. Use
       * when the user explicitly chooses to take over via the held
       * toast's action button. Returns a fresh acquire result.
       */
      force: () => Promise<AcquireLockResult>;
    };

export type AcquireLockOpts = {
  force?: boolean;
  appVersion?: string;
};

let nowFn: () => number = () => Date.now();

/** Test seam — inject a fake clock for staleness tests. */
export function _setLockClockForTests(fn: (() => number) | null): void {
  nowFn = fn ?? (() => Date.now());
}

let lockIdGen: () => string = defaultLockIdGen;

/** Test seam — inject a deterministic lockId generator. */
export function _setLockIdGenForTests(fn: (() => string) | null): void {
  lockIdGen = fn ?? defaultLockIdGen;
}

/** Compute the absolute `.tme-lock` path for a vault root. */
export function lockPathFor(vaultRoot: string): string {
  return joinPath(vaultRoot, LOCK_FILENAME);
}

/**
 * Read and parse the lock sentinel. Returns `null` when missing,
 * unreadable, or shape-invalid — all three are treated the same:
 * the next acquire call will overwrite.
 */
export async function readVaultLock(
  vaultRoot: string,
): Promise<ProcessLockMetadata | null> {
  const lockPath = lockPathFor(vaultRoot);
  try {
    if (!(await pathExists(lockPath))) return null;
    const raw = await readTextFile(lockPath);
    return parseLock(raw);
  } catch (err) {
    if (err instanceof VaultFsError) return null;
    throw err;
  }
}

/**
 * Try to acquire the vault lock. Returns `held` when a fresh lock
 * already exists (caller surfaces the toast); returns `acquired` when
 * the slot is free, the existing lock is stale, or `opts.force` is set.
 */
export async function acquireVaultProcessLock(
  vaultRoot: string,
  opts: AcquireLockOpts = {},
): Promise<AcquireLockResult> {
  const existing = await readVaultLock(vaultRoot);
  if (existing !== null && !opts.force) {
    const age = nowFn() - existing.acquiredAt;
    if (age < STALE_LOCK_AGE_MS) {
      return {
        kind: "held",
        existing,
        force: () => acquireVaultProcessLock(vaultRoot, { ...opts, force: true }),
      };
    }
    // Stale — fall through to overwrite. The previous owner likely
    // crashed without releasing.
  }
  const metadata: ProcessLockMetadata = {
    version: 1,
    lockId: lockIdGen(),
    acquiredAt: nowFn(),
    ...(opts.appVersion !== undefined ? { appVersion: opts.appVersion } : {}),
  };
  // Defensive mkdir: the vault setup wizard's "Use default" path saves
  // a rootPath like `~/Documents/TeachMeEverything` without necessarily
  // creating the folder. If the user later deletes it manually the
  // sentinel write fails with no actionable error. `mkdirRecursive` is
  // idempotent — already-exists is a no-op.
  await mkdirRecursive(vaultRoot);
  await writeTextFile(
    lockPathFor(vaultRoot),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  // Re-read after writing to resolve the read-then-write (TOCTOU) race: if
  // two instances both saw a free/stale slot and wrote, the file now holds
  // whichever write landed last. Confirm our lockId actually won; if another
  // instance's write clobbered ours, surface the vault as held by them rather
  // than have both instances believe they own it. `force` callers
  // deliberately overwrite, so they skip this check.
  if (!opts.force) {
    const confirmed = await readVaultLock(vaultRoot);
    if (confirmed !== null && confirmed.lockId !== metadata.lockId) {
      return {
        kind: "held",
        existing: confirmed,
        force: () =>
          acquireVaultProcessLock(vaultRoot, { ...opts, force: true }),
      };
    }
  }
  return {
    kind: "acquired",
    metadata,
    release: () => releaseIfOwned(vaultRoot, metadata.lockId),
  };
}

async function releaseIfOwned(
  vaultRoot: string,
  ourLockId: string,
): Promise<void> {
  // Re-read before removing: if a steal happened (the user clicked
  // "Take over" in another instance), we must NOT remove the new owner's
  // lock. Ownership match is the only signal we trust.
  const current = await readVaultLock(vaultRoot);
  if (current === null) return;
  if (current.lockId !== ourLockId) return;
  try {
    await removeFile(lockPathFor(vaultRoot));
  } catch {
    // Best-effort: lock removal failure is non-fatal. The next acquirer
    // will treat it as stale once the TTL elapses, and the user can
    // always click "Take over" before that.
  }
}

function parseLock(raw: string): ProcessLockMetadata | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.lockId !== "string" || obj.lockId.length === 0) return null;
  if (typeof obj.acquiredAt !== "number" || !Number.isFinite(obj.acquiredAt)) {
    return null;
  }
  const result: ProcessLockMetadata = {
    version: 1,
    lockId: obj.lockId,
    acquiredAt: obj.acquiredAt,
  };
  if (typeof obj.appVersion === "string" && obj.appVersion.length > 0) {
    result.appVersion = obj.appVersion;
  }
  return result;
}

function defaultLockIdGen(): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 12);
  return `${stamp}-${rand}`;
}
