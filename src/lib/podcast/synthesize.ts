// Phase 11.A — Provider-agnostic synthesis orchestrator.
//
// Pre-Phase-11 this file invoked an ElevenLabs HTTP client directly and
// pinned the row's `ttsProvider` to `"elevenlabs"`. It now resolves a
// `TtsAdapter` from `prefs.ttsProvider` (or the explicit arg) and loops
// segments through the adapter, persisting the provider id into the
// row so the audio page can render an honest "synthesized by X" label.
//
// Driven by `synthesizePodcastAudio(podcastId, opts)`:
//   1. Mark the record `synthesizing`.
//   2. Resolve the active adapter; bail if not ready.
//   3. For each segment: adapter.synthesize → decode-to-Float32 → push.
//   4. Assemble all decoded segments with a 250 ms silence gap.
//   5. Encode WAV → persist as `podcastBlobs[podcastId]`.
//   6. Update the metadata row: segment timings, chapter startMs (from
//      `segmentIndex` → `segmentTimings[i].startMs`), totalMs,
//      ttsProvider/ttsModelId/audioMimeType, status=`ready`.
//   7. On any failure flip status to `error` and re-throw.
//
// DI: ttsFn / decoderFn / audioContext are injectable so tests can
// pin behaviour without browser globals or a real adapter invocation.

import "./adapters";

import {
  assemblePodcastAudio,
  decodeMp3WithContext,
  encodeWavMono,
  type AudioDecoderContext,
  type DecodedSegment,
} from "./audio-assembly";
import {
  getPodcast,
  setPodcastBlob,
  setPodcastStatus,
  updatePodcast,
} from "@/lib/db/podcasts";
import {
  getAdapter,
  TtsAdapterError,
  type TtsProviderId,
} from "./adapter";
import { DEFAULT_TTS_MODEL_ID, DEFAULT_TTS_PROVIDER } from "./voices";
import type {
  PodcastAudioDisclosure,
  PodcastChapter,
  PodcastRecord,
  PodcastSegment,
  PodcastVoice,
} from "./types";

export type SynthesizePodcastErrorCode =
  | "not_found"
  | "no_segments"
  | "missing_voice"
  | "adapter_not_ready"
  | "tts_error"
  | "decode_error"
  | "aborted"
  | "persist_error";

export class SynthesizePodcastError extends Error {
  constructor(
    public readonly code: SynthesizePodcastErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SynthesizePodcastError";
  }
}

export type SegmentSynthesizer = (args: {
  text: string;
  voiceId: string;
  signal?: AbortSignal | undefined;
}) => Promise<{ audio: ArrayBuffer; mimeType: string }>;

export type SegmentDecoder = (
  arrayBuffer: ArrayBuffer,
) => Promise<DecodedSegment>;

export type SynthesizePodcastArgs = {
  podcastId: string;
  /** Which adapter to use. Defaults to `DEFAULT_TTS_PROVIDER` (piper). */
  providerId?: TtsProviderId;
  /** Silence gap between consecutive segments, in milliseconds. */
  gapMs?: number;
  signal?: AbortSignal;

  // DI seams
  ttsFn?: SegmentSynthesizer;
  decoderFn?: SegmentDecoder;
  audioContext?: AudioDecoderContext;
  /** Optional progress callback; fires once per segment after decode. */
  onSegment?: (info: { index: number; total: number }) => void;
};

export type SynthesizePodcastResult = {
  podcast: PodcastRecord;
  totalMs: number;
  contentType: string;
  byteSize: number;
};

const WAV_CONTENT_TYPE = "audio/wav";
const AI_AUDIO_DISCLOSURE: PodcastAudioDisclosure = {
  kind: "ai-generated-audio",
  label: "AI-generated audio",
};

function buildVoiceLookup(voices: PodcastVoice[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const v of voices) map.set(v.speaker, v.voiceId);
  return map;
}

function adapterSegmentSynthesizer(providerId: TtsProviderId): SegmentSynthesizer {
  const adapter = getAdapter(providerId);
  return async ({ text, voiceId, signal }) => {
    const args: Parameters<typeof adapter.synthesize>[0] = { text, voiceId };
    if (signal) args.signal = signal;
    return adapter.synthesize(args);
  };
}

function defaultBrowserAudioContext(): AudioDecoderContext {
  type Ctor = new () => AudioDecoderContext;
  const g = globalThis as unknown as {
    AudioContext?: Ctor;
    webkitAudioContext?: Ctor;
  };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) {
    throw new SynthesizePodcastError(
      "decode_error",
      "AudioContext is not available in this environment",
    );
  }
  return new Ctor();
}

export async function synthesizePodcastAudio(
  args: SynthesizePodcastArgs,
): Promise<SynthesizePodcastResult> {
  const podcast = await getPodcast(args.podcastId);
  if (!podcast) {
    throw new SynthesizePodcastError(
      "not_found",
      `Podcast not found: ${args.podcastId}`,
    );
  }
  if (podcast.segments.length === 0) {
    throw new SynthesizePodcastError(
      "no_segments",
      `Podcast ${podcast.id} has no segments to synthesize`,
    );
  }

  const providerId: TtsProviderId = args.providerId ?? DEFAULT_TTS_PROVIDER;

  // If no custom ttsFn is provided, resolve the adapter up front and
  // gate on its readiness — keeps the "binary missing" / "voice not
  // installed" cases out of the per-segment loop where they would
  // surface as a generic tts_error.
  let ttsFn: SegmentSynthesizer;
  if (args.ttsFn) {
    ttsFn = args.ttsFn;
  } else {
    const adapter = getAdapter(providerId);
    const readiness = await adapter.checkReadiness();
    if (readiness.kind !== "ready") {
      const detail =
        readiness.kind === "not-supported-on-platform"
          ? readiness.reason
          : readiness.kind === "missing-binary"
            ? `Missing TTS binary: ${readiness.binaryName}`
            : `Missing voice model: ${readiness.modelId}`;
      throw new SynthesizePodcastError("adapter_not_ready", detail);
    }
    ttsFn = adapterSegmentSynthesizer(providerId);
  }

  let decoderFn: SegmentDecoder | undefined = args.decoderFn;
  // Tracks an AudioContext we instantiate ourselves so the finally block can
  // close it. A DI-injected context (args.audioContext) is the caller's to
  // manage and must NOT be closed here.
  let selfCreatedCtx: AudioDecoderContext | null = null;

  const voiceLookup = buildVoiceLookup(podcast.voices);

  try {
    await setPodcastStatus(podcast.id, "synthesizing");

    if (args.signal?.aborted) {
      throw new SynthesizePodcastError(
        "aborted",
        "Synthesis aborted before any segment",
      );
    }

    const decoded: DecodedSegment[] = [];
    for (let i = 0; i < podcast.segments.length; i += 1) {
      if (args.signal?.aborted) {
        throw new SynthesizePodcastError(
          "aborted",
          `Synthesis aborted at segment ${i}`,
        );
      }
      const segment = podcast.segments[i];
      if (!segment) continue;
      const voiceId = voiceLookup.get(segment.speaker);
      if (!voiceId) {
        throw new SynthesizePodcastError(
          "missing_voice",
          `No voiceId mapped for speaker "${segment.speaker}" on segment ${i}`,
        );
      }

      let result: { audio: ArrayBuffer; mimeType: string };
      try {
        const ttsArgs: Parameters<SegmentSynthesizer>[0] = {
          text: segment.text,
          voiceId,
        };
        if (args.signal) ttsArgs.signal = args.signal;
        result = await ttsFn(ttsArgs);
      } catch (err) {
        if (err instanceof TtsAdapterError && err.code === "aborted") {
          throw new SynthesizePodcastError(
            "aborted",
            `Synthesis aborted at segment ${i}`,
          );
        }
        throw new SynthesizePodcastError(
          "tts_error",
          `TTS failed at segment ${i}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      let decodedSegment: DecodedSegment;
      try {
        if (!decoderFn) {
          const ctx = args.audioContext ?? defaultBrowserAudioContext();
          if (!args.audioContext) selfCreatedCtx = ctx;
          decoderFn = (ab: ArrayBuffer) => decodeMp3WithContext(ab, ctx);
        }
        decodedSegment = await decoderFn(result.audio);
      } catch (err) {
        if (err instanceof SynthesizePodcastError) throw err;
        throw new SynthesizePodcastError(
          "decode_error",
          `Decode failed at segment ${i}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      decoded.push(decodedSegment);
      args.onSegment?.({ index: i, total: podcast.segments.length });
    }

    const assembled = assemblePodcastAudio({
      decoded,
      ...(args.gapMs !== undefined ? { gapMs: args.gapMs } : {}),
    });
    const wavBytes = encodeWavMono(assembled.samples, assembled.sampleRate);
    const blob = new Blob([wavBytes as unknown as BlobPart], {
      type: WAV_CONTENT_TYPE,
    });

    try {
      await setPodcastBlob(podcast.id, blob, WAV_CONTENT_TYPE);
    } catch (err) {
      throw new SynthesizePodcastError(
        "persist_error",
        `Blob persist failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const segmentsWithTiming: PodcastSegment[] = podcast.segments.map(
      (segment, index) => {
        const timing = assembled.segmentTimings[index];
        const next: PodcastSegment = {
          speaker: segment.speaker,
          text: segment.text,
        };
        if (segment.sourceRefs !== undefined) next.sourceRefs = segment.sourceRefs;
        if (timing) {
          next.startMs = timing.startMs;
          next.durationMs = timing.durationMs;
        }
        return next;
      },
    );

    const chaptersWithTiming: PodcastChapter[] = podcast.chapters.map(
      (chapter) => ({
        title: chapter.title,
        segmentIndex: chapter.segmentIndex,
        startMs:
          assembled.segmentTimings[chapter.segmentIndex]?.startMs ?? 0,
      }),
    );

    await updatePodcast(podcast.id, {
      segments: segmentsWithTiming,
      chapters: chaptersWithTiming,
      ttsProvider: providerId,
      ttsModelId: DEFAULT_TTS_MODEL_ID,
      audioMimeType: WAV_CONTENT_TYPE,
      totalMs: assembled.totalMs,
      audioDisclosure: AI_AUDIO_DISCLOSURE,
      status: "ready",
    });

    const refreshed = await getPodcast(podcast.id);
    if (!refreshed) {
      throw new SynthesizePodcastError(
        "persist_error",
        "Podcast row vanished after status update",
      );
    }
    return {
      podcast: refreshed,
      totalMs: assembled.totalMs,
      contentType: WAV_CONTENT_TYPE,
      byteSize: blob.size,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown synthesis failure";
    try {
      await setPodcastStatus(podcast.id, "error", message);
    } catch {
      // Swallow status-write failure — surfacing the original error is
      // more useful than masking it with a follow-up Dexie issue.
    }
    if (err instanceof SynthesizePodcastError) throw err;
    throw new SynthesizePodcastError("tts_error", message);
  } finally {
    // Close the AudioContext we created ourselves — browsers cap concurrent
    // AudioContexts, so one leaked per synthesis run eventually throws. An
    // injected/DI context is the caller's to manage. Guard with a typeof
    // check so fake decoder contexts in tests need not implement close().
    if (selfCreatedCtx) {
      const closable = selfCreatedCtx as { close?: () => unknown };
      if (typeof closable.close === "function") {
        try {
          await closable.close();
        } catch {
          // Best-effort — a close failure must not mask the real result.
        }
      }
    }
  }
}
