import { describe, expect, it, vi } from "vitest";
import type { TtsAdapter } from "./adapter";
import type { VoicePickerEntry } from "./voices";
import {
  buildSmokeTestText,
  runTtsSmokeTest,
  SMOKE_TEST_MIN_AUDIO_BYTES,
} from "./smoke-test";

const wavBytes = new Uint8Array(Math.max(SMOKE_TEST_MIN_AUDIO_BYTES, 64));
wavBytes.set([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69], 0);

const trVoice: VoicePickerEntry = {
  voiceId: "tr_TR-dfki-medium",
  name: "DFKI",
  speaker: "alev",
  description: { tr: "TR voice", en: "TR voice" },
  nativeLocale: "tr",
};

function adapterReturning(audio: ArrayBuffer, mimeType = "audio/wav"): TtsAdapter {
  return {
    id: "piper",
    checkReadiness: vi.fn(),
    listVoices: vi.fn(),
    getDefaultVoiceForSpeaker: vi.fn(),
    synthesize: vi.fn().mockResolvedValue({ audio, mimeType }),
  };
}

describe("TTS smoke test helpers", () => {
  it("builds a short Turkish sample for Turkish voices", () => {
    expect(buildSmokeTestText(trVoice)).toContain("Merhaba");
    expect(buildSmokeTestText(trVoice)).toContain("DFKI");
  });

  it("synthesizes a smoke sample through the selected adapter", async () => {
    const adapter = adapterReturning(wavBytes.buffer.slice(0));

    const result = await runTtsSmokeTest({ adapter, voice: trVoice });

    expect(adapter.synthesize).toHaveBeenCalledWith({
      text: buildSmokeTestText(trVoice),
      voiceId: "tr_TR-dfki-medium",
      signal: undefined,
    });
    expect(result.mimeType).toBe("audio/wav");
  });

  it("rejects empty audio from the provider", async () => {
    const adapter = adapterReturning(new ArrayBuffer(0));

    await expect(runTtsSmokeTest({ adapter, voice: trVoice })).rejects.toThrow(
      /empty audio/i,
    );
  });

  it("rejects non-audio mime types", async () => {
    const adapter = adapterReturning(wavBytes.buffer.slice(0), "text/plain");

    await expect(runTtsSmokeTest({ adapter, voice: trVoice })).rejects.toThrow(
      /unsupported smoke test audio type/i,
    );
  });
});
