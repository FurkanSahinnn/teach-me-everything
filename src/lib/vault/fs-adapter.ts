// Phase 7.3 — Thin Tauri-fs adapter. Lazy dynamic-imports so the plugins
// are tree-shaken out of the web bundle when the caller is gated by
// `isTauriEnv()`. Each function follows the same shape as the underlying
// plugin call but normalises errors into a single `VaultFsError` so the
// UI doesn't have to know which Tauri plugin threw.
//
// Phase 7.4 — extended with read/stat/readDir/remove/rename for two-way
// sync. `_setVaultFsForTests` now accepts `Partial<VaultFsImpl>` so test
// callers can stub just the methods they care about and the rest fall
// back to safe no-ops.
//
// Test seam: `_setVaultFsForTests({...})` swaps the impl in for unit tests
// without needing a real Tauri runtime. The exported async functions read
// the override before falling through to the real plugin.

import { isTauriEnvWithOverride } from "@/lib/tauri/env";

export class VaultFsError extends Error {
  readonly cause?: unknown;
  readonly path?: string | undefined;
  constructor(message: string, opts?: { cause?: unknown; path?: string }) {
    super(message);
    this.name = "VaultFsError";
    if (opts?.cause !== undefined) this.cause = opts.cause;
    if (opts?.path !== undefined) this.path = opts.path;
  }
}

export type VaultFileStat = {
  size: number;
  mtimeMs: number | null;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
};

export type VaultDirEntry = {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
};

export type VaultFsImpl = {
  writeTextFile: (path: string, content: string) => Promise<void>;
  mkdir: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  readTextFile: (path: string) => Promise<string>;
  stat: (path: string) => Promise<VaultFileStat>;
  readDir: (path: string) => Promise<VaultDirEntry[]>;
  remove: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
  openDirectoryDialog: (opts?: {
    defaultPath?: string;
    title?: string;
  }) => Promise<string | null>;
  documentDir: () => Promise<string>;
  homeDir: () => Promise<string>;
  sep: () => string;
};

const defaultNoopImpl: VaultFsImpl = {
  writeTextFile: async () => {},
  mkdir: async () => {},
  exists: async () => false,
  readTextFile: async () => "",
  stat: async () => ({
    size: 0,
    mtimeMs: null,
    isDirectory: false,
    isFile: false,
    isSymlink: false,
  }),
  readDir: async () => [],
  remove: async () => {},
  rename: async () => {},
  openDirectoryDialog: async () => null,
  documentDir: async () => "",
  homeDir: async () => "",
  sep: () => "/",
};

let testOverride: VaultFsImpl | null = null;

/**
 * Test seam — swap the impl. Pass `null` to reset. Accepts a partial impl;
 * unspecified methods are filled with safe no-op defaults so call sites
 * that only care about a subset of operations don't have to enumerate the
 * whole interface.
 */
export function _setVaultFsForTests(impl: Partial<VaultFsImpl> | null): void {
  testOverride = impl ? { ...defaultNoopImpl, ...impl } : null;
}

async function loadImpl(): Promise<VaultFsImpl> {
  if (testOverride) return testOverride;
  if (!isTauriEnvWithOverride()) {
    throw new VaultFsError(
      "Vault filesystem operations require the Tauri runtime",
    );
  }
  const [fs, dialog, pathMod] = await Promise.all([
    import("@tauri-apps/plugin-fs") as Promise<typeof import("@tauri-apps/plugin-fs")>,
    import("@tauri-apps/plugin-dialog") as Promise<typeof import("@tauri-apps/plugin-dialog")>,
    import("@tauri-apps/api/path") as Promise<typeof import("@tauri-apps/api/path")>,
  ]);
  return {
    writeTextFile: (path, content) => fs.writeTextFile(path, content),
    mkdir: (path, opts) => fs.mkdir(path, { recursive: opts?.recursive ?? false }),
    exists: (path) => fs.exists(path),
    readTextFile: (path) => fs.readTextFile(path),
    stat: async (path) => {
      const info = await fs.stat(path);
      const mtime = info.mtime;
      return {
        size: info.size,
        mtimeMs:
          mtime instanceof Date && !Number.isNaN(mtime.getTime())
            ? mtime.getTime()
            : null,
        isDirectory: info.isDirectory,
        isFile: info.isFile,
        isSymlink: info.isSymlink,
      };
    },
    readDir: async (path) => {
      const entries = await fs.readDir(path);
      return entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory,
        isFile: entry.isFile,
        isSymlink: entry.isSymlink,
      }));
    },
    remove: (path, opts) =>
      fs.remove(path, opts?.recursive ? { recursive: true } : {}),
    rename: (oldPath, newPath) => fs.rename(oldPath, newPath),
    openDirectoryDialog: async (opts) => {
      const picked = await dialog.open({
        directory: true,
        multiple: false,
        ...(opts?.defaultPath ? { defaultPath: opts.defaultPath } : {}),
        ...(opts?.title ? { title: opts.title } : {}),
      });
      if (picked === null) return null;
      if (Array.isArray(picked)) return picked[0] ?? null;
      return picked;
    },
    documentDir: () => pathMod.documentDir(),
    homeDir: () => pathMod.homeDir(),
    sep: () => pathMod.sep(),
  };
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  try {
    const impl = await loadImpl();
    await impl.writeTextFile(path, content);
  } catch (err) {
    if (err instanceof VaultFsError) throw err;
    throw new VaultFsError(`writeTextFile failed at ${path}`, {
      cause: err,
      path,
    });
  }
}

export async function mkdirRecursive(path: string): Promise<void> {
  try {
    const impl = await loadImpl();
    await impl.mkdir(path, { recursive: true });
  } catch (err) {
    if (err instanceof VaultFsError) throw err;
    // Tauri's fs.mkdir is not idempotent — it errors with "path already
    // exists" instead of being a no-op. Swallow that one case so the
    // export loop can blindly call mkdir on every folder.
    const msg = err instanceof Error ? err.message : String(err);
    if (/already\s+exists|EEXIST/i.test(msg)) return;
    throw new VaultFsError(`mkdir failed at ${path}`, { cause: err, path });
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    const impl = await loadImpl();
    return await impl.exists(path);
  } catch {
    return false;
  }
}

export async function openDirectoryDialog(opts?: {
  defaultPath?: string;
  title?: string;
}): Promise<string | null> {
  const impl = await loadImpl();
  return impl.openDirectoryDialog(opts);
}

/** Resolve the platform default vault path: documents dir + folder name. */
export async function resolveDefaultVaultPath(folderName: string): Promise<string> {
  const impl = await loadImpl();
  const sep = impl.sep();
  try {
    const docs = await impl.documentDir();
    return `${docs.replace(/[\\/]+$/, "")}${sep}${folderName}`;
  } catch {
    // Some Linux distros don't expose XDG_DOCUMENTS_DIR; fall back to home.
    const home = await impl.homeDir();
    return `${home.replace(/[\\/]+$/, "")}${sep}${folderName}`;
  }
}

export async function readTextFile(path: string): Promise<string> {
  try {
    const impl = await loadImpl();
    return await impl.readTextFile(path);
  } catch (err) {
    if (err instanceof VaultFsError) throw err;
    throw new VaultFsError(`readTextFile failed at ${path}`, {
      cause: err,
      path,
    });
  }
}

export async function statPath(path: string): Promise<VaultFileStat> {
  try {
    const impl = await loadImpl();
    return await impl.stat(path);
  } catch (err) {
    if (err instanceof VaultFsError) throw err;
    throw new VaultFsError(`stat failed at ${path}`, { cause: err, path });
  }
}

export async function readDirectory(path: string): Promise<VaultDirEntry[]> {
  try {
    const impl = await loadImpl();
    return await impl.readDir(path);
  } catch (err) {
    if (err instanceof VaultFsError) throw err;
    throw new VaultFsError(`readDir failed at ${path}`, { cause: err, path });
  }
}

export async function removeFile(
  path: string,
  opts?: { recursive?: boolean },
): Promise<void> {
  try {
    const impl = await loadImpl();
    await impl.remove(path, opts);
  } catch (err) {
    if (err instanceof VaultFsError) throw err;
    throw new VaultFsError(`remove failed at ${path}`, { cause: err, path });
  }
}

export async function renameFile(
  oldPath: string,
  newPath: string,
): Promise<void> {
  try {
    const impl = await loadImpl();
    await impl.rename(oldPath, newPath);
  } catch (err) {
    if (err instanceof VaultFsError) throw err;
    throw new VaultFsError(`rename failed from ${oldPath} to ${newPath}`, {
      cause: err,
      path: oldPath,
    });
  }
}
