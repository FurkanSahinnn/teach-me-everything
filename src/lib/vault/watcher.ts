// Phase 7.4.B — vault filesystem watcher.
//
// Wraps Tauri 2.x `@tauri-apps/plugin-fs.watch` (debounced variant) so
// the reconciliation engine in 7.4.C receives a normalised event stream:
//
//   { kind: "create" | "modify" | "remove" | "other", path: string }
//
// Filters applied at the watcher boundary:
//   1. Non-remove events require the `*.md` extension. Folder writes
//      and unrelated files (e.g. `.DS_Store`, Obsidian's `.obsidian/`
//      configs) are ignored.
//   2. Remove events skip the `.md` gate so folder removes can flow
//      through to the reconciliation engine — which expands them into
//      per-note synthetic remove events via `expandFolderRemoves`
//      (Phase 7.4.E folder cascade). A folder remove path obviously
//      doesn't end in `.md`; we let the cascade decide whether it
//      shadows any indexed notes.
//   3. Skip `.tmp.*` (atomic-write intermediate files).
//   4. Skip `.tme-lock` (cross-process sentinel, populated by 7.4.G).
//   5. Skip paths inside the active watcher-suppression window — i.e.
//      writes WE just did via `atomicWriteTextFile`.
//
// Caller passes `onChange(events)` which fires once per debounce
// window. The returned handle exposes `.stop()` which awaits the Tauri
// unwatch (the underlying notify-rs thread needs a moment to tear down,
// hence the async).

import { isTauriEnvWithOverride } from "@/lib/tauri/env";
import { VaultFsError } from "./fs-adapter";
import { wasRecentlyWritten } from "./watcher-suppression";

export type VaultWatchEventKind = "create" | "modify" | "remove" | "other";

export type VaultWatchEvent = {
  kind: VaultWatchEventKind;
  path: string;
};

export type StartVaultWatcherOpts = {
  rootPath: string;
  onChange: (events: VaultWatchEvent[]) => void;
  delayMs?: number;
  recursive?: boolean;
};

export type VaultWatcherHandle = {
  stop: () => Promise<void>;
};

export type VaultWatcherImpl = {
  watch: (
    rootPath: string,
    cb: (events: VaultWatchEvent[]) => void,
    opts: { recursive: boolean; delayMs: number },
  ) => Promise<() => Promise<void>>;
};

let testWatcherImpl: VaultWatcherImpl | null = null;

/** Test seam — swap the watcher impl. Pass `null` to reset. */
export function _setWatcherImplForTests(
  impl: VaultWatcherImpl | null,
): void {
  testWatcherImpl = impl;
}

export async function startVaultWatcher(
  opts: StartVaultWatcherOpts,
): Promise<VaultWatcherHandle> {
  const impl = await loadWatcherImpl();
  const delayMs = opts.delayMs ?? 500;
  const recursive = opts.recursive ?? true;
  const unwatch = await impl.watch(
    opts.rootPath,
    (rawEvents) => {
      const filtered = filterEvents(rawEvents);
      if (filtered.length > 0) opts.onChange(filtered);
    },
    { recursive, delayMs },
  );
  return {
    stop: async () => {
      await unwatch();
    },
  };
}

export function filterEvents(events: VaultWatchEvent[]): VaultWatchEvent[] {
  const out: VaultWatchEvent[] = [];
  for (const e of events) {
    if (isTempFile(e.path)) continue;
    if (isLockFile(e.path)) continue;
    if (wasRecentlyWritten(e.path)) continue;
    // Phase 7.4.E — let folder-remove events through the `.md` gate so
    // `expandFolderRemoves` can fan them out into per-note synthetic
    // events. Non-remove kinds still require `.md` because a random
    // create/modify on a non-note file is just noise.
    if (e.kind !== "remove" && !isMarkdownPath(e.path)) continue;
    out.push(e);
  }
  return out;
}

export function isMarkdownPath(path: string): boolean {
  // `.md` strict — `.md.tmp.<suffix>` would match without anchoring, so
  // require end-of-string. `.md` (case-insensitive) is the only note
  // extension the export pipeline produces.
  return /\.md$/i.test(path);
}

export function isTempFile(path: string): boolean {
  // Matches `<basename>.md.tmp.<suffix>` emitted by atomic-write.ts.
  // Supports both POSIX and Windows separators in the path.
  return /\.tmp\.[^/\\]+$/i.test(path);
}

export function isLockFile(path: string): boolean {
  // `.tme-lock` sentinel — bare basename or any path ending in it.
  return /(^|[/\\])\.tme-lock$/i.test(path);
}

async function loadWatcherImpl(): Promise<VaultWatcherImpl> {
  if (testWatcherImpl) return testWatcherImpl;
  if (!isTauriEnvWithOverride()) {
    throw new VaultFsError("Vault watcher requires the Tauri runtime");
  }
  const fs = await import("@tauri-apps/plugin-fs");
  return {
    watch: async (rootPath, cb, watchOpts) => {
      const unwatch = await fs.watch(
        rootPath,
        (rawEvent) => {
          const normalised = normaliseTauriEvents(rawEvent);
          if (normalised.length > 0) cb(normalised);
        },
        { recursive: watchOpts.recursive, delayMs: watchOpts.delayMs },
      );
      return async () => {
        await unwatch();
      };
    },
  };
}

export function normaliseTauriEvents(raw: unknown): VaultWatchEvent[] {
  const array = Array.isArray(raw) ? raw : [raw];
  const out: VaultWatchEvent[] = [];
  for (const e of array) {
    if (!e || typeof e !== "object") continue;
    const kind = mapEventKind((e as { type?: unknown }).type);
    const paths = (e as { paths?: unknown }).paths;
    if (!Array.isArray(paths)) continue;
    for (const p of paths) {
      if (typeof p === "string" && p.length > 0) {
        out.push({ kind, path: p });
      }
    }
  }
  return out;
}

function mapEventKind(t: unknown): VaultWatchEventKind {
  if (typeof t === "string") {
    if (t === "create" || t === "modify" || t === "remove") return t;
    return "other";
  }
  if (t && typeof t === "object") {
    const obj = t as Record<string, unknown>;
    if ("create" in obj) return "create";
    if ("modify" in obj) return "modify";
    if ("remove" in obj) return "remove";
  }
  return "other";
}
