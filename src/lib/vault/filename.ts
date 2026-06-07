// Phase 7.3 — Filename helpers for the vault exporter.
//
// `slugifyFilename(title)` is filesystem-safe across NTFS / APFS / ext4 and
// preserves Turkish letters (UTF-8 is native everywhere we ship). It only
// strips the characters that break path joining: `/`, `\`, `:`, `*`, `?`,
// `"`, `<`, `>`, `|`, plus ASCII control chars and the NTFS-reserved
// trailing dot / space.
//
// `clampForWindows(fullPath, slug)` deals with Windows MAX_PATH (260 chars
// including the null terminator). If the resolved path would overflow, we
// truncate the slug and append a short ULID suffix to keep notes uniquely
// identifiable across truncation collisions.

import { WINDOWS_MAX_PATH, WINDOWS_PATH_HEADROOM } from "./constants";

// NTFS reserves these characters in any path component. APFS and ext4 are
// looser, but we apply the union so an exported vault can be opened on
// any platform without rename gymnastics.
const FORBIDDEN_CHARS = /[\\/:*?"<>|\x00-\x1F]/g;

// NTFS reserved device names (case-insensitive). A note titled `CON` or
// `COM1` would otherwise produce `CON.md` which Windows refuses to create.
const NTFS_RESERVED = new Set<string>([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

export const MAX_FILENAME_LENGTH = 200;
export const MD_EXTENSION = ".md";

/**
 * Slugify a note title into a filesystem-safe segment (sans `.md`). Returns
 * `"untitled"` for empty / whitespace-only input. Stripped chars collapse
 * to a single hyphen. Trailing dots/spaces are removed (NTFS forbids both).
 */
export function slugifyFilename(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return "untitled";

  let slug = trimmed
    .replace(FORBIDDEN_CHARS, "-")
    .replace(/-+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    // NTFS forbids trailing `.` or ` ` on any path component.
    .replace(/[. ]+$/, "");

  if (slug.length === 0) slug = "untitled";

  // Reserved device names — append a suffix so `CON` → `CON-note`.
  const baseUpper = slug.toUpperCase();
  if (NTFS_RESERVED.has(baseUpper)) {
    slug = `${slug}-note`;
  }

  // Hard cap at MAX_FILENAME_LENGTH (cross-platform safe; ext4 allows 255
  // bytes per component, APFS allows 255 chars, NTFS allows 255 chars).
  if (slug.length > MAX_FILENAME_LENGTH) {
    slug = slug.slice(0, MAX_FILENAME_LENGTH).trim();
    slug = slug.replace(/[. ]+$/, "");
  }

  return slug;
}

/**
 * Build `{slug}.md` and, if the resulting full path would exceed Windows'
 * MAX_PATH, truncate the slug and append a short ULID-style suffix to keep
 * notes uniquely identifiable across truncation collisions.
 *
 * Inputs:
 *   - `parentDirPath` — absolute directory the file will be written into
 *     (vault root + folder hierarchy, separators already joined).
 *   - `slug` — pre-slugified base (no extension).
 *   - `uniqueSuffix` — short collision-breaker (typically the last 6 chars
 *     of the note's ULID id; passed in so callers can keep this helper pure).
 *
 * Returns the final filename WITH `.md`. The caller joins it back onto
 * `parentDirPath` to write the file. The check is Windows-specific —
 * macOS/Linux don't enforce MAX_PATH, but we apply the same truncation
 * everywhere so an exported vault can be copied to a Windows machine
 * without breaking.
 */
export function buildMarkdownFilename(
  parentDirPath: string,
  slug: string,
  uniqueSuffix: string,
): string {
  const base = slug.length > 0 ? slug : "untitled";
  const fullCandidate = `${parentDirPath}\\${base}${MD_EXTENSION}`;
  if (fullCandidate.length <= WINDOWS_MAX_PATH) {
    return `${base}${MD_EXTENSION}`;
  }

  // Need to truncate the slug. Compute the budget: MAX_PATH - parentDir -
  // separator - `.md` - `-${suffix}`.
  const suffix = uniqueSuffix.slice(0, 6);
  const reservedTail = `-${suffix}${MD_EXTENSION}`;
  const budget =
    WINDOWS_MAX_PATH -
    WINDOWS_PATH_HEADROOM -
    parentDirPath.length -
    reservedTail.length -
    1; // path separator
  const truncated =
    budget > 0
      ? base.slice(0, budget).trim().replace(/[. ]+$/, "")
      : "n";
  const safeBase = truncated.length > 0 ? truncated : "n";
  return `${safeBase}${reservedTail}`;
}
