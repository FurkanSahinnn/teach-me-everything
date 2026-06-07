// Concept extraction runner. Drives a chat provider through the
// `concept-extract` prompt, dedupes the model's raw output, resolves edge
// endpoints back to deduped concept ids, and persists the resulting graph
// for the workspace via `replaceWorkspaceGraph`.
//
// The pure helpers (`dedupeRawConcepts`, `mergeRawEdges`) are exported so
// the test suite can pin behaviour without spinning up the AI runner.

import { resolveBilingualPair } from "@/lib/ai/content-language";
import { findChatOption } from "@/lib/ai/model-options";
import { PRICING } from "@/lib/ai/pricing";
import { runTranslate, type TranslateItem } from "@/lib/ai/translate";
import {
  buildConceptExtractSystem,
  normalizeConceptLabel,
  parseConceptExtractOutput,
  type RawConcept,
  type RawEdge,
} from "@/lib/ai/prompts/concept-extract";
import { getChatProvider } from "@/lib/ai/providers/registry";
import type { ChatRequest, Usage } from "@/lib/ai/providers/types";
import type { ChunkRecord, SourceRecord } from "@/lib/db/types";
import { listChunksBySource } from "@/lib/db/chunks";
import { replaceWorkspaceGraph } from "@/lib/db/concepts";
import type {
  ConceptEdgeRecord,
  ConceptRecord,
} from "@/lib/concepts/types";
import { newId } from "@/lib/utils/id";

export type DedupedConcept = {
  // Stable id minted client-side (so the runner controls graph integrity);
  // the persistence layer uses this as the primary key.
  id: string;
  label: string;
  labelNorm: string;
  kind: RawConcept["kind"];
  definition?: string;
  // Union of chunkRefs across all raw entries that collapsed to this concept.
  chunkRefs: string[];
};

export type MergedEdge = {
  id: string;
  fromId: string;
  toId: string;
  kind: RawEdge["kind"];
  evidenceChunkIds: string[];
};

/**
 * Collapse raw concepts by normalized label. Order-stable: the first label
 * wins for display, the first non-empty definition wins for content,
 * `chunkRefs` are unioned in encounter order. Pure.
 */
export function dedupeRawConcepts(
  raw: RawConcept[],
): DedupedConcept[] {
  const map = new Map<string, DedupedConcept>();
  for (const item of raw) {
    const labelNorm = normalizeConceptLabel(item.label);
    if (!labelNorm) continue;
    const existing = map.get(labelNorm);
    if (existing) {
      // Union chunkRefs preserving encounter order.
      const seen = new Set(existing.chunkRefs);
      for (const ref of item.chunkRefs) {
        if (!seen.has(ref)) {
          existing.chunkRefs.push(ref);
          seen.add(ref);
        }
      }
      // First non-empty definition wins; ditto for kind upgrades when the
      // first record was generic ("concept") and a later one is specific.
      if (!existing.definition && item.definition) {
        existing.definition = item.definition;
      }
      if (existing.kind === "concept" && item.kind !== "concept") {
        existing.kind = item.kind;
      }
    } else {
      const next: DedupedConcept = {
        id: newId("cpt"),
        label: item.label.trim(),
        labelNorm,
        kind: item.kind,
        chunkRefs: [...new Set(item.chunkRefs)],
      };
      if (item.definition) next.definition = item.definition;
      map.set(labelNorm, next);
    }
  }
  return Array.from(map.values());
}

/**
 * Resolve raw edges through the deduped concept map and merge duplicates.
 * Edges whose endpoints aren't in the concept map are dropped (the model
 * sometimes hallucinates a concept name in `from`/`to` that wasn't listed
 * in `concepts`). Same `(fromId, toId, kind)` triple → evidence union. Pure.
 */
export function mergeRawEdges(
  raw: RawEdge[],
  concepts: DedupedConcept[],
): MergedEdge[] {
  const byNorm = new Map<string, string>();
  for (const c of concepts) byNorm.set(c.labelNorm, c.id);

  const map = new Map<string, MergedEdge>();
  for (const item of raw) {
    const fromId = byNorm.get(normalizeConceptLabel(item.from));
    const toId = byNorm.get(normalizeConceptLabel(item.to));
    if (!fromId || !toId || fromId === toId) continue;
    const key = `${fromId}|${toId}|${item.kind}`;
    const existing = map.get(key);
    const evidence = item.evidence ?? [];
    if (existing) {
      const seen = new Set(existing.evidenceChunkIds);
      for (const ref of evidence) {
        if (!seen.has(ref)) {
          existing.evidenceChunkIds.push(ref);
          seen.add(ref);
        }
      }
    } else {
      map.set(key, {
        id: newId("cedge"),
        fromId,
        toId,
        kind: item.kind,
        evidenceChunkIds: [...new Set(evidence)],
      });
    }
  }
  return Array.from(map.values());
}

export type ExtractConceptsArgs = {
  workspaceId: string;
  // When provided, extraction scopes to a single source; otherwise it walks
  // every source in the workspace.
  sourceId?: string;
  // Resolved upfront from prefs.modelBindings.summary by the caller. The
  // runner doesn't reach into prefs because the Settings UI may want a
  // different model than the per-task default.
  modelId: string;
  apiKey: string;
  /** Anthropic only: "oauth" routes through /api/ai/chat-oauth instead of
   *  /api/ai/chat. Other presets ignore. */
  authKind?: "oauth" | "api-key";
  locale: "tr" | "en";
  // "en_terms_tr" mode: keep technical terms in English while writing the rest
  // in Turkish. Spliced into the prompt's TR rules. Only meaningful when
  // locale === "tr".
  keepEnglishTerms?: boolean;
  // "both" mode: after the canonical extraction in `locale`, translate every
  // concept's label + definition into this language and store them in the
  // parallel `labelEn`/`definitionEn` fields. The view flips TR⇄EN instantly.
  translateTo?: "tr" | "en";
  signal?: AbortSignal;
  // Soft cap forwarded to the prompt; the runner doesn't truncate the output.
  maxConcepts?: number;
  // Caller-supplied source records (the runner only needs title/type for the
  // prompt header). Keeps the runner Dexie-free for tests if needed.
  sources: Pick<SourceRecord, "id" | "title" | "titleEn" | "author" | "type">[];
  // Optional progress callback (chunkBatchIndex / totalBatches).
  onProgress?: (done: number, total: number) => void;
};

export type ExtractConceptsResult = {
  concepts: ConceptRecord[];
  edges: ConceptEdgeRecord[];
  usage: Usage;
  estimatedCostUsd: number;
  model: string;
  // "both" mode: true when the translation pass left some concepts untranslated
  // (kept in the source language). The modal surfaces an info toast.
  translatePartial: boolean;
};

class ConceptExtractError extends Error {
  constructor(
    public readonly code:
      | "unknown_model"
      | "stream_error"
      | "parse_error"
      | "no_concepts"
      | "no_chunks"
      | "aborted",
    message: string,
  ) {
    super(message);
    this.name = "ConceptExtractError";
  }
}

export { ConceptExtractError };

const BATCH_SIZE = 32;

export function estimateConceptExtractCost(
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

async function streamOneBatch(
  args: {
    apiKey: string;
    authKind?: "oauth" | "api-key";
    modelId: string;
    locale: "tr" | "en";
    keepEnglishTerms?: boolean;
    source: ExtractConceptsArgs["sources"][number];
    chunks: ChunkRecord[];
    maxConcepts?: number;
    signal?: AbortSignal;
  },
): Promise<{
  concepts: RawConcept[];
  edges: RawEdge[];
  usage: Usage;
  model: string;
}> {
  const option = findChatOption(args.modelId);
  if (!option) {
    throw new ConceptExtractError(
      "unknown_model",
      `Model not in registry: ${args.modelId}`,
    );
  }
  const provider = getChatProvider(option.presetId, {
    ...(args.authKind ? { authKind: args.authKind } : {}),
  });
  const upstreamModel = option.modelId;
  const systemBlocks = buildConceptExtractSystem({
    source: args.source,
    chunks: args.chunks.map((c) => ({
      id: c.id,
      index: c.index,
      ...(c.section !== undefined ? { section: c.section } : {}),
      ...(c.headings !== undefined ? { headings: c.headings } : {}),
      text: c.text,
      ...(c.page !== undefined ? { page: c.page } : {}),
    })),
    locale: args.locale,
    ...(args.maxConcepts !== undefined ? { maxConcepts: args.maxConcepts } : {}),
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
            ? "Lütfen yukarıdaki kaynak için konsept grafiğini şemada üret."
            : "Please produce the concept graph for the source above, conforming to the schema.",
      },
    ],
    // Concepts (~30) × ~30 tokens each + edges (~40) × ~25 tokens each ≈
    // ~2000 output tokens; floor of 1500 protects single-chunk runs.
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
        throw new ConceptExtractError(
          "stream_error",
          `Provider error ${event.status}: ${event.message}`,
        );
      } else if (event.kind === "abort") {
        throw new ConceptExtractError("aborted", "Extraction aborted");
      }
    }
  } catch (err) {
    if (err instanceof ConceptExtractError) throw err;
    throw new ConceptExtractError(
      "stream_error",
      err instanceof Error ? err.message : String(err),
    );
  }

  let parsed;
  try {
    parsed = parseConceptExtractOutput(buffer);
  } catch (err) {
    throw new ConceptExtractError(
      "parse_error",
      err instanceof Error ? err.message : String(err),
    );
  }
  return { concepts: parsed.concepts, edges: parsed.edges, usage, model };
}

/**
 * Run concept extraction for a workspace (or a single source within it),
 * dedupe + merge across batches, and atomically replace the workspace's
 * graph. Throws when no chunks or no usable concepts came back.
 */
export async function extractConcepts(
  args: ExtractConceptsArgs,
): Promise<ExtractConceptsResult> {
  const targets = args.sourceId
    ? args.sources.filter((s) => s.id === args.sourceId)
    : args.sources;
  if (targets.length === 0) {
    throw new ConceptExtractError(
      "no_chunks",
      "No source(s) selected for extraction",
    );
  }

  // Build (source, chunks) pairs and total batches up front so the progress
  // callback can drive a deterministic bar.
  type ChunkBatch = {
    source: ExtractConceptsArgs["sources"][number];
    chunks: ChunkRecord[];
  };
  const batches: ChunkBatch[] = [];
  for (const src of targets) {
    const chunks = await listChunksBySource(src.id);
    if (chunks.length === 0) continue;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      batches.push({ source: src, chunks: chunks.slice(i, i + BATCH_SIZE) });
    }
  }
  if (batches.length === 0) {
    throw new ConceptExtractError(
      "no_chunks",
      "Selected source(s) have no chunks",
    );
  }

  let concepts: RawConcept[] = [];
  let edges: RawEdge[] = [];
  const aggUsage: Usage = {};
  let modelId = args.modelId;
  // Track chunkRef → (sourceId, canonical id). Two maps because the model
  // emits both `#N` index references and (rarely) raw chunk ids; the
  // persistence layer wants real chunk ids so the inspector's bulkGet
  // resolves backlinks. `chunkRefToId` maps either form to the canonical id.
  const chunkRefToSource = new Map<string, string>();
  const chunkRefToId = new Map<string, string>();
  for (let i = 0; i < batches.length; i += 1) {
    const b = batches[i];
    if (!b) continue;
    if (args.signal?.aborted) {
      throw new ConceptExtractError("aborted", "Extraction aborted");
    }
    for (const c of b.chunks) {
      chunkRefToSource.set(`#${c.index}`, b.source.id);
      chunkRefToSource.set(c.id, b.source.id);
      chunkRefToId.set(`#${c.index}`, c.id);
      chunkRefToId.set(c.id, c.id);
    }
    const out = await streamOneBatch({
      apiKey: args.apiKey,
      ...(args.authKind ? { authKind: args.authKind } : {}),
      modelId: args.modelId,
      locale: args.locale,
      ...(args.keepEnglishTerms !== undefined
        ? { keepEnglishTerms: args.keepEnglishTerms }
        : {}),
      source: b.source,
      chunks: b.chunks,
      ...(args.maxConcepts !== undefined ? { maxConcepts: args.maxConcepts } : {}),
      ...(args.signal ? { signal: args.signal } : {}),
    });
    concepts = concepts.concat(out.concepts);
    edges = edges.concat(out.edges);
    aggUsage.input_tokens =
      (aggUsage.input_tokens ?? 0) + (out.usage.input_tokens ?? 0);
    aggUsage.output_tokens =
      (aggUsage.output_tokens ?? 0) + (out.usage.output_tokens ?? 0);
    aggUsage.cache_read_input_tokens =
      (aggUsage.cache_read_input_tokens ?? 0) +
      (out.usage.cache_read_input_tokens ?? 0);
    aggUsage.cache_creation_input_tokens =
      (aggUsage.cache_creation_input_tokens ?? 0) +
      (out.usage.cache_creation_input_tokens ?? 0);
    modelId = out.model;
    args.onProgress?.(i + 1, batches.length);
  }

  const deduped = dedupeRawConcepts(concepts);
  if (deduped.length === 0) {
    throw new ConceptExtractError(
      "no_concepts",
      "Model returned no usable concepts",
    );
  }
  const merged = mergeRawEdges(edges, deduped);

  // "both" mode: translate the canonical concepts (label + definition) into the
  // other language with a parallel batched pass. Structure (ids/edges/labelNorm)
  // is untouched; dedupe stayed keyed on the PRIMARY label so the English
  // translation never affects collapsing. `translatedById` maps concept id →
  // its translated fields; missing ids fall back to source via resolveBilingualPair.
  let translatedById = new Map<string, Record<string, string>>();
  let translatePartial = false;
  if (args.translateTo) {
    const items: TranslateItem[] = deduped.map((c) => ({
      id: c.id,
      fields: {
        label: c.label,
        ...(c.definition ? { definition: c.definition } : {}),
      },
    }));
    const tr = await runTranslate({
      target: args.translateTo,
      items,
      modelId: args.modelId,
      apiKey: args.apiKey,
      ...(args.authKind ? { authKind: args.authKind } : {}),
      ...(args.signal ? { signal: args.signal } : {}),
      domainHint:
        args.translateTo === "en"
          ? "a concept map (mind map) of a learning topic"
          : "bir öğrenme konusunun kavram haritası (zihin haritası)",
    });
    translatedById = tr.byId;
    translatePartial = tr.partial;
    aggUsage.input_tokens =
      (aggUsage.input_tokens ?? 0) + (tr.usage.input_tokens ?? 0);
    aggUsage.output_tokens =
      (aggUsage.output_tokens ?? 0) + (tr.usage.output_tokens ?? 0);
    aggUsage.cache_read_input_tokens =
      (aggUsage.cache_read_input_tokens ?? 0) +
      (tr.usage.cache_read_input_tokens ?? 0);
    aggUsage.cache_creation_input_tokens =
      (aggUsage.cache_creation_input_tokens ?? 0) +
      (tr.usage.cache_creation_input_tokens ?? 0);
  }
  // The single language the canonical extraction ran in. resolveBilingualPair
  // always returns base = Turkish, en = English regardless of primary.
  const primary: "tr" | "en" = args.locale;
  const translateTo = args.translateTo ?? null;

  const now = Date.now();
  // Resolve raw `#N` refs to canonical chunk ids so the inspector's bulkGet
  // returns real ChunkRecords. Refs we can't resolve (model hallucinated a
  // chunk index) are dropped silently — better than persisting dead links.
  const canonicalize = (refs: string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const ref of refs) {
      const id = chunkRefToId.get(ref);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  };
  const conceptRecords: ConceptRecord[] = deduped.map((c) => {
    const canonRefs = canonicalize(c.chunkRefs);
    const sourceIds = Array.from(
      new Set(
        canonRefs
          .map((id) => chunkRefToSource.get(id))
          .filter((s): s is string => Boolean(s)),
      ),
    );
    // Resolve (base = Turkish, English) pairs for label + definition. base
    // always holds Turkish and *En always English; a missing translation falls
    // back to the source value. For single-language extraction translateTo is
    // null so en is undefined and only the base fields are written.
    const tFields = translatedById.get(c.id);
    const labelPair = resolveBilingualPair(
      primary,
      translateTo,
      c.label,
      tFields?.label,
    );
    const defPair = c.definition
      ? resolveBilingualPair(
          primary,
          translateTo,
          c.definition,
          tFields?.definition,
        )
      : null;
    const rec: ConceptRecord = {
      id: c.id,
      workspaceId: args.workspaceId,
      label: labelPair.base,
      // labelNorm stays keyed on the PRIMARY label captured at dedupe time so
      // collapsing is unaffected by translation.
      labelNorm: c.labelNorm,
      kind: c.kind,
      sourceIds,
      chunkRefs: canonRefs,
      ...(labelPair.en ? { labelEn: labelPair.en } : {}),
      createdAt: now,
      updatedAt: now,
    };
    if (defPair) {
      rec.definition = defPair.base;
      if (defPair.en) rec.definitionEn = defPair.en;
    } else if (c.definition) {
      rec.definition = c.definition;
    }
    return rec;
  });
  const edgeRecords: ConceptEdgeRecord[] = merged.map((e) => ({
    id: e.id,
    workspaceId: args.workspaceId,
    fromId: e.fromId,
    toId: e.toId,
    kind: e.kind,
    evidenceChunkIds: canonicalize(e.evidenceChunkIds),
    createdAt: now,
  }));

  await replaceWorkspaceGraph(args.workspaceId, conceptRecords, edgeRecords);

  return {
    concepts: conceptRecords,
    edges: edgeRecords,
    usage: aggUsage,
    estimatedCostUsd: estimateConceptExtractCost(modelId, aggUsage),
    model: modelId,
    translatePartial,
  };
}
