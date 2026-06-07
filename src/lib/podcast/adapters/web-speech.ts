// Phase 11.A — Web Speech API fallback adapter.
//
// Reality check: standard browser `speechSynthesis` cannot route audio
// through Web Audio for capture. There is no portable way to record
// SpeechSynthesisUtterance output to an ArrayBuffer (MediaRecorder won't
// pick it up, OfflineAudioContext can't ingest it). So this adapter
// reports `not-supported-on-platform` from `checkReadiness` whenever the
// browser path is taken; the podcast modal then routes the user toward
// the desktop app.
//
// It still ships on every build so the registry shape is identical
// across web and Tauri, and so a future "live preview" surface that
// plays segments through speakers (rather than producing a saved WAV)
// can reuse the voice catalog without rewiring the orchestrator.

import {
  registerAdapter,
  TtsAdapterError,
  type SynthesizeArgs,
  type SynthesizeResult,
  type TtsAdapter,
  type TtsReadinessState,
  type TtsVoice,
} from "../adapter";
import type { PodcastSpeaker } from "../types";

// Locale-tagged generic voices. The voice ids stay abstract (`female-tr`)
// so a future live-preview surface can map them onto whichever native
// voice the OS happens to expose without persisting a brittle voice URI.
const VOICES: TtsVoice[] = [
  {
    voiceId: "female-tr",
    name: "Sistem (Kadın · TR)",
    speaker: "alev",
    description: {
      tr: "İşletim sistemi varsayılan kadın sesi",
      en: "Operating-system default female voice",
    },
    nativeLocale: "tr",
  },
  {
    voiceId: "male-tr",
    name: "Sistem (Erkek · TR)",
    speaker: "deniz",
    description: {
      tr: "İşletim sistemi varsayılan erkek sesi",
      en: "Operating-system default male voice",
    },
    nativeLocale: "tr",
  },
];

const adapter: TtsAdapter = {
  id: "web-speech",
  async checkReadiness(): Promise<TtsReadinessState> {
    return {
      kind: "not-supported-on-platform",
      reason:
        "Web Speech API does not expose audio capture. Use the desktop app for podcast generation.",
    };
  },
  listVoices(): TtsVoice[] {
    return VOICES.slice();
  },
  getDefaultVoiceForSpeaker(speaker: PodcastSpeaker): string {
    return speaker === "alev" ? "female-tr" : "male-tr";
  },
  async synthesize(_args: SynthesizeArgs): Promise<SynthesizeResult> {
    throw new TtsAdapterError(
      "not_ready",
      "Web Speech adapter cannot produce saved audio in browser. Open the desktop app.",
      "web-speech",
    );
  },
};

registerAdapter(adapter);

export const webSpeechAdapter = adapter;
