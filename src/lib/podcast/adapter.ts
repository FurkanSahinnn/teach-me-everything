// Phase 11.A — Provider-agnostic TTS adapter contract. Replaces the
// hardcoded ElevenLabs HTTP client with a small interface every backend
// (Piper sidecar / Web Speech API / future Kokoro / XTTS / VibeVoice)
// implements. The orchestrator in `synthesize.ts` resolves an adapter
// once per podcast run from `prefs.ttsProvider`, then loops segments
// through the adapter without knowing which engine is downstream.
//
// Design choices:
//   - `synthesize` returns ArrayBuffer + mimeType so the audio-assembler
//     can decode any container the engine emits (decodeAudioData ingests
//     both WAV and MP3). Engines that emit raw PCM should wrap into WAV
//     before returning so the consumer never branches on format.
//   - `checkReadiness` lets callers gate the UI on a just-in-time install
//     modal without having to special-case provider ids. The state
//     enum is explicit (`missing-binary` vs `missing-model` vs
//     `not-supported-on-platform`) so the modal can route the user to
//     the right action surface.
//   - Voice catalogs are per-provider. Each adapter exposes its own
//     `listVoices()` keyed by `PodcastSpeaker`; UI builds a picker from
//     whichever adapter is active. Voice ids are free-form strings — a
//     locale tag for Web Speech, a model file name for Piper, etc.

import type { PodcastSpeaker } from "./types";

// Keep this list in lockstep with `prefs.ttsProvider` and the
// `TtsProviderRegistry` map below. `web-speech` is the universally
// available fallback (browsers + Tauri webview); everything else is
// Tauri-only because they require either a sidecar binary or a
// Python server subprocess.
export type TtsProviderId =
  | "piper"
  | "web-speech"
  | "kokoro"
  | "xtts"
  | "vibevoice";

export type TtsReadinessState =
  | { kind: "ready" }
  | { kind: "missing-binary"; binaryName: string }
  | { kind: "missing-model"; modelId: string; sizeBytes?: number | undefined }
  | { kind: "not-supported-on-platform"; reason: string };

export type TtsAdapterErrorCode =
  | "not_ready"
  | "invalid_voice_id"
  | "empty_text"
  | "text_too_long"
  | "synthesis_failed"
  | "aborted";

export class TtsAdapterError extends Error {
  constructor(
    public readonly code: TtsAdapterErrorCode,
    message: string,
    public readonly providerId?: TtsProviderId,
  ) {
    super(message);
    this.name = "TtsAdapterError";
  }
}

export type TtsVoice = {
  // Per-provider opaque identifier. Piper: `tr_TR-dfki-medium`.
  // Web Speech: BCP-47 voice URI. Future Kokoro / XTTS: model+speaker tag.
  voiceId: string;
  // Display label shown in the picker.
  name: string;
  speaker: PodcastSpeaker;
  // Short description, bilingual so the picker reads naturally in either UI
  // locale.
  description: { tr: string; en: string };
  // Locale this voice was originally trained on; used by the picker to
  // surface a "fits this content" hint when locale matches the user's
  // workspace.
  nativeLocale: "tr" | "en" | "es" | "fr" | "de";
};

export type SynthesizeArgs = {
  text: string;
  voiceId: string;
  signal?: AbortSignal | undefined;
};

export type SynthesizeResult = {
  audio: ArrayBuffer;
  // MIME type the audio-assembler hands to `decodeAudioData`. Common
  // values: `audio/wav`, `audio/mpeg`.
  mimeType: string;
};

export type TtsAdapter = {
  readonly id: TtsProviderId;
  /**
   * Quick readiness probe. Cheap enough to call before every podcast run
   * — must not download anything. Returns `{kind: "ready"}` if synthesis
   * will succeed for the default voice; otherwise a discriminated state
   * the caller can surface via the install modal.
   */
  checkReadiness(): Promise<TtsReadinessState>;
  listVoices(): TtsVoice[];
  getDefaultVoiceForSpeaker(speaker: PodcastSpeaker): string;
  synthesize(args: SynthesizeArgs): Promise<SynthesizeResult>;
};

// Adapter modules register themselves on load via `registerAdapter` so
// the orchestrator doesn't need a giant switch. Tauri-only adapters
// register a no-op stub on web that resolves `not-supported-on-platform`
// from `checkReadiness` — keeps the registry shape stable across builds.
const registry = new Map<TtsProviderId, TtsAdapter>();

export function registerAdapter(adapter: TtsAdapter): void {
  registry.set(adapter.id, adapter);
}

export function getAdapter(id: TtsProviderId): TtsAdapter {
  const adapter = registry.get(id);
  if (!adapter) {
    throw new TtsAdapterError(
      "not_ready",
      `TTS adapter not registered: ${id}`,
      id,
    );
  }
  return adapter;
}

export function listRegisteredAdapters(): TtsAdapter[] {
  return Array.from(registry.values());
}

export function hasAdapter(id: TtsProviderId): boolean {
  return registry.has(id);
}

// Test affordance — lets `synthesize.dom.test.ts` swap the active
// registry for a fake adapter without touching real Tauri commands.
export function _clearAdapterRegistryForTests(): void {
  registry.clear();
}
