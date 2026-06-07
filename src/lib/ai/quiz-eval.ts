import { findChatOption } from "@/lib/ai/model-options";
import { PRICING } from "@/lib/ai/pricing";
import {
  buildQuizEvalSystem,
  parseQuizEvalOutput,
  type QuizEvalInput,
  type QuizEvalResult,
} from "@/lib/ai/prompts/quiz-eval";
import { getChatProvider } from "@/lib/ai/providers/registry";
import type { ChatRequest, Usage } from "@/lib/ai/providers/types";

export type RunQuizEvalArgs = QuizEvalInput & {
  modelId: string;
  apiKey: string;
  /** Anthropic only: "oauth" routes through /api/ai/chat-oauth instead of
   *  /api/ai/chat. Other presets ignore. */
  authKind?: "oauth" | "api-key";
  signal?: AbortSignal;
};

export type RunQuizEvalResult = QuizEvalResult & {
  usage: Usage;
  estimatedCostUsd: number;
  model: string;
};

class QuizEvalError extends Error {
  constructor(
    public readonly code:
      | "unknown_model"
      | "stream_error"
      | "parse_error"
      | "aborted",
    message: string,
  ) {
    super(message);
    this.name = "QuizEvalError";
  }
}

export { QuizEvalError };

export function estimateQuizEvalCost(model: string, usage: Usage): number {
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
 * Drive a chat provider through the quiz-eval prompt and parse the JSON.
 * Mirrors runQuizGen's structure so the proxy + caching paths are reused.
 * Caller picks the model id (typically `prefs.modelBindings.summary` so the
 * eval call goes to a cheaper tier than the gen call).
 */
export async function runQuizEval(
  args: RunQuizEvalArgs,
): Promise<RunQuizEvalResult> {
  const option = findChatOption(args.modelId);
  if (!option) {
    throw new QuizEvalError(
      "unknown_model",
      `Model not in registry: ${args.modelId}`,
    );
  }
  const provider = getChatProvider(option.presetId, {
    ...(args.authKind ? { authKind: args.authKind } : {}),
  });
  const upstreamModel = option.modelId;
  const systemBlocks = buildQuizEvalSystem({
    question: args.question,
    rubric: args.rubric,
    userAnswer: args.userAnswer,
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
            ? "Lütfen yukarıdaki cevabı rubric'e göre değerlendir ve şemaya uy."
            : "Please evaluate the answer above against the rubric, conforming to the schema.",
      },
    ],
    // Eval is short — verdict + 1-3 sentences. 400 covers the longest realistic
    // feedback comfortably and bounds cost on broken streams.
    maxTokens: 400,
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
        throw new QuizEvalError(
          "stream_error",
          `Provider error ${event.status}: ${event.message}`,
        );
      } else if (event.kind === "abort") {
        throw new QuizEvalError("aborted", "Eval aborted");
      }
    }
  } catch (err) {
    if (err instanceof QuizEvalError) throw err;
    throw new QuizEvalError(
      "stream_error",
      err instanceof Error ? err.message : String(err),
    );
  }

  let parsed: QuizEvalResult;
  try {
    parsed = parseQuizEvalOutput(buffer);
  } catch (err) {
    throw new QuizEvalError(
      "parse_error",
      err instanceof Error ? err.message : String(err),
    );
  }

  return {
    ...parsed,
    usage,
    estimatedCostUsd: estimateQuizEvalCost(model, usage),
    model,
  };
}
