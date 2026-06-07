import { describe, expect, it } from "vitest";
import {
  assemblePodcastAudio,
  concatFloat32,
  encodeWavMono,
  silenceFloat32,
  type DecodedSegment,
} from "./audio-assembly";

function tone(durationMs: number, sampleRate = 44100): Float32Array {
  const samples = Math.round((durationMs / 1000) * sampleRate);
  // Constant 0.5 amplitude so encodeWavMono produces a predictable
  // Int16 value (~ 16384) we can sanity-check without floating math.
  const arr = new Float32Array(samples);
  arr.fill(0.5);
  return arr;
}

function decoded(durationMs: number, sampleRate = 44100): DecodedSegment {
  return {
    samples: tone(durationMs, sampleRate),
    sampleRate,
    durationMs,
  };
}

describe("silenceFloat32", () => {
  it("returns an array sized to sampleRate × duration", () => {
    const s = silenceFloat32(48000, 250);
    expect(s.length).toBe(12000);
    expect(s.every((v) => v === 0)).toBe(true);
  });

  it("throws on a non-positive sampleRate", () => {
    expect(() => silenceFloat32(0, 100)).toThrow(/invalid sampleRate/);
  });

  it("throws on a negative duration", () => {
    expect(() => silenceFloat32(44100, -1)).toThrow(/invalid durationMs/);
  });
});

describe("concatFloat32", () => {
  it("joins parts in order and preserves values", () => {
    const a = Float32Array.from([1, 2]);
    const b = Float32Array.from([3, 4, 5]);
    const out = concatFloat32([a, b]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  it("handles an empty parts array", () => {
    const out = concatFloat32([]);
    expect(out.length).toBe(0);
  });
});

describe("encodeWavMono", () => {
  it("emits a 44-byte WAV header with PCM=1 and the right sample rate", () => {
    const wav = encodeWavMono(Float32Array.from([0, 0]), 44100);
    const view = new DataView(wav.buffer);
    // "RIFF" header
    expect(String.fromCharCode(wav[0] ?? 0, wav[1] ?? 0, wav[2] ?? 0, wav[3] ?? 0)).toBe("RIFF");
    expect(String.fromCharCode(wav[8] ?? 0, wav[9] ?? 0, wav[10] ?? 0, wav[11] ?? 0)).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(44100); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bitsPerSample
    expect(String.fromCharCode(wav[36] ?? 0, wav[37] ?? 0, wav[38] ?? 0, wav[39] ?? 0)).toBe("data");
  });

  it("clips out-of-range Float32 values to [-1, 1] before Int16 conversion", () => {
    const wav = encodeWavMono(Float32Array.from([2.5, -3, 0.5]), 44100);
    const view = new DataView(wav.buffer);
    // 3 samples = 6 PCM bytes after the 44-byte header.
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32767);
    expect(view.getInt16(48, true)).toBe(Math.round(0.5 * 32767));
  });

  it("rejects a non-positive sampleRate", () => {
    expect(() => encodeWavMono(Float32Array.from([0]), 0)).toThrow(
      /invalid sampleRate/,
    );
  });
});

describe("assemblePodcastAudio", () => {
  it("concatenates segments with a 250 ms gap by default", () => {
    const result = assemblePodcastAudio({
      decoded: [decoded(100), decoded(100)],
    });
    // 100 + 250 (gap) + 100 = 450 ms
    expect(result.totalMs).toBe(450);
    expect(result.segmentTimings.map((t) => t.startMs)).toEqual([0, 350]);
    expect(result.segmentTimings.map((t) => t.durationMs)).toEqual([100, 100]);
  });

  it("respects a custom gapMs", () => {
    const result = assemblePodcastAudio({
      decoded: [decoded(200), decoded(200), decoded(200)],
      gapMs: 100,
    });
    // 200 + 100 + 200 + 100 + 200 = 800 ms
    expect(result.totalMs).toBe(800);
    expect(result.segmentTimings.map((t) => t.startMs)).toEqual([0, 300, 600]);
  });

  it("does not append a trailing gap after the last segment", () => {
    const result = assemblePodcastAudio({
      decoded: [decoded(100)],
      gapMs: 250,
    });
    expect(result.totalMs).toBe(100);
    expect(result.segmentTimings).toHaveLength(1);
  });

  it("rejects a heterogeneous sampleRate batch", () => {
    expect(() =>
      assemblePodcastAudio({
        decoded: [decoded(100, 44100), decoded(100, 22050)],
      }),
    ).toThrow(/sampleRate mismatch/);
  });

  it("rejects an empty segment list", () => {
    expect(() => assemblePodcastAudio({ decoded: [] })).toThrow(/no segments/);
  });

  it("returns the shared sampleRate on the AssembledAudio output", () => {
    const result = assemblePodcastAudio({
      decoded: [decoded(50, 48000), decoded(50, 48000)],
      gapMs: 0,
    });
    expect(result.sampleRate).toBe(48000);
  });
});
