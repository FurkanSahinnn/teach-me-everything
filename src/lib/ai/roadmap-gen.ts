import { findChatOption } from "@/lib/ai/model-options";
import { PRICING } from "@/lib/ai/pricing";
import {
  buildRoadmapGenSystem,
  buildRoadmapGenUserMessage,
  buildRoadmapSubtaskSystem,
  buildRoadmapSubtaskUserMessage,
  buildRoadmapTranslateSystem,
  buildRoadmapTranslateUserMessage,
  type RoadmapGenSystemInput,
  type RoadmapSubtaskSystemInput,
  type RoadmapTranslateItem,
} from "@/lib/ai/prompts/roadmap-gen";
import { getChatProvider } from "@/lib/ai/providers/registry";
import type { ChatRequest, Usage } from "@/lib/ai/providers/types";
import {
  parseRoadmapResponse,
  parseRoadmapTranslateResponse,
  parseSubtaskResponse,
  type RoadmapAiResponse,
  type SubtaskAiResponse,
} from "@/lib/roadmap/schema";
import {
  getMaxOutputTokens,
  getSubtaskMaxOutputTokens,
} from "@/lib/roadmap/token-budget";

// Distinct error code so the wizard UI can switch on a stable identifier
// instead of message parsing. `unknown_model` and `stream_error` mirror the
// flashcard runner; `parse_error` covers Zod schema + structural failures
// surfaced by parseRoadmapResponse.
export class RoadmapGenError extends Error {
  constructor(
    public readonly code:
      | "unknown_model"
      | "stream_error"
      | "aborted"
      | "parse_error"
      | "empty_response"
      | "content_filter",
    message: string,
  ) {
    super(message);
    this.name = "RoadmapGenError";
  }
}

function estimateCost(model: string, usage: Usage): number {
  const p = PRICING[model];
  if (!p) return 0;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreate = usage.cache_creation_input_tokens ?? 0;
  return (
    (input * p.input +
      output * p.output +
      cacheRead * p.cacheRead +
      cacheCreate * p.cacheCreation) /
    1_000_000
  );
}

// Common signature both flows share. Auth + signal mirror flashcard-gen for
// consistency; callers can wire them to AbortController + OAuth state.
export type RoadmapGenSharedArgs = {
  modelId: string;
  apiKey: string;
  authKind?: "oauth" | "api-key" | undefined;
  signal?: AbortSignal | undefined;
};

export type RunRoadmapGenArgs = RoadmapGenSharedArgs &
  RoadmapGenSystemInput;

export type RunRoadmapGenResult = {
  response: RoadmapAiResponse;
  usage: Usage;
  estimatedCostUsd: number;
  model: string;
  rawResponse: string;
};

// Send one shot to the chat provider, drain the stream into a buffer, parse
// the JSON with the Zod-backed validator. Returns a typed `RoadmapAiResponse`
// that the repo can insert directly — temp ids stay on the response object,
// the repo mints persistent ones on bulkAdd.
export async function runRoadmapGen(
  args: RunRoadmapGenArgs,
): Promise<RunRoadmapGenResult> {
  const option = findChatOption(args.modelId);
  if (!option) {
    throw new RoadmapGenError(
      "unknown_model",
      `Model not in registry: ${args.modelId}`,
    );
  }
  const provider = getChatProvider(option.presetId, {
    ...(args.authKind ? { authKind: args.authKind } : {}),
  });
  const upstreamModel = option.modelId;
  const system = buildRoadmapGenSystem(args);
  const userText = buildRoadmapGenUserMessage(args);
  const request: ChatRequest = {
    apiKey: args.apiKey,
    ...(args.authKind ? { authKind: args.authKind } : {}),
    model: upstreamModel,
    system,
    messages: [{ role: "user", content: userText }],
    maxTokens: getMaxOutputTokens(args.timeframe),
    ...(args.signal ? { signal: args.signal } : {}),
  };
  const { buffer, model, usage, stopReason } = await drainStream(
    provider.streamChat(request),
    upstreamModel,
  );
  if (buffer.trim().length === 0) {
    throw emptyOrFilterError(stopReason);
  }
  const parsed = parseRoadmapResponse(buffer);
  if (!parsed.ok) {
    throw new RoadmapGenError(
      "parse_error",
      `${parsed.reason}${parsed.detail ? `: ${parsed.detail}` : ""}`,
    );
  }
  return {
    response: parsed.value,
    usage,
    estimatedCostUsd: estimateCost(model, usage),
    model,
    rawResponse: buffer,
  };
}

export type RunRoadmapSubtaskArgs = RoadmapGenSharedArgs &
  RoadmapSubtaskSystemInput;

export type RunRoadmapSubtaskResult = {
  response: SubtaskAiResponse;
  usage: Usage;
  estimatedCostUsd: number;
  model: string;
  rawResponse: string;
};

export async function runRoadmapSubtask(
  args: RunRoadmapSubtaskArgs,
): Promise<RunRoadmapSubtaskResult> {
  const option = findChatOption(args.modelId);
  if (!option) {
    throw new RoadmapGenError(
      "unknown_model",
      `Model not in registry: ${args.modelId}`,
    );
  }
  const provider = getChatProvider(option.presetId, {
    ...(args.authKind ? { authKind: args.authKind } : {}),
  });
  const upstreamModel = option.modelId;
  const system = buildRoadmapSubtaskSystem(args);
  const userText = buildRoadmapSubtaskUserMessage(args);
  const request: ChatRequest = {
    apiKey: args.apiKey,
    ...(args.authKind ? { authKind: args.authKind } : {}),
    model: upstreamModel,
    system,
    messages: [{ role: "user", content: userText }],
    maxTokens: getSubtaskMaxOutputTokens(),
    ...(args.signal ? { signal: args.signal } : {}),
  };
  const { buffer, model, usage, stopReason } = await drainStream(
    provider.streamChat(request),
    upstreamModel,
  );
  if (buffer.trim().length === 0) {
    throw emptyOrFilterError(stopReason);
  }
  const parsed = parseSubtaskResponse(buffer);
  if (!parsed.ok) {
    throw new RoadmapGenError(
      "parse_error",
      `${parsed.reason}${parsed.detail ? `: ${parsed.detail}` : ""}`,
    );
  }
  return {
    response: parsed.value,
    usage,
    estimatedCostUsd: estimateCost(model, usage),
    model,
    rawResponse: buffer,
  };
}

// ---------------------------------------------------------------------------
// Translation pass (langMode "both")
// ---------------------------------------------------------------------------

export type RoadmapTranslation = { title: string; description: string };

export type RunRoadmapTranslateArgs = RoadmapGenSharedArgs & {
  target: "tr" | "en";
  items: RoadmapTranslateItem[];
  // Override the per-call batch size; defaults to TRANSLATE_BATCH_SIZE.
  batchSize?: number | undefined;
};

export type RunRoadmapTranslateResult = {
  // id → translated fields. Ids absent from the map failed to translate; the
  // caller keeps the source-language text for those.
  translations: Map<string, RoadmapTranslation>;
  usage: Usage;
  estimatedCostUsd: number;
  model: string;
  // True when at least one batch failed — the result is usable but incomplete.
  partial: boolean;
};

// Roadmaps top out at ~24 nodes, but batching keeps each call small + lets the
// batches run concurrently (the user's explicit "parallel, batch if large"
// directive) so a big graph doesn't ride on one slow request.
const TRANSLATE_BATCH_SIZE = 12;

function mergeUsage(a: Usage, b: Usage): Usage {
  return {
    input_tokens: (a.input_tokens ?? 0) + (b.input_tokens ?? 0),
    output_tokens: (a.output_tokens ?? 0) + (b.output_tokens ?? 0),
    cache_read_input_tokens:
      (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens:
      (a.cache_creation_input_tokens ?? 0) +
      (b.cache_creation_input_tokens ?? 0),
  };
}

// Translate node title/description into `target`, preserving ids so the caller
// can map translations back onto the unchanged structure. Batches run in
// parallel; a failed batch degrades to "those ids untranslated" rather than
// sinking the whole pass.
export async function runRoadmapTranslate(
  args: RunRoadmapTranslateArgs,
): Promise<RunRoadmapTranslateResult> {
  const option = findChatOption(args.modelId);
  if (!option) {
    throw new RoadmapGenError(
      "unknown_model",
      `Model not in registry: ${args.modelId}`,
    );
  }
  const provider = getChatProvider(option.presetId, {
    ...(args.authKind ? { authKind: args.authKind } : {}),
  });
  const upstreamModel = option.modelId;
  const system = buildRoadmapTranslateSystem(args.target);
  const batchSize = args.batchSize ?? TRANSLATE_BATCH_SIZE;

  const batches: RoadmapTranslateItem[][] = [];
  for (let i = 0; i < args.items.length; i += batchSize) {
    batches.push(args.items.slice(i, i + batchSize));
  }

  const results = await Promise.allSettled(
    batches.map(async (batch) => {
      const request: ChatRequest = {
        apiKey: args.apiKey,
        ...(args.authKind ? { authKind: args.authKind } : {}),
        model: upstreamModel,
        system,
        messages: [
          { role: "user", content: buildRoadmapTranslateUserMessage(batch) },
        ],
        maxTokens: getMaxOutputTokens("monthly"),
        ...(args.signal ? { signal: args.signal } : {}),
      };
      const { buffer, model, usage } = await drainStream(
        provider.streamChat(request),
        upstreamModel,
      );
      const parsed = parseRoadmapTranslateResponse(buffer);
      if (!parsed.ok) {
        throw new RoadmapGenError(
          "parse_error",
          `${parsed.reason}${parsed.detail ? `: ${parsed.detail}` : ""}`,
        );
      }
      return { items: parsed.value.items, model, usage };
    }),
  );

  const translations = new Map<string, RoadmapTranslation>();
  let usage: Usage = {};
  let model = upstreamModel;
  let partial = false;
  for (const r of results) {
    if (r.status === "fulfilled") {
      for (const it of r.value.items) {
        translations.set(it.id, {
          title: it.title,
          description: it.description,
        });
      }
      model = r.value.model;
      usage = mergeUsage(usage, r.value.usage);
    } else {
      partial = true;
    }
  }

  return {
    translations,
    usage,
    estimatedCostUsd: estimateCost(model, usage),
    model,
    partial,
  };
}

// Shared stream consumer — same shape as flashcard-gen's inline loop, lifted
// here so both flows stay in sync. Returns the assembled text buffer + the
// authoritative model id / usage emitted by the provider.
async function drainStream(
  handle: ReturnType<
    ReturnType<typeof getChatProvider>["streamChat"]
  >,
  fallbackModel: string,
): Promise<{
  buffer: string;
  model: string;
  usage: Usage;
  stopReason: string | null;
}> {
  let buffer = "";
  let model = fallbackModel;
  let usage: Usage = {};
  let stopReason: string | null = null;
  try {
    for await (const event of handle.events) {
      if (event.kind === "text") {
        buffer += event.delta;
      } else if (event.kind === "start") {
        model = event.model || model;
        usage = event.usage ?? usage;
      } else if (event.kind === "delta") {
        usage = { ...usage, ...event.usage };
        if (event.stopReason != null) stopReason = event.stopReason;
      } else if (event.kind === "error") {
        throw new RoadmapGenError(
          "stream_error",
          `Provider error ${event.status}: ${event.message}`,
        );
      } else if (event.kind === "abort") {
        throw new RoadmapGenError("aborted", "Generation aborted");
      }
    }
  } catch (err) {
    if (err instanceof RoadmapGenError) throw err;
    throw new RoadmapGenError(
      "stream_error",
      err instanceof Error ? err.message : String(err),
    );
  }
  return { buffer, model, usage, stopReason };
}

// An empty buffer usually means the provider blocked its OWN output — Gemini in
// particular returns finishReason SAFETY/RECITATION with no text and no error
// event (RECITATION fires often on textbook-/curriculum-style output). Surface
// that distinctly so the user knows to switch model / rephrase rather than
// staring at a blank "no text" error.
function emptyOrFilterError(stopReason: string | null): RoadmapGenError {
  if (stopReason === "content_filter") {
    return new RoadmapGenError(
      "content_filter",
      "The model blocked its own output (safety / recitation filter).",
    );
  }
  return new RoadmapGenError("empty_response", "Model returned no text");
}
