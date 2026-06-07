import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  synthesizePodcastAudio,
  SynthesizePodcastError,
  type SegmentDecoder,
  type SegmentSynthesizer,
} from "./synthesize";
import {
  createPodcast,
  getPodcast,
  getPodcastBlob,
} from "@/lib/db/podcasts";
import { createWorkspace } from "@/lib/db/workspaces";
import { db } from "@/lib/db/schema";
import type {
  PodcastSegment,
  PodcastVoice,
} from "./types";
import type { DecodedSegment } from "./audio-assembly";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

const VOICES: PodcastVoice[] = [
  { speaker: "alev", name: "Alev", voiceId: "voice_alev" },
  { speaker: "deniz", name: "Deniz", voiceId: "voice_deniz" },
];

function defaultSegments(): PodcastSegment[] {
  return [
    { speaker: "alev", text: "Soru" },
    { speaker: "deniz", text: "Cevap" },
    { speaker: "alev", text: "Devamı?" },
  ];
}

async function seedPodcast(opts: {
  segments?: PodcastSegment[];
  voices?: PodcastVoice[];
} = {}): Promise<{ podcastId: string; workspaceId: string }> {
  const ws = await createWorkspace({
    name: "QFT",
    color: "#000",
    initials: "QF",
  });
  const rec = await createPodcast({
    workspaceId: ws.id,
    title: "Pilot",
    locale: "tr",
    sourceIds: [],
    segments: opts.segments ?? defaultSegments(),
    chapters: [
      { title: "Açılış", segmentIndex: 0, startMs: 0 },
      { title: "Detay", segmentIndex: 1, startMs: 0 },
    ],
    voices: opts.voices ?? VOICES,
    modelId: "claude-sonnet-4-6",
    generationPromptVersion: "podcast-script@1",
  });
  return { podcastId: rec.id, workspaceId: ws.id };
}

function fakeTts(): SegmentSynthesizer {
  // Phase 11.A — adapter contract returns `{audio, mimeType}`; the fake
  // decoder ignores the buffer contents and emits a deterministic 100 ms
  // Float32 segment regardless of what the adapter produces.
  return vi.fn(async () => ({
    audio: new ArrayBuffer(16),
    mimeType: "audio/wav",
  }));
}

function fakeDecoder(perSegmentMs = 100, sampleRate = 44100): SegmentDecoder {
  return async (): Promise<DecodedSegment> => {
    const samples = new Float32Array(
      Math.round((perSegmentMs / 1000) * sampleRate),
    );
    samples.fill(0.25);
    return { samples, sampleRate, durationMs: perSegmentMs };
  };
}

describe("synthesizePodcastAudio", () => {
  it("rejects an unknown podcast id", async () => {
    await expect(
      synthesizePodcastAudio({
        podcastId: "pod_missing",
        ttsFn: fakeTts(),
        decoderFn: fakeDecoder(),
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects when the speaker is missing from voices[]", async () => {
    const { podcastId } = await seedPodcast({
      voices: [
        { speaker: "alev", name: "Alev", voiceId: "voice_alev" },
        // Missing deniz on purpose.
      ] as PodcastVoice[],
    });
    await expect(
      synthesizePodcastAudio({
        podcastId,
        ttsFn: fakeTts(),
        decoderFn: fakeDecoder(),
      }),
    ).rejects.toMatchObject({ code: "missing_voice" });
    const row = await getPodcast(podcastId);
    expect(row?.status).toBe("error");
  });

  it("writes a WAV blob and flips status to ready on the happy path", async () => {
    const { podcastId } = await seedPodcast();
    const tts = fakeTts();
    const result = await synthesizePodcastAudio({
      podcastId,
      ttsFn: tts,
      decoderFn: fakeDecoder(100, 44100),
      gapMs: 250,
    });

    // 3 × 100 ms speech + 2 × 250 ms silence = 800 ms
    expect(result.totalMs).toBe(800);
    expect(result.contentType).toBe("audio/wav");
    expect(tts).toHaveBeenCalledTimes(3);

    const row = await getPodcast(podcastId);
    expect(row?.status).toBe("ready");
    expect(row?.ttsProvider).toBe("piper");
    expect(row?.audioMimeType).toBe("audio/wav");
    expect(row?.audioDisclosure).toEqual({
      kind: "ai-generated-audio",
      label: "AI-generated audio",
    });
    expect(row?.totalMs).toBe(800);
    expect(row?.segments.map((s) => s.startMs)).toEqual([0, 350, 700]);
    expect(row?.segments.map((s) => s.durationMs)).toEqual([100, 100, 100]);
    expect(row?.chapters.map((c) => c.startMs)).toEqual([0, 350]);

    const blob = await getPodcastBlob(podcastId);
    expect(blob?.byteSize).toBeGreaterThan(44);
    expect(blob?.contentType).toBe("audio/wav");
  });

  it("records the requested provider id on the row", async () => {
    const { podcastId } = await seedPodcast();
    await synthesizePodcastAudio({
      podcastId,
      providerId: "kokoro",
      ttsFn: fakeTts(),
      decoderFn: fakeDecoder(),
    });
    const row = await getPodcast(podcastId);
    expect(row?.ttsProvider).toBe("kokoro");
  });

  it("calls onSegment once per decoded segment with monotonic index", async () => {
    const { podcastId } = await seedPodcast();
    const seen: number[] = [];
    await synthesizePodcastAudio({
      podcastId,
      ttsFn: fakeTts(),
      decoderFn: fakeDecoder(),
      onSegment: ({ index }) => seen.push(index),
    });
    expect(seen).toEqual([0, 1, 2]);
  });

  it("flips status to error and re-throws when the TTS layer fails", async () => {
    const { podcastId } = await seedPodcast();
    const bombing: SegmentSynthesizer = async () => {
      throw new Error("upstream 500");
    };
    await expect(
      synthesizePodcastAudio({
        podcastId,
        ttsFn: bombing,
        decoderFn: fakeDecoder(),
      }),
    ).rejects.toBeInstanceOf(SynthesizePodcastError);
    const row = await getPodcast(podcastId);
    expect(row?.status).toBe("error");
    expect(row?.errorMessage).toMatch(/upstream 500/);
  });

  it("honours a pre-aborted signal before any segment runs", async () => {
    const { podcastId } = await seedPodcast();
    const ctrl = new AbortController();
    ctrl.abort();
    const tts = vi.fn(async () => ({
      audio: new ArrayBuffer(16),
      mimeType: "audio/wav",
    }));
    await expect(
      synthesizePodcastAudio({
        podcastId,
        ttsFn: tts,
        decoderFn: fakeDecoder(),
        signal: ctrl.signal,
      }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(tts).not.toHaveBeenCalled();
    const row = await getPodcast(podcastId);
    expect(row?.status).toBe("error");
  });
});
