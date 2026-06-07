// Lesson note generation runner. Drives a chat provider through the
// `lesson-note` prompt, parses the JSON output, and persists via
// `createLessonNote`. Mirrors curriculum-generation.ts in shape so a single
// model-binding + auth resolution path covers both surfaces.
//
// `chatProvider` is an injectable arg so tests pass a fake provider
// without `vi.mock`-ing the registry.

import { findChatOption } from "@/lib/ai/model-options";
import { PRICING } from "@/lib/ai/pricing";
import {
  buildLessonNoteSystem,
  parseLessonNoteOutput,
  type ParsedLessonNote,
} from "@/lib/ai/prompts/lesson-note";
import { getChatProvider } from "@/lib/ai/providers/registry";
import type {
  ChatProvider,
  ChatRequest,
  Usage,
} from "@/lib/ai/providers/types";
import {
  createLessonNote,
  type CreateLessonNoteInput,
  getLessonNote,
  updateLessonNote,
  type UpdateLessonNoteInput,
} from "@/lib/db/study";
import type { ChunkRecord, SourceRecord } from "@/lib/db/types";
import type {
  LessonNoteRecord,
  StudySourceRef,
} from "@/lib/study/types";

export const LESSON_NOTE_PROMPT_VERSION = "lesson-note-v1";

export type LessonNoteGenSource = Pick<
  SourceRecord,
  "id" | "title" | "titleEn" | "type" | "author"
> & {
  chunks: Array<
    Pick<ChunkRecord, "id" | "index" | "section" | "headings" | "text" | "page">
  >;
};

export type GenerateLessonNoteArgs = {
  workspaceId: string;
  curriculumItemId: string;
  workspace: { name: string; goal?: string | undefined };
  item: {
    title: string;
    objective: string;
    sourceRefs: StudySourceRef[];
  };
  // Caller-supplied source records with chunks (the runner stays Dexie-free).
  sources: LessonNoteGenSource[];
  // Resolved upfront from prefs.modelBindings.summary by the caller.
  modelId: string;
  apiKey: string;
  /** Anthropic only: "oauth" routes through /api/ai/chat-oauth. */
  authKind?: "oauth" | "api-key";
  locale: "tr" | "en";
  signal?: AbortSignal;
  /** Test injection point. Defaults to getChatProvider(presetId, opts). */
  chatProvider?: ChatProvider;
  /**
   * If supplied, the runner updates this lesson note in place instead of
   * inserting a new row. Used by "Regenerate with AI" so the URL/lessonId
   * stays stable across retries.
   */
  existingNoteId?: string;
};

export type GenerateLessonNoteResult = {
  note: LessonNoteRecord;
  parsed: ParsedLessonNote;
  usage: Usage;
  estimatedCostUsd: number;
  model: string;
};

export class LessonNoteGenError extends Error {
  constructor(
    public readonly code:
      | "unknown_model"
      | "no_sources"
      | "no_chunks"
      | "stream_error"
      | "parse_error"
      | "no_refs"
      | "aborted"
      | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "LessonNoteGenError";
  }
}

export function estimateLessonNoteCost(model: string, usage: Usage): number {
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

/**
 * Filter parsed sourceRefs against known source/chunk ids — defensive
 * against the model citing ids that weren't in <lesson_sources>. Pure.
 */
export function filterValidRefs(
  refs: StudySourceRef[],
  knownSourceIds: ReadonlySet<string>,
  knownChunkIds: ReadonlySet<string>,
): StudySourceRef[] {
  const out: StudySourceRef[] = [];
  for (const ref of refs) {
    if (!knownSourceIds.has(ref.sourceId)) continue;
    const validChunkIds = ref.chunkIds?.filter((id) => knownChunkIds.has(id));
    const next: StudySourceRef = { sourceId: ref.sourceId };
    if (validChunkIds && validChunkIds.length > 0) {
      next.chunkIds = validChunkIds;
    }
    if (ref.section) next.section = ref.section;
    if (ref.quote) next.quote = ref.quote;
    out.push(next);
  }
  return out;
}

async function streamLessonNoteOnce(args: {
  apiKey: string;
  authKind?: "oauth" | "api-key";
  modelId: string;
  locale: "tr" | "en";
  workspace: { name: string; goal?: string | undefined };
  item: { title: string; objective: string; sourceRefs: StudySourceRef[] };
  sources: LessonNoteGenSource[];
  signal?: AbortSignal;
  chatProvider?: ChatProvider;
}): Promise<{ buffer: string; usage: Usage; model: string }> {
  const option = findChatOption(args.modelId);
  if (!option) {
    throw new LessonNoteGenError(
      "unknown_model",
      `Model not in registry: ${args.modelId}`,
    );
  }
  const provider =
    args.chatProvider ??
    getChatProvider(option.presetId, {
      ...(args.authKind ? { authKind: args.authKind } : {}),
    });
  const upstreamModel = option.modelId;
  const systemBlocks = buildLessonNoteSystem({
    workspace: args.workspace,
    item: args.item,
    sources: args.sources,
    locale: args.locale,
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
            ? "Lütfen seçili konu için ders notunu şemada üret."
            : "Please produce the lesson note for the selected topic, conforming to the schema.",
      },
    ],
    // Lesson notes target ~1500-2500 token Markdown bodies; 4000 floor
    // covers the JSON envelope + sourceRefs without truncation.
    maxTokens: 4000,
    ...(args.signal ? { signal: args.signal } : {}),
  };

  const handle = provider.streamChat(request);
  let buffer = "";
  let model = upstreamModel;
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
        throw new LessonNoteGenError(
          "stream_error",
          `Provider error ${event.status}: ${event.message}`,
        );
      } else if (event.kind === "abort") {
        throw new LessonNoteGenError("aborted", "Lesson note generation aborted");
      }
    }
  } catch (err) {
    if (err instanceof LessonNoteGenError) throw err;
    throw new LessonNoteGenError(
      "stream_error",
      err instanceof Error ? err.message : String(err),
    );
  }
  return { buffer, usage, model };
}

/**
 * Generate a lesson note for one curriculum item. Calls the model once,
 * parses the JSON output, filters refs by known ids, and persists via
 * `createLessonNote`. Throws when no usable refs survive filtering.
 */
export async function generateLessonNote(
  args: GenerateLessonNoteArgs,
): Promise<GenerateLessonNoteResult> {
  if (args.sources.length === 0) {
    throw new LessonNoteGenError("no_sources", "No sources supplied");
  }
  const totalChunks = args.sources.reduce((acc, s) => acc + s.chunks.length, 0);
  if (totalChunks === 0) {
    throw new LessonNoteGenError(
      "no_chunks",
      "Supplied sources have no chunks",
    );
  }
  if (args.signal?.aborted) {
    throw new LessonNoteGenError("aborted", "Lesson note generation aborted");
  }

  const streamArgs: Parameters<typeof streamLessonNoteOnce>[0] = {
    apiKey: args.apiKey,
    modelId: args.modelId,
    locale: args.locale,
    workspace: args.workspace,
    item: args.item,
    sources: args.sources,
  };
  if (args.authKind) streamArgs.authKind = args.authKind;
  if (args.signal) streamArgs.signal = args.signal;
  if (args.chatProvider) streamArgs.chatProvider = args.chatProvider;
  const { buffer, usage, model } = await streamLessonNoteOnce(streamArgs);

  let parsed: ParsedLessonNote;
  try {
    parsed = parseLessonNoteOutput(buffer);
  } catch (err) {
    throw new LessonNoteGenError(
      "parse_error",
      err instanceof Error ? err.message : String(err),
    );
  }

  const knownSourceIds = new Set(args.sources.map((s) => s.id));
  const knownChunkIds = new Set(
    args.sources.flatMap((s) => s.chunks.map((c) => c.id)),
  );
  const validRefs = filterValidRefs(parsed.sourceRefs, knownSourceIds, knownChunkIds);
  if (validRefs.length === 0) {
    throw new LessonNoteGenError(
      "no_refs",
      "Model returned no source refs that match supplied sources",
    );
  }

  const noteInput: CreateLessonNoteInput = {
    workspaceId: args.workspaceId,
    curriculumItemId: args.curriculumItemId,
    title: parsed.title,
    contentMarkdown: parsed.contentMarkdown,
    sourceRefs: validRefs,
    generationPromptVersion: LESSON_NOTE_PROMPT_VERSION,
    modelId: model,
    status: "ready",
  };
  const usageRecord = {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens,
    cacheCreationTokens: usage.cache_creation_input_tokens,
  };
  if (
    usageRecord.inputTokens !== undefined ||
    usageRecord.outputTokens !== undefined ||
    usageRecord.cacheReadTokens !== undefined ||
    usageRecord.cacheCreationTokens !== undefined
  ) {
    noteInput.usage = usageRecord;
  }
  let note: LessonNoteRecord;
  if (args.existingNoteId) {
    const patch: UpdateLessonNoteInput = {
      title: noteInput.title,
      contentMarkdown: noteInput.contentMarkdown,
      sourceRefs: noteInput.sourceRefs,
      generationPromptVersion: noteInput.generationPromptVersion,
      modelId: noteInput.modelId,
      status: noteInput.status ?? "ready",
    };
    if (noteInput.usage) patch.usage = noteInput.usage;
    await updateLessonNote(args.existingNoteId, patch);
    const fetched = await getLessonNote(args.existingNoteId);
    if (!fetched) {
      throw new LessonNoteGenError(
        "not_found",
        `Lesson note not found after update: ${args.existingNoteId}`,
      );
    }
    note = fetched;
  } else {
    note = await createLessonNote(noteInput);
  }

  return {
    note,
    parsed,
    usage,
    estimatedCostUsd: estimateLessonNoteCost(model, usage),
    model,
  };
}
