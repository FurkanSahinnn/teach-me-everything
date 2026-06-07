// Phase 7.3 — Cloud-sync folder detection. Surfaces a warning during the
// vault setup wizard if the user picks a path that lives inside a
// Dropbox / iCloud / OneDrive / Google Drive / pCloud / etc. folder.
//
// Why warn instead of forbid: power users intentionally store their vault
// inside cloud storage to sync across machines. The risk we want them to
// see is the triple-write race: Dexie writes the note → vault writes the
// `.md` → cloud agent uploads the `.md` → cloud agent on another machine
// downloads it → Tauri's fs notify fires → Dexie re-reads → conflict.
//
// Phase 7.4 (two-way sync) is where this gets dangerous in practice;
// Phase 7.3 ships one-way export and so the warning is advisory, not a
// hard stop.

import { CLOUD_SYNC_HINTS } from "./constants";

export type CloudSyncDetection = {
  detected: boolean;
  hint: string | null;
};

/**
 * Inspect a candidate vault path for known cloud-sync folder names. Case-
 * insensitive substring match; returns the first match found.
 */
export function detectCloudSyncFolder(path: string): CloudSyncDetection {
  if (typeof path !== "string" || path.length === 0) {
    return { detected: false, hint: null };
  }
  // Normalise separators so a Windows `\OneDrive\` matches a POSIX
  // `/OneDrive/` substring lookup.
  const normalised = path.replace(/\\/g, "/").toLowerCase();
  for (const hint of CLOUD_SYNC_HINTS) {
    const needle = hint.toLowerCase();
    // Match as a path component, not a substring of an unrelated name.
    // `~/MyDropboxBackup/notes` should NOT match `Dropbox` — but
    // `~/Dropbox/notes` should. Anchor on a non-alphanumeric boundary.
    const re = new RegExp(`(^|[^a-z0-9])${escapeForRegex(needle)}([^a-z0-9]|$)`);
    if (re.test(normalised)) {
      return { detected: true, hint };
    }
  }
  return { detected: false, hint: null };
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
