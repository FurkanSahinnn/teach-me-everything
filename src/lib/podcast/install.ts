// Phase 11.A — Lazy install helpers for TTS voice models.
//
// Each helper proxies a Rust command behind an `isTauriEnvWithOverride`
// gate so the web build can call into the install API without crashing
// (the modal still renders, but the actions report `not_supported`).
//
// `installVoice` streams a Hugging Face download into
// `appDataDir/tts-models/piper/<voiceId>/` atomically (write to .tmp,
// then rename). The Rust side emits a `tts://install/progress` event
// every ~256KB so the modal can render a live progress bar; the JS
// wrapper exposes a simple `onProgress` callback that proxies the
// event payload to the caller.

import { isTauriEnvWithOverride } from "@/lib/tauri/env";
import type { TtsProviderId } from "./adapter";

export type InstalledVoice = {
  provider: TtsProviderId;
  voiceId: string;
  sizeBytes: number;
  installedAt: number;
};

export type InstallProgress = {
  voiceId: string;
  downloadedBytes: number;
  totalBytes: number;
};

export type InstallError =
  | { kind: "not_supported" }
  | { kind: "network"; message: string }
  | { kind: "disk_full"; required: number }
  | { kind: "invalid_voice_id"; voiceId: string }
  | { kind: "binary_missing" }
  | { kind: "unknown"; message: string };

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
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

export function _setTauriApisForTests(api: {
  invoke?: TauriInvoke | null;
  event?: TauriEventApi | null;
}): void {
  if (api.invoke !== undefined) cachedInvoke = api.invoke;
  if (api.event !== undefined) cachedEventApi = api.event;
}

/**
 * List voices installed under `appDataDir/tts-models/`. Empty on web
 * (no Tauri APIs available). The Rust side scans every provider folder
 * so the Settings → Modeller panel can show a cross-provider listing.
 */
export async function listInstalledVoices(): Promise<InstalledVoice[]> {
  const invoke = await getInvoke();
  if (!invoke) return [];
  return invoke<InstalledVoice[]>("tts_list_installed_voices");
}

/**
 * Download and install a voice model. Resolves once the .onnx + .json
 * pair has been written to disk and verified. `onProgress` is called
 * with cumulative byte counts so the modal can render a progress bar.
 *
 * Web mode short-circuits with `not_supported` — the install modal
 * shows "Bu özellik yalnızca masaüstü uygulamasında" in that branch.
 */
export async function installVoice(args: {
  provider: TtsProviderId;
  voiceId: string;
  onProgress?: (p: InstallProgress) => void;
  signal?: AbortSignal;
}): Promise<InstalledVoice> {
  const invoke = await getInvoke();
  if (!invoke) {
    const err: InstallError = { kind: "not_supported" };
    throw new Error(JSON.stringify(err));
  }
  let unlisten: (() => void) | undefined;
  try {
    if (args.onProgress) {
      const eventApi = await getEventApi();
      if (eventApi) {
        unlisten = await eventApi.listen<InstallProgress>(
          "tts://install/progress",
          (e) => {
            if (e.payload.voiceId === args.voiceId) args.onProgress?.(e.payload);
          },
        );
      }
    }
    if (args.signal?.aborted) {
      throw new Error("aborted");
    }
    return await invoke<InstalledVoice>("tts_install_voice", {
      provider: args.provider,
      voiceId: args.voiceId,
    });
  } finally {
    unlisten?.();
  }
}

/**
 * Delete an installed voice. No-op on web. The Settings → Modeller list
 * uses this to free disk when a user wants to swap voices.
 */
export async function deleteVoice(args: {
  provider: TtsProviderId;
  voiceId: string;
}): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  await invoke<void>("tts_delete_voice", {
    provider: args.provider,
    voiceId: args.voiceId,
  });
}

/**
 * Quick check: is a specific voice already installed? Used by the
 * GenerateScriptModal to skip the install modal when the user already
 * has the needed voices for both speakers.
 */
export async function isVoiceInstalled(args: {
  provider: TtsProviderId;
  voiceId: string;
}): Promise<boolean> {
  const installed = await listInstalledVoices();
  return installed.some(
    (v) => v.provider === args.provider && v.voiceId === args.voiceId,
  );
}
