import { findChatOption } from "@/lib/ai/model-options";
import { PRICING } from "@/lib/ai/pricing";
import {
  buildQuizGenSystem,
  clampQuizCount,
  parseQuizGenOutput,
  type QuizGenInput,
  type QuizMode,
} from "@/lib/ai/prompts/quiz-gen";
import { getChatProvider } from "@/lib/ai/providers/registry";
import type { ChatRequest, Usage } from "@/lib/ai/providers/types";
import type { QuizItem } from "@/lib/quiz/types";

export type RunQuizGenArgs = QuizGenInput & {
  modelId: string;
  apiKey: string;
  /** Anthropic only: "oauth" routes through /api/ai/chat-oauth instead of
   *  /api/ai/chat. Other presets ignore. */
  authKind?: "oauth" | "api-key";
  signal?: AbortSignal;
};

export type RunQuizGenResult = {
  items: QuizItem[];
  usage: Usage;
  estimatedCostUsd: number;
  model: string;
};

class QuizGenError extends Error {
  constructor(
    public readonly code:
      | "unknown_model"
      | "stream_error"
      | "parse_error"
      | "no_items"
      | "aborted",
    message: string,
  ) {
    super(message);
    this.name = "QuizGenError";
  }
}

export { QuizGenError };

/** USD estimate from provider-reported usage; mirrors estimateCost in
 *  flashcard-gen.ts. Local / free presets fall through to 0. */
export function estimateQuizCost(model: string, usage: Usage): number {
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
 * Drive a chat provider through the quiz-gen prompt and parse the streamed
 * JSON. JSON-in-text mode (no tools) — same shape as runFlashcardGen so
 * the proxy + caching paths are reused. Returns the validated items plus
 * usage telemetry.
 */
export async function runQuizGen(
  args: RunQuizGenArgs,
): Promise<RunQuizGenResult> {
  const option = findChatOption(args.modelId);
  if (!option) {
    throw new QuizGenError(
      "unknown_model",
      `Model not in registry: ${args.modelId}`,
    );
  }
  const provider = getChatProvider(option.presetId, {
    ...(args.authKind ? { authKind: args.authKind } : {}),
  });
  const upstreamModel = option.modelId;
  const count = clampQuizCount(args.count);

  const mode: QuizMode = args.mode ?? "mcq";
  const systemBlocks = buildQuizGenSystem({
    source: args.source,
    chunks: args.chunks,
    locale: args.locale,
    count,
    mode,
    ...(args.keepEnglishTerms !== undefined
      ? { keepEnglishTerms: args.keepEnglishTerms }
      : {}),
  });

  const userMsgTr =
    mode === "mcq"
      ? `Lütfen yukarıdaki kaynak için tam olarak ${count} MCQ üret ve şemaya uy.`
      : mode === "open"
        ? `Lütfen yukarıdaki kaynak için tam olarak ${count} açık uçlu soru üret ve her birine rubric ekle.`
        : `Lütfen yukarıdaki kaynak için tam olarak ${count} quiz item'ı üret (MCQ + açık uçlu karışık) ve şemaya uy.`;
  const userMsgEn =
    mode === "mcq"
      ? `Please produce exactly ${count} MCQ items from the source above, conforming to the schema.`
      : mode === "open"
        ? `Please produce exactly ${count} open-ended items from the source above with a rubric on each.`
        : `Please produce exactly ${count} quiz items (MCQ + open-ended mixed) from the source above, conforming to the schema.`;

  const request: ChatRequest = {
    apiKey: args.apiKey,
    ...(args.authKind ? { authKind: args.authKind } : {}),
    model: upstreamModel,
    system: systemBlocks,
    messages: [
      {
        role: "user",
        content: args.locale === "tr" ? userMsgTr : userMsgEn,
      },
    ],
    // MCQ items run ~140 output tokens each (q + 4 choices + explanation);
    // open items add ~80 for the rubric. Floor of 800 protects 1-item runs.
    maxTokens: Math.max(800, count * (mode === "open" ? 220 : 200)),
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
        throw new QuizGenError(
          "stream_error",
          `Provider error ${event.status}: ${event.message}`,
        );
      } else if (event.kind === "abort") {
        throw new QuizGenError("aborted", "Generation aborted");
      }
    }
  } catch (err) {
    if (err instanceof QuizGenError) throw err;
    throw new QuizGenError(
      "stream_error",
      err instanceof Error ? err.message : String(err),
    );
  }

  let parsed;
  try {
    parsed = parseQuizGenOutput(buffer, mode);
  } catch (err) {
    throw new QuizGenError(
      "parse_error",
      err instanceof Error ? err.message : String(err),
    );
  }

  const items = parsed.items.slice(0, count);
  if (items.length === 0) {
    throw new QuizGenError("no_items", "Model returned no usable items");
  }

  return {
    items,
    usage,
    estimatedCostUsd: estimateQuizCost(model, usage),
    model,
  };
}
