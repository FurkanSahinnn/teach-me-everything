// Phase 11.A — Piper TTS sidecar adapter (Tauri-only).
//
// Calls into the Rust `tts_*` commands which spawn the Piper sidecar
// binary (`binaries/piper`) and pipe segment text through stdin, then
// return the synthesized WAV bytes. The Rust side handles model file
// resolution, the binary-not-bundled case, and surfaces structured
// failures so the modal can route the user to either the install
// modal or the README setup instructions.
//
// Voice catalog: a curated subset of Rhasspy Piper's public model zoo.
// Rhasspy currently publishes only **one** Turkish voice (`dfki`,
// female-coded → alev). There is no second TR voice on Hugging Face,
// so deniz falls back to the English `ryan` voice by default. Users can
// still manually pair dfki with itself in the picker if they prefer
// single-voice TR podcasts. Heavier providers (Kokoro / XTTS in
// Phase 11.D) will add more Turkish options.

import { isTauriEnvWithOverride } from "@/lib/tauri/env";
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

const VOICES: TtsVoice[] = [
  {
    voiceId: "tr_TR-dfki-medium",
    name: "DFKI",
    speaker: "alev",
    description: {
      tr: "Doğal, anlatıcı kadın sesi (TR)",
      en: "Natural, narrator female voice (TR)",
    },
    nativeLocale: "tr",
  },
  {
    voiceId: "tr_TR-dfki-medium",
    name: "DFKI",
    speaker: "deniz",
    description: {
      tr: "Aynı TR sesi — tek dilli podcast için (TR)",
      en: "Same TR voice — for single-language podcasts (TR)",
    },
    nativeLocale: "tr",
  },
  {
    voiceId: "en_US-lessac-medium",
    name: "Lessac",
    speaker: "alev",
    description: {
      tr: "Sıcak, profesyonel kadın sesi (EN)",
      en: "Warm, professional female voice (EN)",
    },
    nativeLocale: "en",
  },
  {
    voiceId: "en_US-ryan-medium",
    name: "Ryan",
    speaker: "deniz",
    description: {
      tr: "Sakin, açıklayıcı erkek sesi (EN)",
      en: "Calm, explanatory male voice (EN)",
    },
    nativeLocale: "en",
  },
];

const DEFAULT_VOICE_BY_SPEAKER: Record<PodcastSpeaker, string> = {
  alev: "tr_TR-dfki-medium",
  deniz: "en_US-ryan-medium",
};

// Approximate ONNX model download size for the lazy-install modal copy.
// Real bytes are settled by the Rust side after fetch; this is the
// "you're about to download ~X" hint shown before the user confirms.
const VOICE_SIZE_BYTES = 63 * 1024 * 1024;

// Tauri command bridge. Module-scoped lazy import so unit tests that
// only touch the JS layer don't pay the cost of resolving the Tauri
// global on every call.
type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
let cachedInvoke: TauriInvoke | null = null;

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

// Test seam — `synthesize.dom.test.ts` injects a fake invoke so the
// adapter can be exercised without spinning up Tauri.
export function _setTauriInvokeForTests(fn: TauriInvoke | null): void {
  cachedInvoke = fn;
}

type ReadinessResponse = {
  state: "ready" | "missing-binary" | "missing-model";
  voiceId: string;
  sizeBytes?: number;
};

const adapter: TtsAdapter = {
  id: "piper",
  async checkReadiness(): Promise<TtsReadinessState> {
    const invoke = await getInvoke();
    if (!invoke) {
      return {
        kind: "not-supported-on-platform",
        reason: "Piper requires the desktop app (Tauri sidecar).",
      };
    }
    try {
      const res = await invoke<ReadinessResponse>("tts_piper_check_readiness", {
        voiceId: DEFAULT_VOICE_BY_SPEAKER.deniz,
      });
      if (res.state === "ready") return { kind: "ready" };
      if (res.state === "missing-binary") {
        return { kind: "missing-binary", binaryName: "piper" };
      }
      return {
        kind: "missing-model",
        modelId: res.voiceId,
        sizeBytes: res.sizeBytes ?? VOICE_SIZE_BYTES,
      };
    } catch (err) {
      return {
        kind: "missing-binary",
        binaryName: err instanceof Error ? err.message : "piper",
      };
    }
  },
  listVoices(): TtsVoice[] {
    return VOICES.slice();
  },
  getDefaultVoiceForSpeaker(speaker: PodcastSpeaker): string {
    return DEFAULT_VOICE_BY_SPEAKER[speaker];
  },
  async synthesize(args: SynthesizeArgs): Promise<SynthesizeResult> {
    const text = args.text;
    if (!text || text.trim().length === 0) {
      throw new TtsAdapterError("empty_text", "text is empty", "piper");
    }
    if (!args.voiceId) {
      throw new TtsAdapterError(
        "invalid_voice_id",
        "voiceId is required",
        "piper",
      );
    }
    const invoke = await getInvoke();
    if (!invoke) {
      throw new TtsAdapterError(
        "not_ready",
        "Piper requires the desktop app.",
        "piper",
      );
    }
    if (args.signal?.aborted) {
      throw new TtsAdapterError(
        "aborted",
        "Synthesis aborted before invocation",
        "piper",
      );
    }
    try {
      // Rust returns a Vec<u8>. Depending on the IPC serializer/runtime,
      // binary data can arrive as an array, typed array, ArrayBuffer, or a
      // plain numeric-key object. Normalize before creating Blob/Audio
      // sources; otherwise the webview sees an empty/invalid WAV and reports
      // "no supported source was found".
      const bytes = await invoke<unknown>("tts_piper_synthesize", {
        text,
        voiceId: args.voiceId,
      });
      const buf = normalizeIpcAudioBytes(bytes);
      assertWavBytes(buf);
      return { audio: buf, mimeType: "audio/wav" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes("abort")) {
        throw new TtsAdapterError("aborted", message, "piper");
      }
      throw new TtsAdapterError("synthesis_failed", message, "piper");
    }
  },
};

registerAdapter(adapter);

export const piperAdapter = adapter;
export const PIPER_DEFAULT_VOICE_SIZE_BYTES = VOICE_SIZE_BYTES;

function normalizeIpcAudioBytes(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return copyBytes(
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
    );
  }
  if (Array.isArray(value)) {
    return copyBytes(uint8ArrayFromNumbers(value));
  }
  if (typeof value === "string") {
    return copyBytes(decodeBase64Bytes(value));
  }
  if (isRecord(value)) {
    const data = value.data;
    if (Array.isArray(data)) {
      return copyBytes(uint8ArrayFromNumbers(data));
    }
    const numericKeys = Object.keys(value)
      .filter((key) => /^\d+$/.test(key))
      .map((key) => Number(key))
      .sort((a, b) => a - b);
    if (numericKeys.length > 0) {
      const out = new Uint8Array(numericKeys.length);
      numericKeys.forEach((key, index) => {
        const byte = value[String(key)];
        if (!isByte(byte)) {
          throw new Error("Piper returned a malformed audio byte payload.");
        }
        out[index] = byte;
      });
      return copyBytes(out);
    }
  }
  throw new Error("Piper returned an unsupported audio byte payload.");
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out.buffer;
}

function uint8ArrayFromNumbers(value: unknown[]): Uint8Array {
  const out = new Uint8Array(value.length);
  value.forEach((byte, index) => {
    if (!isByte(byte)) {
      throw new Error("Piper returned a malformed audio byte payload.");
    }
    out[index] = byte;
  });
  return out;
}

function decodeBase64Bytes(value: string): Uint8Array {
  const decoder =
    typeof atob === "function"
      ? atob
      : (input: string): string => Buffer.from(input, "base64").toString("binary");
  const binary = decoder(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function assertWavBytes(buffer: ArrayBuffer): void {
  const bytes = new Uint8Array(buffer);
  const riff =
    bytes[0] === 82 &&
    bytes[1] === 73 &&
    bytes[2] === 70 &&
    bytes[3] === 70;
  const wave =
    bytes[8] === 87 &&
    bytes[9] === 65 &&
    bytes[10] === 86 &&
    bytes[11] === 69;
  if (bytes.length < 44 || !riff || !wave) {
    throw new Error("Piper returned audio that is not a valid WAV file.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isByte(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 255
  );
}
