// Podcast persistence types. Mirrors `lib/study/types.ts` shape:
// optional fields are `T | undefined` (never bare `T?`) so consumers
// under `exactOptionalPropertyTypes` can spread them cleanly. Audio
// blob is stored in a sibling `PodcastBlobRecord` keyed by podcastId so
// the metadata row stays small and indexable; backup excludes the blob
// row, mirroring the `sourceBlobs` exclusion contract.

export type PodcastStatus =
  | "draft"
  | "scripting"
  | "scripted"
  | "synthesizing"
  | "ready"
  | "error";

// Opinionated 2-host setup: Alev (curious learner) + Deniz (expert).
// The literal union keeps the prompt + UI labels honest. Extending to a
// solo or 3-host format would require widening this union and the
// `PodcastVoice` mapping below.
export type PodcastSpeaker = "alev" | "deniz";

export type PodcastSourceRef = {
  sourceId: string;
  chunkIds?: string[] | undefined;
  section?: string | undefined;
  quote?: string | undefined;
};

export type PodcastSegment = {
  speaker: PodcastSpeaker;
  text: string;
  sourceRefs?: PodcastSourceRef[] | undefined;
  // Filled in by the TTS/assembly stage (5.B.B), not by the script runner.
  startMs?: number | undefined;
  durationMs?: number | undefined;
};

export type PodcastChapter = {
  title: string;
  // Chapter offset in the final mixed audio. The script runner emits
  // chapter boundaries by segment index; the assembler fills startMs
  // once segment durations are known. Until then, `startMs` is 0 for
  // every chapter and the chapter is only addressable by index.
  startMs: number;
  segmentIndex: number;
};

export type PodcastVoice = {
  speaker: PodcastSpeaker;
  name: string;
  voiceId: string;
  role?: string | undefined;
};

export type PodcastUsage = {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  cacheReadTokens?: number | undefined;
  cacheCreationTokens?: number | undefined;
};

export type PodcastAudioDisclosure = {
  kind: "ai-generated-audio";
  label: "AI-generated audio";
};

export type PodcastRecord = {
  id: string;
  workspaceId: string;
  title: string;
  titleEn?: string | undefined;
  description?: string | undefined;
  descriptionEn?: string | undefined;
  locale: "tr" | "en";
  sourceIds: string[];
  segments: PodcastSegment[];
  chapters: PodcastChapter[];
  voices: PodcastVoice[];
  modelId: string;
  generationPromptVersion: string;
  // Phase 11.A — provider-agnostic. Old rows with `"elevenlabs"` survive
  // the migration as the literal string (Dexie stores `provider` as
  // free-form), so the union keeps the legacy value for read-back even
  // though new writes use the Phase-11 TtsProviderId set.
  ttsProvider?:
    | "elevenlabs"
    | "piper"
    | "web-speech"
    | "kokoro"
    | "xtts"
    | "vibevoice"
    | undefined;
  ttsModelId?: string | undefined;
  audioMimeType?: string | undefined;
  totalMs?: number | undefined;
  status: PodcastStatus;
  errorMessage?: string | undefined;
  usage?: PodcastUsage | undefined;
  audioDisclosure?: PodcastAudioDisclosure | undefined;
  createdAt: number;
  updatedAt: number;
};

// Binary audio kept 1:1 with `PodcastRecord` so the metadata row stays
// small and indexable. PK is `podcastId`; cascade delete in
// `deletePodcast` keeps the two in sync.
export type PodcastBlobRecord = {
  podcastId: string;
  blob: Blob;
  contentType: string;
  byteSize: number;
  createdAt: number;
};
