// Phase 7.3 — pure path helpers for the filesystem vault. No imports from
// `@tauri-apps/*` here: every helper is side-effect free and unit-testable
// in node. The Tauri-aware platform helpers live in `fs-adapter.ts`.

import { DEFAULT_VAULT_FOLDER_NAME } from "./constants";

/**
 * Detect whether `path` is rooted (absolute) on either POSIX or Win32.
 * Conservative: a single leading `/` counts as POSIX absolute, and any
 * `C:\` / `\\server\` shape counts as Win32 absolute.
 */
export function isAbsolutePath(path: string): boolean {
  if (path.length === 0) return false;
  if (path.startsWith("/")) return true;
  if (/^[a-zA-Z]:[\\/]/.test(path)) return true;
  if (path.startsWith("\\\\")) return true;
  return false;
}

/**
 * Detect the path separator from a sample path. Falls back to `/` when the
 * input is empty or ambiguous (so callers can use the result to build new
 * segments without panicking on a junk input).
 */
export function detectSeparator(path: string): "/" | "\\" {
  if (path.includes("\\") && !path.includes("/")) return "\\";
  // Mixed paths (Windows lets you intermix) — count which one dominates.
  const fwd = (path.match(/\//g) ?? []).length;
  const bwd = (path.match(/\\/g) ?? []).length;
  if (bwd > fwd) return "\\";
  return "/";
}

/**
 * Join path segments using the separator inferred from the first segment.
 * Empty segments are dropped so callers can pass `joinPath(root, folderPath,
 * filename)` even when `folderPath` is "".
 */
export function joinPath(...segments: string[]): string {
  const clean = segments
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s, i) => {
      // Strip trailing separators on every segment, and leading separators
      // on every segment after the first, so `joinPath("/root/", "/a/", "/b")`
      // yields `/root/a/b` not `/root//a//b`.
      if (i === 0) return s.replace(/[\\/]+$/, "");
      return s.replace(/^[\\/]+/, "").replace(/[\\/]+$/, "");
    });
  if (clean.length === 0) return "";
  const sep = detectSeparator(clean[0] ?? "");
  return clean.join(sep);
}

/**
 * Normalize a folder.path string into POSIX segments. Phase 6 stored folder
 * paths as `"Parent/Child"` regardless of the host OS; we re-split on `/`
 * and the runtime adapter joins back with the OS-native separator.
 */
export function splitFolderPath(folderPath: string): string[] {
  if (folderPath.length === 0) return [];
  return folderPath
    .split(/[\\/]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Resolve `{vault}/{folder.path}/{filename}` using the vault's native
 * separator. `folderPath` may be empty (root note) or contain forward-slash
 * separated segments (Phase 6 stores POSIX).
 */
export function resolveVaultPath(
  vaultRoot: string,
  folderPath: string,
  filename: string,
): string {
  const folderSegments = splitFolderPath(folderPath);
  return joinPath(vaultRoot, ...folderSegments, filename);
}

/**
 * Default vault folder name appended to the OS document dir on first run.
 * Re-exported here so call sites don't have to learn about `./constants`.
 */
export const VAULT_DEFAULT_FOLDER_NAME = DEFAULT_VAULT_FOLDER_NAME;
