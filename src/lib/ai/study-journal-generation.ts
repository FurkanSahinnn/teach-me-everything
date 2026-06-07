// Study journal metadata generation runner. Drives a chat provider through
// the `study-journal` prompt and parses the JSON output. No Dexie write —
// the caller (SaveJournalEntryModal) merges parsed metadata with user-edited
// fields before persisting via createStudyJournalEntry.
//
// `chatProvider` is an injectable arg so tests pass a fake provider
// without `vi.mock`-ing the registry.

import { findChatOption } from "@/lib/ai/model-options";
import { PRICING } from "@/lib/ai/pricing";
import {
  buildStudyJournalSystem,
  parseStudyJournalOutput,
  type ParsedStudyJournalMeta,
} from "@/lib/ai/prompts/study-journal";
import { getChatProvider } from "@/lib/ai/providers/registry";
import type {
  ChatProvider,
  ChatRequest,
  Usage,
} from "@/lib/ai/providers/types";

export const STUDY_JOURNAL_PROMPT_VERSION = "study-journal-v1";

export type GenerateStudyJournalMetaArgs = {
  workspace: { name: string; goal?: string | undefined };
  source?:
    | {
        title?: string | undefined;
        titleEn?: string | undefined;
        author?: string | undefined;
      }
    | undefined;
  question: string;
  answerMarkdown: string;
  citedSections?: string[] | undefined;
  // Resolved upfront from prefs.modelBindings.quick by the caller.
  modelId: string;
  apiKey: string;
  /** Anthropic only: "oauth" routes through /api/ai/chat-oauth. */
  authKind?: "oauth" | "api-key";
  locale: "tr" | "en";
  signal?: AbortSignal;
  /** Test injection point. Defaults to getChatProvider(presetId, opts). */
  chatProvider?: ChatProvider;
};

export type GenerateStudyJournalMetaResult = {
  parsed: ParsedStudyJournalMeta;
  usage: Usage;
  estimatedCostUsd: number;
  model: string;
};

export class StudyJournalGenError extends Error {
  constructor(
    public readonly code:
      | "unknown_model"
      | "empty_input"
      | "stream_error"
      | "parse_error"
      | "aborted",
    message: string,
  ) {
    super(message);
    this.name = "StudyJournalGenError";
  }
}

export function estimateStudyJournalCost(model: string, usage: Usage): number {
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

async function streamStudyJournalOnce(args: {
  apiKey: string;
  authKind?: "oauth" | "api-key";
  modelId: string;
  locale: "tr" | "en";
  workspace: { name: string; goal?: string | undefined };
  source?:
    | {
        title?: string | undefined;
        titleEn?: string | undefined;
        author?: string | undefined;
      }
    | undefined;
  question: string;
  answerMarkdown: string;
  citedSections?: string[] | undefined;
  signal?: AbortSignal;
  chatProvider?: ChatProvider;
}): Promise<{ buffer: string; usage: Usage; model: string }> {
  const option = findChatOption(args.modelId);
  if (!option) {
    throw new StudyJournalGenError(
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
  const systemBlocks = buildStudyJournalSystem({
    workspace: args.workspace,
    ...(args.source ? { source: args.source } : {}),
    question: args.question,
    answerMarkdown: args.answerMarkdown,
    locale: args.locale,
    ...(args.citedSections ? { citedSections: args.citedSections } : {}),
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
            ? "Lütfen bu Q&A girdisi için başlık + etiketleri şemada üret."
            : "Please produce the title + tags for this Q&A entry, conforming to the schema.",
      },
    ],
    // Metadata-only output: title + 2-5 tags + optional 1-2 sentence
    // summary fits comfortably in 600 tokens; floor at 800 for envelope.
    maxTokens: 800,
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
        throw new StudyJournalGenError(
          "stream_error",
          `Provider error ${event.status}: ${event.message}`,
        );
      } else if (event.kind === "abort") {
        throw new StudyJournalGenError(
          "aborted",
          "Study journal generation aborted",
        );
      }
    }
  } catch (err) {
    if (err instanceof StudyJournalGenError) throw err;
    throw new StudyJournalGenError(
      "stream_error",
      err instanceof Error ? err.message : String(err),
    );
  }
  return { buffer, usage, model };
}

/**
 * Generate study-journal metadata (title + tags + optional summary) for
 * one Q&A turn. Pure with respect to Dexie — caller persists. Throws on
 * empty inputs, unknown models, parse errors, or aborts.
 */
export async function generateStudyJournalMeta(
  args: GenerateStudyJournalMetaArgs,
): Promise<GenerateStudyJournalMetaResult> {
  if (!args.question.trim() || !args.answerMarkdown.trim()) {
    throw new StudyJournalGenError(
      "empty_input",
      "Both question and answer text are required",
    );
  }
  if (args.signal?.aborted) {
    throw new StudyJournalGenError(
      "aborted",
      "Study journal generation aborted",
    );
  }

  const streamArgs: Parameters<typeof streamStudyJournalOnce>[0] = {
    apiKey: args.apiKey,
    modelId: args.modelId,
    locale: args.locale,
    workspace: args.workspace,
    question: args.question,
    answerMarkdown: args.answerMarkdown,
  };
  if (args.authKind) streamArgs.authKind = args.authKind;
  if (args.source) streamArgs.source = args.source;
  if (args.citedSections) streamArgs.citedSections = args.citedSections;
  if (args.signal) streamArgs.signal = args.signal;
  if (args.chatProvider) streamArgs.chatProvider = args.chatProvider;
  const { buffer, usage, model } = await streamStudyJournalOnce(streamArgs);

  let parsed: ParsedStudyJournalMeta;
  try {
    parsed = parseStudyJournalOutput(buffer);
  } catch (err) {
    throw new StudyJournalGenError(
      "parse_error",
      err instanceof Error ? err.message : String(err),
    );
  }

  return {
    parsed,
    usage,
    estimatedCostUsd: estimateStudyJournalCost(model, usage),
    model,
  };
}
