import { z } from "zod";
import { findChatOption } from "@/lib/ai/model-options";
import { PRICING } from "@/lib/ai/pricing";
import { getChatProvider } from "@/lib/ai/providers/registry";
import type { ChatRequest, SystemBlock, Usage } from "@/lib/ai/providers/types";

// Generic, content-agnostic translation pass for "both"-language generation.
// Each item is an id + a flat map of string fields; the model translates the
// VALUES into `target`, echoing ids + field keys so callers can map the result
// back onto an unchanged structure. Batched + parallel so a large set doesn't
// ride on one slow call (the user's explicit "parallel, batch if large" ask).
//
// Array-shaped content (e.g. quiz choices) is flattened into indexed keys
// (`choice_0`, `choice_1`, …) by the caller and reassembled afterwards, which
// keeps index alignment intact.

export type TranslateItem = { id: string; fields: Record<string, string> };

export class TranslateError extends Error {
  constructor(
    public readonly code: "unknown_model" | "stream_error" | "parse_error" | "aborted",
    message: string,
  ) {
    super(message);
    this.name = "TranslateError";
  }
}

const ResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().min(1),
      fields: z.record(z.string(), z.string()),
    }),
  ),
});

function estimateCost(model: string, usage: Usage): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (
    ((usage.input_tokens ?? 0) * p.input +
      (usage.output_tokens ?? 0) * p.output +
      (usage.cache_read_input_tokens ?? 0) * p.cacheRead +
      (usage.cache_creation_input_tokens ?? 0) * p.cacheCreation) /
    1_000_000
  );
}

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

// Balanced-object extractor: walks from the first `{` tracking brace depth +
// string state so trailing prose / a brace inside a string can't corrupt the
// slice. Mirrors the roadmap schema extractor.
function extractFirstJsonObject(raw: string): string | null {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
  }
  const open = cleaned.indexOf("{");
  if (open === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return cleaned.slice(open, i + 1);
    }
  }
  return null;
}

function buildSystem(target: "tr" | "en", domainHint?: string): SystemBlock[] {
  const rules =
    target === "en"
      ? [
          "Role: You translate short learning-content fields into English.",
          "Rules:",
          "- Translate every string VALUE. Keep each item's `id` and every field KEY exactly as given — do not rename or drop keys.",
          "- Keep technical terms accurate and idiomatic; preserve meaning and roughly the source length.",
          ...(domainHint ? [`- Context: ${domainHint}`] : []),
          '- Output ONLY JSON of shape {"items":[{"id":"...","fields":{...}}]}. No markdown fences, no commentary.',
        ].join("\n")
      : [
          "Rol: Kısa öğrenme-içeriği alanlarını Türkçeye çevirirsin.",
          "Kurallar:",
          "- Her string DEĞERİ çevir. Her öğenin `id` değerini ve tüm alan ANAHTARLARINI aynen koru — yeniden adlandırma veya silme.",
          "- Teknik terimleri doğru ve akıcı kullan; anlamı ve kabaca kaynak uzunluğunu koru.",
          ...(domainHint ? [`- Bağlam: ${domainHint}`] : []),
          '- Çıkış SADECE şu biçimde JSON: {"items":[{"id":"...","fields":{...}}]}. Markdown fence yok, ek açıklama yok.',
        ].join("\n");
  return [{ type: "text", text: rules }];
}

export type RunTranslateArgs = {
  target: "tr" | "en";
  items: TranslateItem[];
  modelId: string;
  apiKey: string;
  authKind?: "oauth" | "api-key" | undefined;
  signal?: AbortSignal | undefined;
  batchSize?: number | undefined;
  // Short phrase ("a flashcard deck", "a quiz") to steer terminology.
  domainHint?: string | undefined;
};

export type RunTranslateResult = {
  // id → translated field map. Ids absent from the map failed to translate;
  // the caller keeps the source-language text for those.
  byId: Map<string, Record<string, string>>;
  usage: Usage;
  estimatedCostUsd: number;
  model: string;
  // True when at least one batch failed — usable but incomplete.
  partial: boolean;
};

const DEFAULT_BATCH_SIZE = 10;

export async function runTranslate(
  args: RunTranslateArgs,
): Promise<RunTranslateResult> {
  const option = findChatOption(args.modelId);
  if (!option) {
    throw new TranslateError(
      "unknown_model",
      `Model not in registry: ${args.modelId}`,
    );
  }
  const provider = getChatProvider(option.presetId, {
    ...(args.authKind ? { authKind: args.authKind } : {}),
  });
  const upstreamModel = option.modelId;
  const system = buildSystem(args.target, args.domainHint);
  const batchSize = args.batchSize ?? DEFAULT_BATCH_SIZE;

  const batches: TranslateItem[][] = [];
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
        messages: [{ role: "user", content: JSON.stringify({ items: batch }) }],
        // Translations stay close to source size; allow generous headroom.
        maxTokens: Math.max(1024, batch.length * 320),
        ...(args.signal ? { signal: args.signal } : {}),
      };
      const handle = provider.streamChat(request);
      let buffer = "";
      let model = upstreamModel;
      let usage: Usage = {};
      for await (const event of handle.events) {
        if (event.kind === "text") buffer += event.delta;
        else if (event.kind === "start") {
          model = event.model || model;
          usage = event.usage ?? usage;
        } else if (event.kind === "delta") usage = { ...usage, ...event.usage };
        else if (event.kind === "error") {
          throw new TranslateError(
            "stream_error",
            `Provider error ${event.status}: ${event.message}`,
          );
        } else if (event.kind === "abort") {
          throw new TranslateError("aborted", "Translation aborted");
        }
      }
      const slice = extractFirstJsonObject(buffer);
      if (!slice) throw new TranslateError("parse_error", "no JSON object");
      const parsed = ResponseSchema.safeParse(JSON.parse(slice));
      if (!parsed.success) {
        throw new TranslateError("parse_error", "schema mismatch");
      }
      return { items: parsed.data.items, model, usage };
    }),
  );

  const byId = new Map<string, Record<string, string>>();
  let usage: Usage = {};
  let model = upstreamModel;
  let partial = false;
  for (const r of results) {
    if (r.status === "fulfilled") {
      for (const it of r.value.items) byId.set(it.id, it.fields);
      model = r.value.model;
      usage = mergeUsage(usage, r.value.usage);
    } else {
      partial = true;
    }
  }

  return {
    byId,
    usage,
    estimatedCostUsd: estimateCost(model, usage),
    model,
    partial,
  };
}
