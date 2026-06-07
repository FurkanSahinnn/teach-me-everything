// Phase 11.A — Provider-agnostic voice catalog.
//
// Pre-Phase-11 this file hand-carried five ElevenLabs starter-library
// voice ids. Voices now come from whichever `TtsAdapter` is active so
// adding a new engine (Kokoro / XTTS / VibeVoice in 11.D) doesn't
// require touching the modal — it just reads from the registry.
//
// `buildVoicesFromPicks` adapts the picker output into the
// `PodcastRecord.voices` shape the synthesis pipeline writes onto a
// row. The `voiceId` value here is opaque per-provider — Piper uses
// model file names, Web Speech uses generic locale tags.

import "./adapters";

import { getAdapter, type TtsAdapter, type TtsProviderId } from "./adapter";
import type { PodcastSpeaker, PodcastVoice } from "./types";

// Kept as an exported constant so the modal can label the picker with a
// human-readable provider name. Phase 11.C surfaces a Settings dropdown
// for switching providers; until then the value tracks `prefs.ttsProvider`.
export const DEFAULT_TTS_PROVIDER: TtsProviderId = "piper";

// The synthesis pipeline doesn't need a separate "model id" field — the
// model is implicit in the active adapter + voice id. We keep the constant
// for backwards compatibility with code paths that still pass it through
// (and to make pricing snapshots easy to retire later).
export const DEFAULT_TTS_MODEL_ID = "piper-default";

export type VoicePickerEntry = {
  voiceId: string;
  name: string;
  description: { tr: string; en: string };
  nativeLocale: "tr" | "en" | "es" | "fr" | "de";
  speaker: PodcastSpeaker;
};

/**
 * Return voices for the active provider grouped by speaker. The
 * GenerateScriptModal renders one chip row per speaker.
 */
export function listVoicesForProvider(
  providerId: TtsProviderId,
): VoicePickerEntry[] {
  const adapter = safeGetAdapter(providerId);
  if (!adapter) return [];
  return adapter.listVoices().map((v) => ({
    voiceId: v.voiceId,
    name: v.name,
    description: v.description,
    nativeLocale: v.nativeLocale,
    speaker: v.speaker,
  }));
}

export function listVoicesForSpeaker(
  providerId: TtsProviderId,
  speaker: PodcastSpeaker,
): VoicePickerEntry[] {
  return listVoicesForProvider(providerId).filter((v) => v.speaker === speaker);
}

/**
 * Default picks for the picker — first matching voice per speaker. UI
 * pre-selects these so a brand-new user can hit "Generate" without
 * touching the voice rows.
 */
export function getDefaultVoicePicks(providerId: TtsProviderId): {
  alev: string;
  deniz: string;
} {
  const adapter = safeGetAdapter(providerId);
  if (!adapter) {
    return { alev: "", deniz: "" };
  }
  return {
    alev: adapter.getDefaultVoiceForSpeaker("alev"),
    deniz: adapter.getDefaultVoiceForSpeaker("deniz"),
  };
}

/**
 * Adapt user's voice picks into the `PodcastRecord.voices` shape. Throws
 * a plain `Error` (not TtsAdapterError) so the modal's `catch (err)` can
 * surface the message unchanged.
 */
export function buildVoicesFromPicks(args: {
  providerId: TtsProviderId;
  picks: { alev: string; deniz: string };
}): PodcastVoice[] {
  const adapter = safeGetAdapter(args.providerId);
  if (!adapter) {
    throw new Error(`Unknown TTS provider: ${args.providerId}`);
  }
  const voices = adapter.listVoices();
  const alev = voices.find(
    (v) => v.speaker === "alev" && v.voiceId === args.picks.alev,
  );
  const deniz = voices.find(
    (v) => v.speaker === "deniz" && v.voiceId === args.picks.deniz,
  );
  if (!alev) throw new Error(`Invalid alev voice: ${args.picks.alev}`);
  if (!deniz) throw new Error(`Invalid deniz voice: ${args.picks.deniz}`);
  return [
    { speaker: "alev", name: alev.name, voiceId: alev.voiceId, role: "learner" },
    {
      speaker: "deniz",
      name: deniz.name,
      voiceId: deniz.voiceId,
      role: "expert",
    },
  ];
}

function safeGetAdapter(id: TtsProviderId): TtsAdapter | null {
  try {
    return getAdapter(id);
  } catch {
    return null;
  }
}

// === Phase 11.C — Settings Model Manager helpers ===
//
// These pure functions back the Settings → Modeller → TTS panel without
// pulling React state or Tauri commands into the catalog module. Each one
// takes the live "installed" list as an argument so the caller controls
// freshness (the panel re-fetches after install/delete actions).

export type InstalledVoiceRef = {
  provider: TtsProviderId;
  voiceId: string;
  sizeBytes: number;
};

/**
 * Catalog entries the user could still install for this provider — the
 * full provider catalog minus what's already on disk. Used to render the
 * "Yüklenebilir Modeller" list.
 *
 * Some catalogs intentionally surface the same voice under multiple
 * speakers (e.g. Piper's `tr_TR-dfki-medium` shows under both alev and
 * deniz rows in the picker so a user with a single TR voice can still
 * staff a two-character podcast). Installation is a per-voiceId concern
 * though, so we dedupe by voiceId before returning — otherwise the
 * Settings install list would render the same row twice and React
 * would warn about duplicate keys.
 */
export function getAvailableVoices(
  providerId: TtsProviderId,
  installed: ReadonlyArray<InstalledVoiceRef>,
): VoicePickerEntry[] {
  const installedIds = new Set(
    installed
      .filter((v) => v.provider === providerId)
      .map((v) => v.voiceId),
  );
  const seen = new Set<string>();
  return listVoicesForProvider(providerId).filter((v) => {
    if (installedIds.has(v.voiceId)) return false;
    if (seen.has(v.voiceId)) return false;
    seen.add(v.voiceId);
    return true;
  });
}

/**
 * Installed voices for this provider, joined with their catalog metadata
 * so the list row can render display name + description without a second
 * lookup. Voices on disk that are NOT in the active provider's catalog
 * (e.g. user dropped a custom .onnx in there) get a "(custom)" placeholder
 * so they still render and stay deletable.
 */
export function getInstalledVoiceCatalog(
  providerId: TtsProviderId,
  installed: ReadonlyArray<InstalledVoiceRef>,
): Array<VoicePickerEntry & { sizeBytes: number; isCustom: boolean }> {
  const catalog = listVoicesForProvider(providerId);
  const catalogById = new Map(catalog.map((v) => [v.voiceId, v]));
  return installed
    .filter((v) => v.provider === providerId)
    .map((v) => {
      const meta = catalogById.get(v.voiceId);
      if (meta) {
        return { ...meta, sizeBytes: v.sizeBytes, isCustom: false };
      }
      return {
        voiceId: v.voiceId,
        name: v.voiceId,
        description: {
          tr: "Katalog dışı / özel",
          en: "Outside catalog / custom",
        },
        nativeLocale: "en" as const,
        speaker: "alev" as const,
        sizeBytes: v.sizeBytes,
        isCustom: true,
      };
    });
}

/**
 * Sum of `sizeBytes` for all installed voices in the given provider.
 * Surfaces under the Installed list as "Toplam: 126 MB".
 */
export function getInstalledDiskUsageBytes(
  providerId: TtsProviderId,
  installed: ReadonlyArray<InstalledVoiceRef>,
): number {
  return installed
    .filter((v) => v.provider === providerId)
    .reduce((sum, v) => sum + v.sizeBytes, 0);
}

/**
 * Has the user installed at least one voice for this provider? Drives the
 * "fully installed" badge in the dropdown and the GenerateScriptModal's
 * skip-install-modal decision.
 */
export function isProviderUsable(
  providerId: TtsProviderId,
  installed: ReadonlyArray<InstalledVoiceRef>,
): boolean {
  // Web Speech doesn't require a download; it's "usable" wherever its
  // adapter probe doesn't report not-supported-on-platform. Compatibility
  // is the panel's job — here we just say "yes, no install needed."
  if (providerId === "web-speech") return true;
  return installed.some((v) => v.provider === providerId);
}
