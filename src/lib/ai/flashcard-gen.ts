import { findChatOption } from "@/lib/ai/model-options";
import {
  buildFlashcardGenSystem,
  clampCount,
  dedupeFlashcardCards,
  parseFlashcardGenOutput,
  type FlashcardGenCard,
  type FlashcardGenInput,
} from "@/lib/ai/prompts/flashcard-gen";
import { getChatProvider } from "@/lib/ai/providers/registry";
import type { ChatRequest, Usage } from "@/lib/ai/providers/types";
import { PRICING } from "@/lib/ai/pricing";

export type RunFlashcardGenArgs = FlashcardGenInput & {
  /** Stored modelBindings.flashcardGen string. */
  modelId: string;
  /** Vault-decrypted API key. Empty string only allowed for local providers
   *  (the adapter handles header omission). */
  apiKey: string;
  /** Anthropic only: which credential kind apiKey is. "oauth" routes through
   *  /api/ai/chat-oauth (claude-agent-sdk + Claude Code subprocess); omit /
   *  "api-key" uses the regular /api/ai/chat path. Other presets ignore. */
  authKind?: "oauth" | "api-key";
  signal?: AbortSignal;
};

export type RunFlashcardGenResult = {
  cards: FlashcardGenCard[];
  /** Provider-reported token usage; absent fields coalesced to 0 by the
   *  caller when computing cost. */
  usage: Usage;
  /** USD estimate using the snapshot in `pricing.ts`. 0 for free / local. */
  estimatedCostUsd: number;
  /** Resolved upstream model string (mostly the same as `modelId`). */
  model: string;
};

class FlashcardGenError extends Error {
  constructor(
    public readonly code:
      | "unknown_model"
      | "stream_error"
      | "parse_error"
      | "no_cards"
      | "aborted",
    message: string,
  ) {
    super(message);
    this.name = "FlashcardGenError";
  }
}

export { FlashcardGenError };

/**
 * Estimate USD cost given provider-reported usage. Cache reads are billed
 * separately at 10% of input on Anthropic; cache_creation at 1.25x. Local
 * providers and free-tier models price to $0 across the board.
 */
export function estimateCost(model: string, usage: Usage): number {
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
 * Drive a chat provider through the flashcard-generation prompt and parse
 * the streamed JSON. Pure JSON-in-text mode (no tools): all current chat
 * adapters can produce structured text without the tool-translator round-
 * trip, and this avoids tying batch generation to native tool support.
 */
export async function runFlashcardGen(
  args: RunFlashcardGenArgs,
): Promise<RunFlashcardGenResult> {
  const option = findChatOption(args.modelId);
  if (!option) {
    throw new FlashcardGenError(
      "unknown_model",
      `Model not in registry: ${args.modelId}`,
    );
  }
  const provider = getChatProvider(option.presetId, {
    ...(args.authKind ? { authKind: args.authKind } : {}),
  });
  const upstreamModel = option.modelId;
  const count = clampCount(args.count);

  const systemBlocks = buildFlashcardGenSystem({
    source: args.source,
    chunks: args.chunks,
    locale: args.locale,
    count,
    mode: args.mode,
    ...(args.chatContext !== undefined ? { chatContext: args.chatContext } : {}),
    ...(args.keepEnglishTerms !== undefined
      ? { keepEnglishTerms: args.keepEnglishTerms }
      : {}),
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
            ? `Lütfen yukarıdaki kaynak için tam olarak ${count} kart üret ve şemaya uy.`
            : `Please produce exactly ${count} cards from the source above, conforming to the schema.`,
      },
    ],
    maxTokens: Math.max(800, count * 220),
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
        // Final message_delta event carries authoritative usage totals.
        usage = { ...usage, ...event.usage };
      } else if (event.kind === "error") {
        throw new FlashcardGenError(
          "stream_error",
          `Provider error ${event.status}: ${event.message}`,
        );
      } else if (event.kind === "abort") {
        throw new FlashcardGenError("aborted", "Generation aborted");
      }
    }
  } catch (err) {
    if (err instanceof FlashcardGenError) throw err;
    throw new FlashcardGenError(
      "stream_error",
      err instanceof Error ? err.message : String(err),
    );
  }

  let parsed;
  try {
    parsed = parseFlashcardGenOutput(buffer);
  } catch (err) {
    throw new FlashcardGenError(
      "parse_error",
      err instanceof Error ? err.message : String(err),
    );
  }

  const cards = dedupeFlashcardCards(parsed.cards).slice(0, count);
  if (cards.length === 0) {
    throw new FlashcardGenError("no_cards", "Model returned no usable cards");
  }

  return {
    cards,
    usage,
    estimatedCostUsd: estimateCost(model, usage),
    model,
  };
}
