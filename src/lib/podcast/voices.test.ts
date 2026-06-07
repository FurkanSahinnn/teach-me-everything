import { describe, expect, it } from "vitest";
import {
  buildVoicesFromPicks,
  DEFAULT_TTS_MODEL_ID,
  DEFAULT_TTS_PROVIDER,
  getDefaultVoicePicks,
  listVoicesForProvider,
  listVoicesForSpeaker,
} from "./voices";

describe("voice catalog (Phase 11 adapter-driven)", () => {
  it("piper catalog covers both speakers with at least one voice each", () => {
    expect(listVoicesForSpeaker("piper", "alev").length).toBeGreaterThan(0);
    expect(listVoicesForSpeaker("piper", "deniz").length).toBeGreaterThan(0);
  });

  it("every piper voice has a non-empty voiceId", () => {
    for (const voice of listVoicesForProvider("piper")) {
      expect(voice.voiceId.length).toBeGreaterThan(0);
    }
  });

  it("listVoicesForProvider returns a fresh copy on every call", () => {
    const a = listVoicesForProvider("piper");
    const b = listVoicesForProvider("piper");
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("getDefaultVoicePicks resolves to a voice per speaker for piper", () => {
    const picks = getDefaultVoicePicks("piper");
    const alev = listVoicesForSpeaker("piper", "alev").find(
      (v) => v.voiceId === picks.alev,
    );
    const deniz = listVoicesForSpeaker("piper", "deniz").find(
      (v) => v.voiceId === picks.deniz,
    );
    expect(alev?.speaker).toBe("alev");
    expect(deniz?.speaker).toBe("deniz");
  });

  it("buildVoicesFromPicks returns alev+deniz with mapped voiceIds", () => {
    const picks = getDefaultVoicePicks("piper");
    const voices = buildVoicesFromPicks({
      providerId: "piper",
      picks,
    });
    expect(voices).toHaveLength(2);
    expect(voices[0]?.speaker).toBe("alev");
    expect(voices[1]?.speaker).toBe("deniz");
    expect(voices[0]?.voiceId.length).toBeGreaterThan(0);
    expect(voices[1]?.voiceId.length).toBeGreaterThan(0);
  });

  it("buildVoicesFromPicks rejects a wrong-speaker pick", () => {
    const denizDefault = getDefaultVoicePicks("piper").deniz;
    expect(() =>
      buildVoicesFromPicks({
        providerId: "piper",
        picks: { alev: denizDefault, deniz: denizDefault },
      }),
    ).toThrow(/Invalid alev voice/);
  });

  it("buildVoicesFromPicks throws for an unknown provider", () => {
    expect(() =>
      buildVoicesFromPicks({
        // The TtsProviderId union doesn't include `made-up`; cast through
        // `never` to defeat the type check so we can exercise the runtime
        // guard.
        providerId: "made-up" as never,
        picks: { alev: "x", deniz: "y" },
      }),
    ).toThrow(/Unknown TTS provider/);
  });

  it("DEFAULT_TTS_PROVIDER is piper (local-first default)", () => {
    expect(DEFAULT_TTS_PROVIDER).toBe("piper");
  });

  it("DEFAULT_TTS_MODEL_ID is the piper placeholder string", () => {
    expect(DEFAULT_TTS_MODEL_ID).toBe("piper-default");
  });

  it("web-speech adapter exposes voices for both speakers (live preview)", () => {
    expect(listVoicesForSpeaker("web-speech", "alev").length).toBeGreaterThan(0);
    expect(listVoicesForSpeaker("web-speech", "deniz").length).toBeGreaterThan(0);
  });
});
