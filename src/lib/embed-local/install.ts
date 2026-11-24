// Lazy install & disk management helpers for local ONNX embedding models.
//
// Desktop (Tauri):
//   Proxies the Rust `embed_*` commands (`src-tauri/src/embed.rs`), which
//   stream model files from Hugging Face into `appDataDir/embed-models/<id>/`
//   atomically (`.download.tmp` → rename) and emit `embed://install/progress`.
//
// Web dev fallback:
//   When Tauri IPC is absent and the browser Cache API (`caches`) is available,
//   downloads the files into `CacheStorage` (`tme-embed-models-v1`) and records
//   installed metadata in `localStorage` so web dev builds can also install,
//   test, and delete local embedding models.

import { isTauriEnvWithOverride } from "@/lib/tauri/env";
import {
  getLocalEmbedSpec,
  type LocalEmbedModelId,
} from "./catalog";

export type InstalledEmbedModel = {
  modelId: LocalEmbedModelId;
  hfRepo: string;
  sizeBytes: number;
  installedAt: number;
};

export type EmbedInstallProgress = {
  modelId: LocalEmbedModelId;
  downloadedBytes: number;
  totalBytes: number;
};

export type EmbedReadinessResponse = {
  state: "ready" | "missing-model";
  modelId: LocalEmbedModelId;
  sizeBytes?: number;
};

export const WEB_EMBED_CACHE_NAME = "tme-embed-models-v1";
const WEB_MANIFEST_KEY = "tme:web-installed-embed-models";

type TauriInvoke = <T>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;
type TauriEventApi = {
  listen: <T>(
    event: string,
    handler: (e: { payload: T }) => void,
  ) => Promise<() => void>;
};

let cachedInvoke: TauriInvoke | null = null;
let cachedEventApi: TauriEventApi | null = null;

async function getInvoke(): Promise<TauriInvoke | null> {
  if (cachedInvoke) return cachedInvoke;
  if (!isTauriEnvWithOverride()) return null;
  try {
    const mod = (await import("@tauri-apps/api/core")) as {
      invoke: TauriInvoke;
    };
    cachedInvoke = mod.invoke;
    return cachedInvoke;
  } catch {
    return null;
  }
}

async function getEventApi(): Promise<TauriEventApi | null> {
  if (cachedEventApi) return cachedEventApi;
  if (!isTauriEnvWithOverride()) return null;
  try {
    const mod = (await import("@tauri-apps/api/event")) as TauriEventApi;
    cachedEventApi = mod;
    return cachedEventApi;
  } catch {
    return null;
  }
}

export function _setTauriEmbedApisForTests(api: {
  invoke?: TauriInvoke | null;
  event?: TauriEventApi | null;
}): void {
  if (api.invoke !== undefined) cachedInvoke = api.invoke;
  if (api.event !== undefined) cachedEventApi = api.event;
}

function readWebManifest(): InstalledEmbedModel[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(WEB_MANIFEST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is InstalledEmbedModel =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as InstalledEmbedModel).modelId === "string" &&
        typeof (item as InstalledEmbedModel).hfRepo === "string" &&
        typeof (item as InstalledEmbedModel).sizeBytes === "number" &&
        typeof (item as InstalledEmbedModel).installedAt === "number",
    );
  } catch {
    return [];
  }
}

function writeWebManifest(list: InstalledEmbedModel[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WEB_MANIFEST_KEY, JSON.stringify(list));
  } catch {
    /* ignore storage quota errors */
  }
}

export function hfResolveUrl(hfRepo: string, relativePath: string): string {
  return `https://huggingface.co/${hfRepo}/resolve/main/${relativePath}`;
}

/**
 * List local embedding models installed on disk (Tauri) or in Browser
 * CacheStorage (web dev).
 */
export async function listInstalledEmbedModels(): Promise<
  InstalledEmbedModel[]
> {
  const invoke = await getInvoke();
  if (invoke) {
    return invoke<InstalledEmbedModel[]>("embed_list_installed_models");
  }
  const entries = readWebManifest();
  const ready = await Promise.all(entries.map(async (entry) =>
    (await checkEmbedModelReadiness(entry.modelId)).state === "ready",
  ));
  return entries.filter((_, index) => ready[index]);
}

/**
 * Check whether a specific local embedding model is installed and ready.
 */
export async function checkEmbedModelReadiness(
  modelId: LocalEmbedModelId,
): Promise<EmbedReadinessResponse> {
  const invoke = await getInvoke();
  if (invoke) {
    return invoke<EmbedReadinessResponse>("embed_check_readiness", {
      modelId,
    });
  }
  const found = readWebManifest().find((m) => m.modelId === modelId);
  const spec = getLocalEmbedSpec(modelId);
  if (found && spec && typeof window !== "undefined" && "caches" in window) {
    try {
      const cache = await window.caches.open(WEB_EMBED_CACHE_NAME);
      for (const file of spec.files) {
        if (!(await cache.match(hfResolveUrl(spec.hfRepo, file)))) {
          return { state: "missing-model", modelId };
        }
      }
    } catch {
      return { state: "missing-model", modelId };
    }
    return {
      state: "ready",
      modelId,
      sizeBytes: found.sizeBytes,
    };
  }
  return { state: "missing-model", modelId };
}

/**
 * Download and install a local ONNX embedding model from Hugging Face.
 */
export async function installEmbedModel(args: {
  modelId: LocalEmbedModelId;
  onProgress?: (p: EmbedInstallProgress) => void;
  signal?: AbortSignal;
}): Promise<InstalledEmbedModel> {
  const spec = getLocalEmbedSpec(args.modelId);
  if (!spec) {
    throw new Error(`Unknown local embed model: ${args.modelId}`);
  }

  const invoke = await getInvoke();
  if (invoke) {
    let unlisten: (() => void) | undefined;
    try {
      if (args.onProgress) {
        const eventApi = await getEventApi();
        if (eventApi) {
          unlisten = await eventApi.listen<EmbedInstallProgress>(
            "embed://install/progress",
            (e) => {
              if (e.payload.modelId === args.modelId) {
                args.onProgress?.(e.payload);
              }
            },
          );
        }
      }
      if (args.signal?.aborted) {
        throw new Error("aborted");
      }
      return await invoke<InstalledEmbedModel>("embed_install_model", {
        modelId: args.modelId,
        hfRepo: spec.hfRepo,
        files: spec.files,
        expectedBytes: spec.sizeBytes,
      });
    } finally {
      unlisten?.();
    }
  }

  // Web dev fallback using CacheStorage (or direct fetch verification).
  if (typeof window === "undefined" || !("caches" in window)) {
    throw new Error("CacheStorage is required to install a local model in the browser");
  }
  const cache = await window.caches.open(WEB_EMBED_CACHE_NAME);

  let downloadedBytes = 0;
  const totalBytes = spec.sizeBytes;
  args.onProgress?.({
    modelId: args.modelId,
    downloadedBytes: 0,
    totalBytes,
  });

  for (const relPath of spec.files) {
    if (args.signal?.aborted) {
      throw new Error("aborted");
    }
    const url = hfResolveUrl(spec.hfRepo, relPath);
    const resp = await fetch(url, {
      ...(args.signal ? { signal: args.signal } : {}),
    });
    if (!resp.ok) {
      throw new Error(
        `Download failed for ${relPath}: HTTP ${resp.status}`,
      );
    }

    const reader = resp.body?.getReader();
    const chunks: Uint8Array[] = [];
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          downloadedBytes += value.byteLength;
          args.onProgress?.({
            modelId: args.modelId,
            downloadedBytes,
            totalBytes: Math.max(totalBytes, downloadedBytes),
          });
        }
      }
      if (cache) {
        const blob = new Blob(chunks as BlobPart[], {
          type:
            resp.headers.get("content-type") ?? "application/octet-stream",
        });
        await cache.put(
          url,
          new Response(blob, {
            status: 200,
            headers: {
              "content-type":
                resp.headers.get("content-type") ?? "application/octet-stream",
            },
          }),
        );
      }
    } else {
      const buf = await resp.arrayBuffer();
      downloadedBytes += buf.byteLength;
      args.onProgress?.({
        modelId: args.modelId,
        downloadedBytes,
        totalBytes: Math.max(totalBytes, downloadedBytes),
      });
      if (cache) {
        await cache.put(url, new Response(buf, { status: 200 }));
      }
    }
  }

  const entry: InstalledEmbedModel = {
    modelId: args.modelId,
    hfRepo: spec.hfRepo,
    sizeBytes: downloadedBytes > 0 ? downloadedBytes : spec.sizeBytes,
    installedAt: Date.now(),
  };
  const current = readWebManifest().filter((m) => m.modelId !== args.modelId);
  writeWebManifest([...current, entry]);
  return entry;
}

/**
 * Delete an installed local embedding model from disk (Tauri) or Browser
 * CacheStorage (web dev).
 */
export async function deleteEmbedModel(args: {
  modelId: LocalEmbedModelId;
}): Promise<void> {
  const invoke = await getInvoke();
  if (invoke) {
    await invoke<void>("embed_delete_model", {
      modelId: args.modelId,
    });
    return;
  }

  const spec = getLocalEmbedSpec(args.modelId);
  if (
    spec &&
    typeof window !== "undefined" &&
    "caches" in window
  ) {
    try {
      const cache = await window.caches.open(WEB_EMBED_CACHE_NAME);
      for (const relPath of spec.files) {
        await cache.delete(hfResolveUrl(spec.hfRepo, relPath));
      }
    } catch {
      /* ignore */
    }
  }
  const next = readWebManifest().filter((m) => m.modelId !== args.modelId);
  writeWebManifest(next);
}

export async function isEmbedModelInstalled(
  modelId: LocalEmbedModelId,
): Promise<boolean> {
  const res = await checkEmbedModelReadiness(modelId);
  return res.state === "ready";
}
