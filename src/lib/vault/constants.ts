// Phase 7.3 — Vault constants shared across the pure helpers and the
// Tauri-aware fs-adapter. Kept in a leaf module so the pure layer doesn't
// have to import from the adapter.

export const DEFAULT_VAULT_FOLDER_NAME = "TeachMeEverything";

/**
 * Obsidian-compatible folder name for the Daily Notes plugin. The Phase 6.7
 * `findOrCreateDailyNote` helper already files daily notes under a locale-
 * named folder in Dexie (`Günlük` / `Daily`); the vault exporter normalises
 * that to a fixed `Daily/` folder on disk so the resulting `.md` files are
 * recognised by Obsidian's Daily Notes plugin without extra config.
 */
export const VAULT_DAILY_FOLDER_NAME = "Daily";

/**
 * Windows MAX_PATH is 260 chars including drive letter, path, filename, and
 * null terminator. We reserve 50 chars for the user's vault root + folder
 * hierarchy so the title-derived segment can occupy up to 250 - 50 = 200
 * chars on a worst-case nested folder, then truncate. The remaining 4 chars
 * are kept free for the `.md` extension + safety margin.
 */
export const WINDOWS_MAX_PATH = 260;
export const WINDOWS_PATH_HEADROOM = 50;

/**
 * Cloud-sync folder names we warn the user about during the vault wizard
 * because Dexie + filesystem + cloud-sync forms a triple-sync race
 * condition that's easy to wedge. Matched case-insensitive as folder name
 * substrings — `~/iCloud Drive/Documents` triggers because of "iCloud".
 */
export const CLOUD_SYNC_HINTS: readonly string[] = [
  "Dropbox",
  "iCloud Drive",
  "Library/Mobile Documents",
  "OneDrive",
  "Google Drive",
  "GoogleDrive",
  "pCloud",
  "Box Sync",
  "MEGAsync",
  "Sync",
  "Yandex.Disk",
];
