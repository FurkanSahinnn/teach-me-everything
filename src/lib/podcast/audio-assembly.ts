// Pure helpers + thin WebAudio shell for assembling per-segment TTS
// outputs into a single playable podcast blob.
//
// Split contract:
//   - `silenceFloat32`, `concatFloat32`, `encodeWavMono`, and
//     `assemblePodcastAudio` are pure — they take Float32 PCM in and
//     return Float32 / Uint8Array out, so Vitest can pin behaviour
//     without a real AudioContext.
//   - `decodeMp3WithContext` is the browser-only shim that turns an
//     MP3 ArrayBuffer into the `DecodedSegment` shape the assembler
//     expects. Tests inject a fake decoder via the orchestrator's DI.
//
// Why WAV and not MP3 for the final blob:
//   MP3 framing makes "concat N encoded segments" lossy at boundaries
//   (encoder padding samples bleed across frames). WAV from raw PCM is
//   exact, deterministic, and free of an extra encoder dependency. The
//   resulting blob is larger (~10x) but a single 30-minute podcast at
//   44.1 kHz / 16-bit mono is still under 160 MB — IndexedDB handles
//   that fine, and HTMLAudioElement plays WAV natively.

export type DecodedSegment = {
  samples: Float32Array;
  sampleRate: number;
  durationMs: number;
};

export type SegmentTiming = {
  /** Offset from podcast start in milliseconds. */
  startMs: number;
  /** Spoken-text duration (excludes trailing gap). */
  durationMs: number;
};

export type AssembledAudio = {
  samples: Float32Array;
  sampleRate: number;
  totalMs: number;
  /** One entry per input segment, in the same order. */
  segmentTimings: SegmentTiming[];
};

const DEFAULT_GAP_MS = 250;
const MS_PER_S = 1000;

/** Return a Float32Array of `durationMs * sampleRate / 1000` zero
 *  samples. Used as the inter-segment silence buffer. */
export function silenceFloat32(
  sampleRate: number,
  durationMs: number,
): Float32Array {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`silenceFloat32: invalid sampleRate ${sampleRate}`);
  }
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error(`silenceFloat32: invalid durationMs ${durationMs}`);
  }
  const length = Math.round((durationMs / MS_PER_S) * sampleRate);
  return new Float32Array(length);
}

/** Concatenate Float32Arrays into a single buffer. Pure. */
export function concatFloat32(parts: Float32Array[]): Float32Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Encode a mono Float32 PCM buffer as a 16-bit linear-PCM WAV file.
 * Returns a fresh Uint8Array; pure (no AudioContext, no globals).
 *
 * The WAV header is 44 bytes:
 *   "RIFF" + uint32 fileSize-8 + "WAVE"
 *   "fmt "  + uint32 16 + uint16 1 (PCM) + uint16 channels + uint32 sampleRate
 *           + uint32 byteRate + uint16 blockAlign + uint16 16 (bitsPerSample)
 *   "data"  + uint32 dataBytes
 */
export function encodeWavMono(
  samples: Float32Array,
  sampleRate: number,
): Uint8Array {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`encodeWavMono: invalid sampleRate ${sampleRate}`);
  }
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataBytes = samples.length * bytesPerSample;
  const totalBytes = 44 + dataBytes;
  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);

  // "RIFF" chunk
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, totalBytes - 8, true);
  writeAscii(view, 8, "WAVE");

  // "fmt " sub-chunk
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // sub-chunk size (PCM)
  view.setUint16(20, 1, true); // audioFormat = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byteRate
  view.setUint16(32, numChannels * bytesPerSample, true); // blockAlign
  view.setUint16(34, bitsPerSample, true);

  // "data" sub-chunk
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  // PCM samples — clip and convert Float32 → Int16 little-endian.
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const raw = samples[i] ?? 0;
    const clamped = raw < -1 ? -1 : raw > 1 ? 1 : raw;
    const int16 = Math.round(clamped * 32767);
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * Build a single PCM buffer from N decoded segments with a fixed
 * silence gap between them. Returns Float32 PCM + segment timings so
 * the caller can persist `PodcastSegment.startMs / .durationMs` and
 * resolve `PodcastChapter.startMs` from the chapter's `segmentIndex`.
 *
 * Validates that every segment shares the same sample rate (TTS output
 * format should never change mid-podcast). If a heterogenous batch is
 * supplied we'd silently retune speech speed, which is worse than a
 * loud failure.
 */
export function assemblePodcastAudio(args: {
  decoded: DecodedSegment[];
  gapMs?: number;
}): AssembledAudio {
  const decoded = args.decoded;
  if (decoded.length === 0) {
    throw new Error("assemblePodcastAudio: no segments");
  }
  const sampleRate = decoded[0]?.sampleRate ?? 0;
  if (!sampleRate) {
    throw new Error("assemblePodcastAudio: first segment has zero sampleRate");
  }
  for (let i = 1; i < decoded.length; i += 1) {
    if (decoded[i]?.sampleRate !== sampleRate) {
      throw new Error(
        `assemblePodcastAudio: sampleRate mismatch at segment ${i}`,
      );
    }
  }
  const gapMs = args.gapMs ?? DEFAULT_GAP_MS;
  const silenceBetween = silenceFloat32(sampleRate, gapMs);

  const parts: Float32Array[] = [];
  const segmentTimings: SegmentTiming[] = [];
  let cursorMs = 0;
  for (let i = 0; i < decoded.length; i += 1) {
    const seg = decoded[i];
    if (!seg) continue;
    segmentTimings.push({
      startMs: Math.round(cursorMs),
      durationMs: Math.round(seg.durationMs),
    });
    parts.push(seg.samples);
    cursorMs += seg.durationMs;
    if (i < decoded.length - 1) {
      parts.push(silenceBetween);
      cursorMs += gapMs;
    }
  }

  return {
    samples: concatFloat32(parts),
    sampleRate,
    totalMs: Math.round(cursorMs),
    segmentTimings,
  };
}

// --- browser-only shim ------------------------------------------------

/** Minimal subset of AudioContext used by the decoder. Lets tests
 *  inject a fake via DI without dragging WebAudio types into Node. */
export type AudioDecoderContext = {
  decodeAudioData(arrayBuffer: ArrayBuffer): Promise<AudioBufferLike>;
};

export type AudioBufferLike = {
  numberOfChannels: number;
  sampleRate: number;
  duration: number;
  getChannelData(channel: number): Float32Array;
};

/**
 * Decode an audio ArrayBuffer through an AudioContext and project it
 * down to mono Float32 PCM (channel 0). `decodeAudioData` accepts any
 * container the browser knows (WAV from Piper, MP3 from legacy podcasts),
 * so the adapter contract doesn't need to pin a format here. The
 * projection keeps us robust if a future adapter emits stereo.
 */
export async function decodeMp3WithContext(
  arrayBuffer: ArrayBuffer,
  ctx: AudioDecoderContext,
): Promise<DecodedSegment> {
  const buffer = await ctx.decodeAudioData(arrayBuffer);
  const samples = buffer.getChannelData(0);
  // Copy out of the AudioBuffer so subsequent decodes can release the
  // underlying memory (some engines reuse the channel data backing).
  const owned = new Float32Array(samples.length);
  owned.set(samples);
  return {
    samples: owned,
    sampleRate: buffer.sampleRate,
    durationMs: Math.round(buffer.duration * MS_PER_S),
  };
}
