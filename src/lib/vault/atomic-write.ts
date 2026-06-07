// Phase 7.4.A — atomic temp+rename pattern.
//
// Why: a power loss or process crash mid-write would otherwise corrupt
// the destination file. Writing to a sibling tmp file then renaming over
// the target makes the operation atomic at the filesystem level (rename
// is atomic on the same volume across POSIX and NTFS).
//
// How to apply: callers that touch user vault notes should prefer
// `atomicWriteTextFile` over the raw `writeTextFile` adapter. The export
// loop in 7.3 used direct `writeTextFile`; that's safe enough for one-
// way export since a corrupted file can be re-exported on next run, but
// the two-way sync engine in 7.4 must guarantee disk = source of truth,
// so every write goes through this path.

import {
  VaultFsError,
  removeFile,
  renameFile,
  writeTextFile,
} from "./fs-adapter";
import { markRecentWrite } from "./watcher-suppression";

export async function atomicWriteTextFile(
  path: string,
  content: string,
  opts?: { suffix?: string },
): Promise<void> {
  const suffix = opts?.suffix ?? generateAtomicSuffix();
  const tmpPath = `${path}.tmp.${suffix}`;
  try {
    await writeTextFile(tmpPath, content);
  } catch (err) {
    throw err instanceof VaultFsError
      ? err
      : new VaultFsError(`atomicWriteTextFile write-tmp failed at ${path}`, {
          cause: err,
          path,
        });
  }
  // Stamp the suppression BEFORE the rename so the watcher's debounced
  // callback (~500 ms later) sees the destination as "ours" and drops the
  // event instead of round-tripping it back through the reconciliation
  // engine. The TTL covers the watcher window + FS propagation latency.
  markRecentWrite(path);
  try {
    await renameFile(tmpPath, path);
  } catch (err) {
    // Cleanup orphan tmp on rename fail (best-effort; swallow cleanup
    // errors so the caller sees the original rename failure).
    try {
      await removeFile(tmpPath);
    } catch {
      /* swallow */
    }
    throw err instanceof VaultFsError
      ? err
      : new VaultFsError(`atomicWriteTextFile rename failed at ${path}`, {
          cause: err,
          path,
        });
  }
}

function generateAtomicSuffix(): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${stamp}-${rand}`;
}
