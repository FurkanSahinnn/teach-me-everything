// Podcast-script generation runner. Drives a chat provider through the
// `podcast-script` prompt and persists the result as a `PodcastRecord`
// with status="scripted". Pure helpers (`mapParsedScriptToInput`,
// `estimatePodcastScriptCost`) are exported so tests can pin behaviour
// without spinning up the AI runner. `chatProvider` is an injectable
// arg so tests pass a fake provider without `vi.mock`-ing the registry.
//
// Audio synthesis (local-first TTS via the Phase 11 adapter registry +
// WebAudio mixing) lives in `synthesize.ts` and transitions the record
// from `scripted` → `synthesizing` → `ready`.

import { findChatOption } from "@/lib/ai/model-options";
import { PRICING } from "@/lib/ai/pricing";
import {
  buildPodcastScriptSystem,
  parsePodcastScript,
  PODCAST_SCRIPT_PROMPT_VERSION,
  type ParsedPodcast,
  type ParsedPodcastSegment,
} from "@/lib/ai/prompts/podcast-script";
import { getChatProvider } from "@/lib/ai/providers/registry";
import type {
  ChatProvider,
  ChatRequest,
  SystemBlock,
  Usage,
} from "@/lib/ai/providers/types";
import { createPodcast } from "@/lib/db/podcasts";
import type { ChunkRecord, SourceRecord } from "@/lib/db/types";
import type {
  PodcastChapter,
  PodcastRecord,
  PodcastSegment,
  PodcastSourceRef,
  PodcastUsage,
  PodcastVoice,
} from "@/lib/podcast/types";

export type PodcastGenSource = Pick<
  SourceRecord,
  "id" | "title" | "titleEn" | "type" | "author"
> & {
  chunks: Array<
    Pick<ChunkRecord, "id" | "index" | "section" | "headings" | "text" | "page">
  >;
};

export type GeneratePodcastArgs = {
  workspaceId: string;
  workspace: { name: string; goal?: string | undefined };
  sources: PodcastGenSource[];
  // Resolved upfront from prefs.modelBindings.deep by the caller (Opus
  // by convention — longer, narrative output).
  modelId: string;
  apiKey: string;
  /** Anthropic only: "oauth" routes through /api/ai/chat-oauth instead of
   *  /api/ai/chat. Other presets ignore. */
  authKind?: "oauth" | "api-key";
  locale: "tr" | "en";
  /** Voices to embed in the persisted record. Drives 5.B.B TTS lookup
   *  but already useful in 5.B.A so the transcript view can render
   *  display names + roles. */
  voices: PodcastVoice[];
  durationMin?: number | undefined;
  hosts?: { alev: string; deniz: string } | undefined;
  /** Soft cap on streamed output tokens. Default 8000 fits ~30 min of
   *  dialogue with room for chapter beats and source refs. */
  maxTokens?: number | undefined;
  signal?: AbortSignal;
  /** Called when the first model response failed JSON parsing and a repair
   *  pass is about to run. UI can surface this as a distinct progress state. */
  onRepairAttempt?: ((detail: { parseError: string; preview: string }) => void) | undefined;
  /** Test injection point. Defaults to getChatProvider(presetId, opts). */
  chatProvider?: ChatProvider;
};

export type GeneratePodcastResult = {
  podcast: PodcastRecord;
  parsed: ParsedPodcast;
  usage: Usage;
  estimatedCostUsd: number;
  model: string;
};

export class PodcastGenError extends Error {
  constructor(
    public readonly code:
      | "unknown_model"
      | "no_sources"
      | "no_chunks"
      | "no_voices"
      | "stream_error"
      | "parse_error"
      | "no_segments"
      | "aborted",
    message: string,
  ) {
    super(message);
    this.name = "PodcastGenError";
  }
}

export function estimatePodcastScriptCost(
  model: string,
  usage: Usage,
): number {
  const p = PRICING[model];
  if (!p) return 0;
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreate = usage.cache_creation_input_tokens ?? 0;
  return (
    (inputTokens * p.input +
      outputTokens * p.output +
      cacheRead * p.cacheRead +
      cacheCreate * p.cacheCreation) /
    1_000_000
  );
}

function usageToRecord(usage: Usage): PodcastUsage {
  const out: PodcastUsage = {};
  if (typeof usage.input_tokens === "number") out.inputTokens = usage.input_tokens;
  if (typeof usage.output_tokens === "number") {
    out.outputTokens = usage.output_tokens;
  }
  if (typeof usage.cache_read_input_tokens === "number") {
    out.cacheReadTokens = usage.cache_read_input_tokens;
  }
  if (typeof usage.cache_creation_input_tokens === "number") {
    out.cacheCreationTokens = usage.cache_creation_input_tokens;
  }
  return out;
}

/**
 * Map ParsedPodcast (model output) to the inputs `createPodcast`
 * expects. Filters out segment sourceRefs that reference unknown
 * source/chunk ids — defensive against the model hallucinating ids that
 * weren't in <workspace_sources>. Pure.
 */
export function mapParsedScriptToInput(
  parsed: ParsedPodcast,
  knownSourceIds: ReadonlySet<string>,
  knownChunkIds: ReadonlySet<string>,
): { segments: PodcastSegment[]; chapters: PodcastChapter[] } {
  const segments: PodcastSegment[] = [];
  for (const raw of parsed.segments) {
    const refs = filterRefs(raw, knownSourceIds, knownChunkIds);
    const segment: PodcastSegment = {
      speaker: raw.speaker,
      text: raw.text,
    };
    if (refs.length > 0) segment.sourceRefs = refs;
    segments.push(segment);
  }
  // Clamp chapter segmentIndex into the final segment range so a
  // mid-stream drop can't leave a chapter dangling past the end.
  const lastIdx = Math.max(0, segments.length - 1);
  const chapters: PodcastChapter[] = parsed.chapters.map((ch) => ({
    title: ch.title,
    segmentIndex: Math.min(ch.segmentIndex, lastIdx),
    startMs: 0,
  }));
  return { segments, chapters };
}

function filterRefs(
  segment: ParsedPodcastSegment,
  knownSourceIds: ReadonlySet<string>,
  knownChunkIds: ReadonlySet<string>,
): PodcastSourceRef[] {
  const refs: PodcastSourceRef[] = [];
  for (const ref of segment.sourceRefs) {
    if (!knownSourceIds.has(ref.sourceId)) continue;
    const validChunkIds = ref.chunkIds?.filter((id) => knownChunkIds.has(id));
    const next: PodcastSourceRef = { sourceId: ref.sourceId };
    if (validChunkIds && validChunkIds.length > 0) {
      next.chunkIds = validChunkIds;
    }
    if (ref.section) next.section = ref.section;
    if (ref.quote) next.quote = ref.quote;
    refs.push(next);
  }
  return refs;
}

async function collectChatStream(
  provider: ChatProvider,
  request: ChatRequest,
  fallbackModel: string,
): Promise<{ buffer: string; usage: Usage; model: string }> {
  const handle = provider.streamChat(request);
  let buffer = "";
  let model = fallbackModel;
  let usage: Usage = {};
  try {
    for await (const event of handle.events) {
      if (event.kind === "text") {
        buffer += event.delta;
      } else if (event.kind === "start") {
        model = event.model || model;
        usage = event.usage ?? usage;
      } else if (event.kind === "delta") {
        usage = { ...usage, ...event.usage };
      } else if (event.kind === "error") {
        throw new PodcastGenError(
          "stream_error",
          `Provider error ${event.status}: ${event.message}`,
        );
      } else if (event.kind === "abort") {
        throw new PodcastGenError("aborted", "Podcast generation aborted");
      }
    }
  } catch (err) {
    if (err instanceof PodcastGenError) throw err;
    throw new PodcastGenError(
      "stream_error",
      err instanceof Error ? err.message : String(err),
    );
  }
  return { buffer, usage, model };
}

function resolvePodcastChatProvider(args: {
  modelId: string;
  authKind?: "oauth" | "api-key";
  chatProvider?: ChatProvider;
}): { provider: ChatProvider; upstreamModel: string } {
  const option = findChatOption(args.modelId);
  if (!option) {
    throw new PodcastGenError(
      "unknown_model",
      `Model not in registry: ${args.modelId}`,
    );
  }
  return {
    provider:
      args.chatProvider ??
      getChatProvider(option.presetId, {
        ...(args.authKind ? { authKind: args.authKind } : {}),
      }),
    upstreamModel: option.modelId,
  };
}

async function streamPodcastScriptOnce(args: {
  apiKey: string;
  authKind?: "oauth" | "api-key";
  modelId: string;
  locale: "tr" | "en";
  workspace: { name: string; goal?: string | undefined };
  sources: PodcastGenSource[];
  durationMin?: number | undefined;
  hosts?: { alev: string; deniz: string } | undefined;
  maxTokens: number;
  signal?: AbortSignal;
  chatProvider?: ChatProvider;
}): Promise<{ buffer: string; usage: Usage; model: string }> {
  const { provider, upstreamModel } = resolvePodcastChatProvider(args);
  const systemBlocks = buildPodcastScriptSystem({
    workspace: args.workspace,
    sources: args.sources,
    locale: args.locale,
    ...(args.durationMin !== undefined ? { durationMin: args.durationMin } : {}),
    ...(args.hosts !== undefined ? { hosts: args.hosts } : {}),
  });

  const request: ChatRequest = {
    apiKey: args.apiKey,
    ...(args.authKind ? { authKind: args.authKind } : {}),
    model: upstreamModel,
    system: systemBlocks,
    messages: [
      {
        role: "user",
        content:
          args.locale === "tr"
            ? "Lütfen yukarıdaki kaynaklardan iki sunuculu podcast senaryosunu şemaya uygun üret."
            : "Please produce the two-host podcast script for the sources above, conforming to the schema.",
      },
    ],
    maxTokens: args.maxTokens,
    ...(args.signal ? { signal: args.signal } : {}),
  };

  return collectChatStream(provider, request, upstreamModel);
}

function podcastRepairSystem(): SystemBlock[] {
  return [
    {
      type: "text",
      text: [
        "You repair podcast-script model output into valid JSON.",
        "Return ONLY one JSON object. No markdown fences, no commentary.",
        "Required top-level fields: title, chapters, segments.",
        "segments must contain objects with speaker ('alev' or 'deniz'), text, and sourceRefs array.",
        "chapters must contain objects with title and segmentIndex.",
        "If the draft is prose, convert it into a short valid two-host dialogue.",
      ].join("\n"),
    },
  ];
}

function previewModelOutput(buffer: string): string {
  const compact = buffer.replace(/\s+/g, " ").trim();
  if (!compact) return "(empty response)";
  return compact.length > 240 ? `${compact.slice(0, 240)}...` : compact;
}

async function repairPodcastScriptOnce(args: {
  apiKey: string;
  authKind?: "oauth" | "api-key";
  modelId: string;
  locale: "tr" | "en";
  brokenOutput: string;
  parseError: string;
  maxTokens: number;
  signal?: AbortSignal;
  chatProvider?: ChatProvider;
}): Promise<{ buffer: string; usage: Usage; model: string }> {
  const { provider, upstreamModel } = resolvePodcastChatProvider(args);
  const request: ChatRequest = {
    apiKey: args.apiKey,
    ...(args.authKind ? { authKind: args.authKind } : {}),
    model: upstreamModel,
    system: podcastRepairSystem(),
    messages: [
      {
        role: "user",
        content: [
          "Repair this failed podcast-script response into the required JSON object.",
          `Parse error: ${args.parseError}`,
          `Locale: ${args.locale}`,
          "",
          "<failed_response>",
          args.brokenOutput.slice(0, 16_000),
          "</failed_response>",
        ].join("\n"),
      },
    ],
    maxTokens: args.maxTokens,
    ...(args.signal ? { signal: args.signal } : {}),
  };
  return collectChatStream(provider, request, upstreamModel);
}

/**
 * Generate a podcast script for a workspace and persist a fresh
 * `PodcastRecord` (status="scripted"). The audio blob is left empty —
 * 5.B.B's TTS runner fills it. Throws on parse / abort / no-segment.
 */
export async function generatePodcastScript(
  args: GeneratePodcastArgs,
): Promise<GeneratePodcastResult> {
  if (args.sources.length === 0) {
    throw new PodcastGenError("no_sources", "No sources supplied");
  }
  if (args.voices.length === 0) {
    throw new PodcastGenError("no_voices", "No voices configured");
  }
  const totalChunks = args.sources.reduce((acc, s) => acc + s.chunks.length, 0);
  if (totalChunks === 0) {
    throw new PodcastGenError(
      "no_chunks",
      "Supplied sources have no chunks",
    );
  }
  if (args.signal?.aborted) {
    throw new PodcastGenError("aborted", "Podcast generation aborted");
  }

  const maxTokens = args.maxTokens ?? 8000;
  const streamArgs: Parameters<typeof streamPodcastScriptOnce>[0] = {
    apiKey: args.apiKey,
    modelId: args.modelId,
    locale: args.locale,
    workspace: args.workspace,
    sources: args.sources,
    maxTokens,
  };
  if (args.authKind) streamArgs.authKind = args.authKind;
  if (args.durationMin !== undefined) streamArgs.durationMin = args.durationMin;
  if (args.hosts !== undefined) streamArgs.hosts = args.hosts;
  if (args.signal) streamArgs.signal = args.signal;
  if (args.chatProvider) streamArgs.chatProvider = args.chatProvider;
  const { buffer, usage, model } = await streamPodcastScriptOnce(streamArgs);

  let parsed: ParsedPodcast;
  let finalUsage = usage;
  let finalModel = model;
  try {
    parsed = parsePodcastScript(buffer);
  } catch (err) {
    const parseError = err instanceof Error ? err.message : String(err);
    args.onRepairAttempt?.({
      parseError,
      preview: previewModelOutput(buffer),
    });
    const repairArgs: Parameters<typeof repairPodcastScriptOnce>[0] = {
      apiKey: args.apiKey,
      modelId: args.modelId,
      locale: args.locale,
      brokenOutput: buffer,
      parseError,
      maxTokens,
    };
    if (args.authKind) repairArgs.authKind = args.authKind;
    if (args.signal) repairArgs.signal = args.signal;
    if (args.chatProvider) repairArgs.chatProvider = args.chatProvider;
    try {
      const repaired = await repairPodcastScriptOnce(repairArgs);
      parsed = parsePodcastScript(repaired.buffer);
      finalUsage = { ...usage, ...repaired.usage };
      finalModel = repaired.model;
    } catch (repairErr) {
      const repairMessage =
        repairErr instanceof Error ? repairErr.message : String(repairErr);
      throw new PodcastGenError(
        "parse_error",
        `${parseError}. Repair failed: ${repairMessage}. Model output preview: ${previewModelOutput(buffer)}`,
      );
    }
  }

  const knownSourceIds = new Set(args.sources.map((s) => s.id));
  const knownChunkIds = new Set(
    args.sources.flatMap((s) => s.chunks.map((c) => c.id)),
  );
  const { segments, chapters } = mapParsedScriptToInput(
    parsed,
    knownSourceIds,
    knownChunkIds,
  );
  if (segments.length === 0) {
    throw new PodcastGenError(
      "no_segments",
      "Model returned no valid segments",
    );
  }

  const podcastUsage = usageToRecord(finalUsage);

  const podcast = await createPodcast({
    workspaceId: args.workspaceId,
    title: parsed.title,
    locale: args.locale,
    sourceIds: Array.from(knownSourceIds),
    segments,
    chapters,
    voices: args.voices,
    modelId: finalModel,
    generationPromptVersion: PODCAST_SCRIPT_PROMPT_VERSION,
    status: "scripted",
    ...(parsed.titleEn ? { titleEn: parsed.titleEn } : {}),
    ...(parsed.description ? { description: parsed.description } : {}),
    ...(Object.keys(podcastUsage).length > 0 ? { usage: podcastUsage } : {}),
  });

  return {
    podcast,
    parsed,
    usage: finalUsage,
    estimatedCostUsd: estimatePodcastScriptCost(finalModel, finalUsage),
    model: finalModel,
  };
}
