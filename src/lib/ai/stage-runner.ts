// Shared machinery for multi-stage JSON pipelines (Article Analysis, Cross-
// Analysis, and any future fan-out runner): resolve `provider::modelId`
// bindings to credentials once, call one stage, drain its stream, parse it.
//
// Extracted from `lib/ai/article-analysis.ts`, which still carries its own
// copy — deduping it there is a mechanical follow-up, deliberately left out of
// this change so it does not tangle with the in-flight citation-verify work in
// that file.

import { resolveChatCredentialForPreset } from "@/lib/ai/anthropic-credential";
import { findChatOption } from "@/lib/ai/model-options";
import { getChatProvider } from "@/lib/ai/providers/registry";
import type {
  ChatRequest,
  ProviderId,
  SystemBlock,
  Usage,
} from "@/lib/ai/providers/types";
import type { ParseResult } from "@/lib/article-analysis/schema";

// Abort is the one condition every pipeline must treat as fatal; each runner
// catches this and rethrows it as its own typed error.
export class StageAbortError extends Error {
  constructor(message = "Aborted") {
    super(message);
    this.name = "StageAbortError";
  }
}

// A model binding failed to resolve — unknown id, or no credential on file.
export class StageBindingError extends Error {
  constructor(
    public readonly code: "unknown_model" | "no_credential",
    message: string,
  ) {
    super(message);
    this.name = "StageBindingError";
  }
}

// A stage's stream or parse failed. Recoverable: the runner degrades to draft.
export class StageError extends Error {}

export type ResolvedModel = {
  presetId: ProviderId;
  modelId: string;
  apiKey: string;
  authKind?: "oauth" | "api-key" | undefined;
};

export const DEFAULT_STAGE_MAX_TOKENS = 4096;

export function mergeUsage(a: Usage, b: Usage): Usage {
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

// Resolve a named set of bindings in one pass. Credentials are cached by preset
// so several stages on the same provider (the common case) hit the keychain once.
export async function resolveModelBindings<K extends string>(
  bindings: Record<K, string>,
): Promise<Record<K, ResolvedModel>> {
  const credCache = new Map<
    string,
    { apiKey: string; authKind?: "oauth" | "api-key" | undefined }
  >();
  const entries = Object.entries(bindings) as [K, string][];
  const resolved = await Promise.all(
    entries.map(async ([key, binding]) => {
      const option = findChatOption(binding);
      if (!option) {
        throw new StageBindingError(
          "unknown_model",
          `Model not in registry: ${binding}`,
        );
      }
      let cred = credCache.get(option.presetId);
      if (!cred) {
        const found = await resolveChatCredentialForPreset(option.presetId);
        if (!found) {
          throw new StageBindingError(
            "no_credential",
            `No credential on file for provider: ${option.presetId}`,
          );
        }
        cred = found;
        credCache.set(option.presetId, cred);
      }
      const model: ResolvedModel = {
        presetId: option.presetId,
        modelId: option.modelId,
        apiKey: cred.apiKey,
        ...(cred.authKind ? { authKind: cred.authKind } : {}),
      };
      return [key, model] as const;
    }),
  );
  return Object.fromEntries(resolved) as Record<K, ResolvedModel>;
}

async function drainStream(
  handle: ReturnType<ReturnType<typeof getChatProvider>["streamChat"]>,
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
  for await (const event of handle.events) {
    if (event.kind === "text") {
      buffer += event.delta;
    } else if (event.kind === "start") {
      model = event.model || model;
      usage = event.usage ?? usage;
    } else if (event.kind === "delta") {
      usage = { ...usage, ...event.usage };
      stopReason = event.stopReason ?? stopReason;
    } else if (event.kind === "error") {
      throw new Error(`Provider error ${event.status}: ${event.message}`);
    } else if (event.kind === "abort") {
      throw new StageAbortError();
    }
  }
  return { buffer, model, usage, stopReason };
}

// One stage: build request, drain, parse. Throws StageAbortError (fatal) or
// StageError (recoverable). Returns the parsed value plus usage/model so the
// caller can accrue cost per stage.
export async function callStage<T>(
  model: ResolvedModel,
  system: SystemBlock[],
  userText: string,
  parse: (raw: string) => ParseResult<T>,
  signal: AbortSignal | undefined,
  maxTokens: number = DEFAULT_STAGE_MAX_TOKENS,
): Promise<{ value: T; usage: Usage; model: string }> {
  const provider = getChatProvider(model.presetId, {
    ...(model.authKind ? { authKind: model.authKind } : {}),
  });
  const request: ChatRequest = {
    apiKey: model.apiKey,
    ...(model.authKind ? { authKind: model.authKind } : {}),
    model: model.modelId,
    system,
    messages: [{ role: "user", content: userText }],
    maxTokens,
    ...(signal ? { signal } : {}),
  };
  const drained = await drainStream(provider.streamChat(request), model.modelId);
  const parsed = parse(drained.buffer);
  if (!parsed.ok) {
    // A buffer cut off at the output cap yields unbalanced braces → "no_json".
    // Name that distinctly so a draft's cause is diagnosable.
    const truncated = drained.stopReason === "max_tokens";
    throw new StageError(
      truncated
        ? "output truncated (max_tokens)"
        : `${parsed.reason}${parsed.detail ? `: ${parsed.detail}` : ""}`,
    );
  }
  return { value: parsed.value, usage: drained.usage, model: drained.model };
}

// Short, safe description of a recoverable failure. Never user content — safe
// to persist in fallbackReason.
export function stageFailureDetail(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : String(err).trim();
  return msg.length > 0 ? msg : "unknown error";
}
