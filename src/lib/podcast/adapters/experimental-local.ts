// Phase 11.D — experimental heavy-provider placeholders.
//
// Kokoro / XTTS / VibeVoice are intentionally registered before their
// model runtimes ship so selecting them in Settings never falls through
// to a registry error. They expose voice catalogs and explicit readiness
// messages, but synthesize() remains blocked until the runtime-specific
// sidecar/server command is implemented.

import {
  registerAdapter,
  TtsAdapterError,
  type SynthesizeResult,
  type TtsAdapter,
  type TtsProviderId,
  type TtsReadinessState,
  type TtsVoice,
} from "../adapter";
import type { PodcastSpeaker } from "../types";

type ExperimentalProviderSpec = {
  id: Extract<TtsProviderId, "kokoro" | "xtts" | "vibevoice">;
  runtime: string;
  voices: TtsVoice[];
  defaults: Record<PodcastSpeaker, string>;
};

const SPECS: ExperimentalProviderSpec[] = [
  {
    id: "kokoro",
    runtime: "Kokoro ONNX sidecar",
    voices: [
      voice("kokoro-af_heart", "Heart", "alev", "en"),
      voice("kokoro-am_adam", "Adam", "deniz", "en"),
    ],
    defaults: { alev: "kokoro-af_heart", deniz: "kokoro-am_adam" },
  },
  {
    id: "xtts",
    runtime: "XTTS-v2 Python server",
    voices: [
      voice("xtts-tr-female-reference", "TR Female Reference", "alev", "tr"),
      voice("xtts-tr-male-reference", "TR Male Reference", "deniz", "tr"),
    ],
    defaults: {
      alev: "xtts-tr-female-reference",
      deniz: "xtts-tr-male-reference",
    },
  },
  {
    id: "vibevoice",
    runtime: "VibeVoice Python server",
    voices: [
      voice("vibevoice-speaker-1", "Speaker 1", "alev", "en"),
      voice("vibevoice-speaker-2", "Speaker 2", "deniz", "en"),
    ],
    defaults: { alev: "vibevoice-speaker-1", deniz: "vibevoice-speaker-2" },
  },
];

for (const spec of SPECS) {
  registerAdapter(createExperimentalAdapter(spec));
}

function createExperimentalAdapter(spec: ExperimentalProviderSpec): TtsAdapter {
  return {
    id: spec.id,
    async checkReadiness(): Promise<TtsReadinessState> {
      return {
        kind: "not-supported-on-platform",
        reason: `${spec.runtime} is not bundled yet. This provider is still in Phase 11.D POC.`,
      };
    },
    listVoices(): TtsVoice[] {
      return spec.voices.slice();
    },
    getDefaultVoiceForSpeaker(speaker: PodcastSpeaker): string {
      return spec.defaults[speaker];
    },
    async synthesize(): Promise<SynthesizeResult> {
      throw new TtsAdapterError(
        "not_ready",
        `${spec.runtime} is not available yet. Complete the Phase 11.D runtime POC before synthesis.`,
        spec.id,
      );
    },
  };
}

function voice(
  voiceId: string,
  name: string,
  speaker: PodcastSpeaker,
  locale: TtsVoice["nativeLocale"],
): TtsVoice {
  return {
    voiceId,
    name,
    speaker,
    nativeLocale: locale,
    description: {
      tr: "Deneysel ağır yerel sağlayıcı sesi",
      en: "Experimental heavy local provider voice",
    },
  };
}
