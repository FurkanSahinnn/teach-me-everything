// Curriculum generation runner. Drives a chat provider through the
// `curriculum` prompt (parsed, deduped, persisted via `createCurriculum`).
//
// Pure helpers (`mapParsedItemsToInput`, `estimateCurriculumCost`) are
// exported so tests can pin behaviour without spinning up the AI runner.
// `chatProvider` is an injectable arg so tests pass a fake provider
// without `vi.mock`-ing the registry.

import { findChatOption } from "@/lib/ai/model-options";
import { PRICING } from "@/lib/ai/pricing";
import {
  buildCurriculumSystem,
  parseCurriculumOutput,
  type ParsedCurriculum,
  type ParsedCurriculumItem,
} from "@/lib/ai/prompts/curriculum";
import { getChatProvider } from "@/lib/ai/providers/registry";
import type {
  ChatProvider,
  ChatRequest,
  Usage,
} from "@/lib/ai/providers/types";
import {
  createCurriculum,
  type CreateCurriculumItemInput,
} from "@/lib/db/study";
import type { ChunkRecord, SourceRecord } from "@/lib/db/types";
import type {
  CurriculumItemRecord,
  CurriculumRecord,
  StudySourceRef,
} from "@/lib/study/types";

export type CurriculumGenSource = Pick<
  SourceRecord,
  "id" | "title" | "titleEn" | "type" | "author"
> & {
  chunks: Array<
    Pick<ChunkRecord, "id" | "index" | "section" | "headings" | "text" | "page">
  >;
};

export type GenerateCurriculumArgs = {
  workspaceId: string;
  workspace: { name: string; goal?: string | undefined };
  // Caller-supplied source records with chunks (the runner stays Dexie-free).
  sources: CurriculumGenSource[];
  // Resolved upfront from prefs.modelBindings.summary by the caller.
  modelId: string;
  apiKey: string;
  /** Anthropic only: "oauth" routes through /api/ai/chat-oauth instead of
   *  /api/ai/chat. Other presets ignore. */
  authKind?: "oauth" | "api-key";
  locale: "tr" | "en";
  level?: string | undefined;
  maxItems?: number | undefined;
  sourceTextBudgetChars?: number | undefined;
  maxChunkTextChars?: number | undefined;
  signal?: AbortSignal;
  /** Test injection point. Defaults to getChatProvider(presetId, opts). */
  chatProvider?: ChatProvider;
};

export type GenerateCurriculumResult = {
  curriculum: CurriculumRecord;
  items: CurriculumItemRecord[];
  parsed: ParsedCurriculum;
  usage: Usage;
  estimatedCostUsd: number;
  model: string;
  refineStatus: "refined" | "draft";
  fallbackReason?: "parse_error" | "invalid_ref" | undefined;
};

export class CurriculumGenError extends Error {
  constructor(
    public readonly code:
      | "unknown_model"
      | "no_sources"
      | "no_chunks"
      | "stream_error"
      | "parse_error"
      | "no_items"
      | "aborted",
    message: string,
  ) {
    super(message);
    this.name = "CurriculumGenError";
  }
}

export function estimateCurriculumCost(model: string, usage: Usage): number {
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
 * Map ParsedCurriculumItem[] (model output) to CreateCurriculumItemInput[]
 * (db layer). Filters out items whose sourceRefs reference unknown source
 * ids — defensive against the model hallucinating ids that weren't in
 * <workspace_sources>. Pure.
 */
export function mapParsedItemsToInput(
  parsed: ParsedCurriculumItem[],
  knownSourceIds: ReadonlySet<string>,
  knownChunkIds: ReadonlySet<string>,
): CreateCurriculumItemInput[] {
  const out: CreateCurriculumItemInput[] = [];
  for (const item of parsed) {
    const refs: StudySourceRef[] = [];
    for (const ref of item.sourceRefs) {
      if (!knownSourceIds.has(ref.sourceId)) continue;
      const validChunkIds = ref.chunkIds?.filter((id) => knownChunkIds.has(id));
      const next: StudySourceRef = { sourceId: ref.sourceId };
      if (validChunkIds && validChunkIds.length > 0) {
        next.chunkIds = validChunkIds;
      }
      if (ref.section) next.section = ref.section;
      if (ref.quote) next.quote = ref.quote;
      refs.push(next);
    }
    if (refs.length === 0) continue;
    const input: CreateCurriculumItemInput = {
      title: item.title,
      objective: item.objective,
      sourceRefs: refs,
      prerequisites: item.prerequisites,
      estimatedMinutes: item.estimatedMinutes,
    };
    out.push(input);
  }
  return out;
}

async function streamCurriculumOnce(args: {
  apiKey: string;
  authKind?: "oauth" | "api-key";
  modelId: string;
  locale: "tr" | "en";
  workspace: { name: string; goal?: string | undefined };
  sources: CurriculumGenSource[];
  level?: string | undefined;
  maxItems?: number | undefined;
  sourceTextBudgetChars?: number | undefined;
  maxChunkTextChars?: number | undefined;
  draftItems?: ParsedCurriculumItem[] | undefined;
  strictJsonRetry?: boolean | undefined;
  signal?: AbortSignal;
  chatProvider?: ChatProvider;
}): Promise<{ buffer: string; usage: Usage; model: string }> {
  const option = findChatOption(args.modelId);
  if (!option) {
    throw new CurriculumGenError(
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
  const systemBlocks = buildCurriculumSystem({
    workspace: args.workspace,
    sources: args.sources,
    locale: args.locale,
    ...(args.level !== undefined ? { level: args.level } : {}),
    ...(args.maxItems !== undefined ? { maxItems: args.maxItems } : {}),
    ...(args.sourceTextBudgetChars !== undefined
      ? { sourceTextBudgetChars: args.sourceTextBudgetChars }
      : {}),
    ...(args.maxChunkTextChars !== undefined
      ? { maxChunkTextChars: args.maxChunkTextChars }
      : {}),
    ...(args.draftItems !== undefined ? { draftItems: args.draftItems } : {}),
  });
  const userContent = args.strictJsonRetry
    ? args.locale === "tr"
      ? "Önceki cevap JSON değildi. SADECE geçerli JSON objesi döndür. İlk karakter `{` olsun; markdown, açıklama veya giriş cümlesi yazma."
      : "The previous response was not JSON. Return ONLY a valid JSON object. The first character must be `{`; do not include markdown, explanations, or preamble."
    : args.locale === "tr"
      ? "Lütfen yukarıdaki kaynaklar için müfredatı şemada üret."
      : "Please produce the curriculum for the sources above, conforming to the schema.";

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
            ? "Lütfen yukarıdaki kaynaklar için müfredatı şemada üret."
            : "Please produce the curriculum for the sources above, conforming to the schema.",
      },
      ...(args.strictJsonRetry
        ? [{ role: "user" as const, content: userContent }]
        : []),
    ],
    // 10 items × ~150 tokens (title + objective + refs + prerequisites) ≈
    // 1500 output tokens; 4000 floor protects multi-source workspaces.
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
        throw new CurriculumGenError(
          "stream_error",
          `Provider error ${event.status}: ${event.message}`,
        );
      } else if (event.kind === "abort") {
        throw new CurriculumGenError("aborted", "Curriculum generation aborted");
      }
    }
  } catch (err) {
    if (err instanceof CurriculumGenError) throw err;
    throw new CurriculumGenError(
      "stream_error",
      err instanceof Error ? err.message : String(err),
    );
  }
  return { buffer, usage, model };
}

function addUsage(a: Usage, b: Usage): Usage {
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

function titleForFallbackItem(
  source: CurriculumGenSource,
  chunk: CurriculumGenSource["chunks"][number],
): string {
  const section = chunk.section?.trim() || chunk.headings?.[0]?.trim();
  if (section) return section;
  return source.titleEn ?? source.title;
}

function estimateFallbackMinutes(text: string): number {
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  if (words === 0) return 25;
  return Math.max(15, Math.min(90, Math.round(words / 125) * 5 + 15));
}

function buildFallbackCurriculum(
  args: Pick<GenerateCurriculumArgs, "workspace" | "sources" | "locale" | "level" | "maxItems">,
): ParsedCurriculum {
  const maxItems = args.maxItems ?? 10;
  const items: ParsedCurriculumItem[] = [];
  const seenTitles = new Set<string>();
  for (const source of args.sources) {
    const chunks = [...source.chunks].sort((a, b) => a.index - b.index);
    for (const chunk of chunks) {
      if (items.length >= maxItems) break;
      const title = titleForFallbackItem(source, chunk);
      const key = title.toLocaleLowerCase("en-US");
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);
      items.push({
        order: items.length,
        title,
        objective:
          args.locale === "tr"
            ? `${source.title} kaynağından ${title} konusunu çalış.`
            : `Study ${title} from ${source.title}.`,
        sourceRefs: [
          {
            sourceId: source.id,
            chunkIds: [chunk.id],
            ...(chunk.section ? { section: chunk.section } : {}),
          },
        ],
        prerequisites: items.length > 0 ? [items[items.length - 1]!.title] : [],
        status: "not_started",
        estimatedMinutes: estimateFallbackMinutes(chunk.text),
      });
    }
  }
  if (items.length === 0) {
    throw new CurriculumGenError(
      "no_items",
      "Selected sources have no usable chunks for a fallback curriculum",
    );
  }
  return {
    title: `${args.workspace.name} curriculum`,
    ...(args.workspace.goal ? { goal: args.workspace.goal } : {}),
    ...(args.level ? { level: args.level } : {}),
    items,
  };
}

function parsedItemHasKnownSourceRef(
  item: ParsedCurriculumItem,
  knownSourceIds: ReadonlySet<string>,
): boolean {
  return item.sourceRefs.some((ref) => knownSourceIds.has(ref.sourceId));
}

function applyRefineToDraft(args: {
  draft: ParsedCurriculum;
  refine: ParsedCurriculum;
  knownSourceIds: ReadonlySet<string>;
}): ParsedCurriculum | undefined {
  const refinedItems: ParsedCurriculumItem[] = [];
  const count = Math.min(args.draft.items.length, args.refine.items.length);
  for (let index = 0; index < count; index += 1) {
    const draftItem = args.draft.items[index];
    const refineItem = args.refine.items[index];
    if (!draftItem || !refineItem) continue;
    if (!parsedItemHasKnownSourceRef(refineItem, args.knownSourceIds)) continue;
    refinedItems.push({
      ...draftItem,
      order: refinedItems.length,
      title: refineItem.title,
      objective: refineItem.objective,
      prerequisites: refineItem.prerequisites,
      estimatedMinutes: refineItem.estimatedMinutes,
      ...(refineItem.parentTitle ? { parentTitle: refineItem.parentTitle } : {}),
    });
  }
  // No refine item survived (all hallucinated refs) → signal a full fallback
  // to the pure draft (`fallbackReason: "invalid_ref"`). Must run BEFORE the
  // tail-append below, otherwise appending draft items would mask the
  // all-hallucinated case and suppress the fallback signal.
  if (refinedItems.length === 0) return undefined;
  // A valid-but-SHORTER refine pass (fewer items than the draft) would
  // otherwise silently drop the uncovered draft items (iterating only
  // min(draft, refine)). Append the leftover source-grounded draft items
  // verbatim so refine never reduces coverage.
  for (let index = count; index < args.draft.items.length; index += 1) {
    const draftItem = args.draft.items[index];
    if (!draftItem) continue;
    refinedItems.push({ ...draftItem, order: refinedItems.length });
  }
  return {
    title: args.refine.title,
    ...(args.refine.goal ? { goal: args.refine.goal } : args.draft.goal ? { goal: args.draft.goal } : {}),
    ...(args.refine.level ? { level: args.refine.level } : args.draft.level ? { level: args.draft.level } : {}),
    items: refinedItems,
  };
}

/**
 * Generate a curriculum for a workspace from its source inventory.
 * Calls the model once (curricula are short — no batching), parses the JSON
 * output, filters refs by known source/chunk ids, and persists via
 * `createCurriculum`. Throws when the model returns no usable items.
 */
export async function generateCurriculum(
  args: GenerateCurriculumArgs,
): Promise<GenerateCurriculumResult> {
  if (args.sources.length === 0) {
    throw new CurriculumGenError("no_sources", "No sources supplied");
  }
  const totalChunks = args.sources.reduce((acc, s) => acc + s.chunks.length, 0);
  if (totalChunks === 0) {
    throw new CurriculumGenError(
      "no_chunks",
      "Supplied sources have no chunks",
    );
  }
  if (args.signal?.aborted) {
    throw new CurriculumGenError("aborted", "Curriculum generation aborted");
  }

  const draft = buildFallbackCurriculum(args);

  const streamArgs: Parameters<typeof streamCurriculumOnce>[0] = {
    apiKey: args.apiKey,
    modelId: args.modelId,
    locale: args.locale,
    workspace: args.workspace,
    sources: args.sources,
    draftItems: draft.items,
  };
  if (args.authKind) streamArgs.authKind = args.authKind;
  if (args.level !== undefined) streamArgs.level = args.level;
  if (args.maxItems !== undefined) streamArgs.maxItems = args.maxItems;
  if (args.sourceTextBudgetChars !== undefined) {
    streamArgs.sourceTextBudgetChars = args.sourceTextBudgetChars;
  }
  if (args.maxChunkTextChars !== undefined) {
    streamArgs.maxChunkTextChars = args.maxChunkTextChars;
  }
  if (args.signal) streamArgs.signal = args.signal;
  if (args.chatProvider) streamArgs.chatProvider = args.chatProvider;

  let aiParsed: ParsedCurriculum | undefined;
  let parsed: ParsedCurriculum = draft;
  let out = await streamCurriculumOnce(streamArgs);
  let fallbackReason: GenerateCurriculumResult["fallbackReason"];
  try {
    aiParsed = parseCurriculumOutput(out.buffer);
  } catch {
    if (args.signal?.aborted) {
      throw new CurriculumGenError("aborted", "Curriculum generation aborted");
    }
    const retry = await streamCurriculumOnce({
      ...streamArgs,
      strictJsonRetry: true,
    });
    try {
      aiParsed = parseCurriculumOutput(retry.buffer);
    } catch {
      fallbackReason = "parse_error";
    }
    out = {
      buffer: retry.buffer,
      model: retry.model,
      usage: addUsage(out.usage, retry.usage),
    };
  }

  const knownSourceIds = new Set(args.sources.map((s) => s.id));
  const knownChunkIds = new Set(
    args.sources.flatMap((s) => s.chunks.map((c) => c.id)),
  );
  let refineStatus: GenerateCurriculumResult["refineStatus"] = "draft";
  if (aiParsed) {
    const refined = applyRefineToDraft({
      draft,
      refine: aiParsed,
      knownSourceIds,
    });
    if (refined) {
      parsed = refined;
      refineStatus = "refined";
    } else {
      fallbackReason = "invalid_ref";
    }
  }
  const items = mapParsedItemsToInput(parsed.items, knownSourceIds, knownChunkIds);
  if (items.length === 0) {
    const draftItems = mapParsedItemsToInput(draft.items, knownSourceIds, knownChunkIds);
    if (draftItems.length === 0) {
      throw new CurriculumGenError(
        "no_items",
        "Draft curriculum produced no items with valid source refs",
      );
    }
    parsed = draft;
    items.push(...draftItems);
    refineStatus = "draft";
    fallbackReason = fallbackReason ?? "invalid_ref";
  }

  const created = await createCurriculum({
    workspaceId: args.workspaceId,
    title: parsed.title,
    sourceIds: Array.from(knownSourceIds),
    status: "draft",
    items,
    ...(parsed.goal ? { goal: parsed.goal } : args.workspace.goal ? { goal: args.workspace.goal } : {}),
    ...(parsed.level ? { level: parsed.level } : args.level ? { level: args.level } : {}),
  });

  return {
    curriculum: created.curriculum,
    items: created.items,
    parsed,
    usage: out.usage,
    estimatedCostUsd: estimateCurriculumCost(out.model, out.usage),
    model: out.model,
    refineStatus,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}
