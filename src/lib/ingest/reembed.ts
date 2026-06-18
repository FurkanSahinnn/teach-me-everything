// Plan + run reembedding for a workspace or single source. Plan is read-only
// (cost preview); run reuses embed-worker via embedSourceChunks under the
// hood and writes setChunkEmbedding with the 3.3.D opts so embeddingDim and
// embeddingProvider stay aligned.
//
// Cancel is soft: in-flight setChunkEmbedding writes are idempotent (Dexie
// update by id) so terminating the worker mid-batch never corrupts state.

import {
  EMBED_PRESETS,
  type EmbedPreset,
  type EmbedPresetId,
} from "@/lib/ai/providers/embed-presets";
import type { ProviderId } from "@/lib/ai/providers/types";
import { computeCostUsd } from "@/lib/ai/pricing";
import { setChunkEmbedding } from "@/lib/db/chunks";
import { db } from "@/lib/db/schema";
import { setEmbeddingStatus } from "@/lib/db/sources";
import type { ChunkRecord } from "@/lib/db/types";
import { embedSourceChunks } from "./embed";

export type ReembedScope =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "source"; sourceId: string };

export type ReembedPlan = {
  totalChunks: number;
  toReembed: number;
  // Chunks that currently carry any embedding metadata (vector / model / dim /
  // provider). 0 with totalChunks > 0 means the workspace has been wiped or
  // never embedded — distinct from "all on a different model", which the bare
  // toReembed count can't express on its own.
  embeddedCount: number;
  estTokens: number;
  estCostUsd: number;
  targetPresetId: EmbedPresetId;
  targetDim: number;
};

const PRESET_TO_PROVIDER: Record<EmbedPresetId, ProviderId> = {
  "openai-3-small": "openai",
  "openai-3-large": "openai",
  "openrouter-3-small": "openrouter",
  "openrouter-3-large": "openrouter",
  "voyage-3": "voyage",
  "voyage-3-large": "voyage",
  "gemini-embed-2": "google-gemini",
  "gemini-004": "google-gemini",
  "gemini-001": "google-gemini",
  "cohere-multilingual": "cohere",
  "jina-v3": "jina",
  "mistral-embed": "mistral",
  "hf-bge-m3": "huggingface",
  "hf-e5-multilingual": "huggingface",
  "ollama-nomic": "ollama",
  "ollama-mxbai": "ollama",
  "ollama-bge-m3": "ollama",
};

export function presetToProviderId(presetId: EmbedPresetId): ProviderId {
  return PRESET_TO_PROVIDER[presetId];
}

// Display category for an embedding-consistency row, derived from a probe.
// "not-embedded" is distinct from "mismatch": the former means the workspace
// has chunks but zero carry embedding metadata (wiped or never embedded),
// the latter means some are embedded on a model that doesn't match the probe.
export type EmbedRowStatus = "consistent" | "not-embedded" | "mismatch";

export function deriveEmbedStatus(
  totalChunks: number,
  embeddedCount: number,
  toReembed: number,
): EmbedRowStatus {
  if (totalChunks === 0) return "consistent";
  if (embeddedCount === 0) return "not-embedded";
  if (toReembed > 0) return "mismatch";
  return "consistent";
}

export function resolvePresetDim(preset: EmbedPreset): number {
  // Matryoshka models (Jina v3) advertise multiple valid dims; default to the
  // largest so retrieval quality is not silently downgraded.
  if (Array.isArray(preset.dim)) {
    const last = preset.dim[preset.dim.length - 1];
    return last ?? 0;
  }
  return preset.dim;
}

function chunkEffectiveDim(chunk: ChunkRecord): number | undefined {
  if (typeof chunk.embeddingDim === "number") return chunk.embeddingDim;
  if (chunk.embedding) return chunk.embedding.length;
  return undefined;
}

// "Embedded" for display/teardown purposes = carries any embedding metadata.
// Kept identical to the predicate pruneEmbeddings clears on, so an EmbedSection
// "delete embedding" affordance gated on embeddedCount > 0 is enabled exactly
// when there is something for the prune to remove.
function hasAnyEmbedding(chunk: ChunkRecord): boolean {
  return (
    chunk.embedding !== undefined ||
    chunk.embeddingModel !== undefined ||
    chunk.embeddingDim !== undefined ||
    chunk.embeddingProvider !== undefined
  );
}

function matchesTargetDim(
  preset: EmbedPreset,
  chunkDim: number | undefined,
): boolean {
  if (chunkDim == null) return false;
  if (Array.isArray(preset.dim)) return preset.dim.includes(chunkDim);
  return preset.dim === chunkDim;
}

async function readChunksForScope(scope: ReembedScope): Promise<ChunkRecord[]> {
  if (scope.kind === "workspace") {
    return db.chunks.where("workspaceId").equals(scope.workspaceId).toArray();
  }
  return db.chunks.where("sourceId").equals(scope.sourceId).toArray();
}

export async function planReembed(
  scope: ReembedScope,
  targetPresetId: EmbedPresetId,
): Promise<ReembedPlan> {
  const preset = EMBED_PRESETS[targetPresetId];
  const targetDim = resolvePresetDim(preset);
  const chunks = await readChunksForScope(scope);
  let toReembed = 0;
  let estTokens = 0;
  let embeddedCount = 0;
  for (const c of chunks) {
    if (hasAnyEmbedding(c)) embeddedCount += 1;
    const cdim = chunkEffectiveDim(c);
    if (!matchesTargetDim(preset, cdim)) {
      toReembed += 1;
      estTokens += c.tokenCount ?? 0;
    }
  }
  const estCostUsd = computeCostUsd(preset.model, {
    input_tokens: estTokens,
  });
  return {
    totalChunks: chunks.length,
    toReembed,
    embeddedCount,
    estTokens,
    estCostUsd,
    targetPresetId,
    targetDim,
  };
}

export type ReembedHandle = {
  promise: Promise<{ done: number; total: number }>;
  cancel: () => void;
};

export type RunReembedArgs = {
  scope: ReembedScope;
  apiKey: string;
  presetId: EmbedPresetId;
  onProgress?: (p: { done: number; total: number }) => void;
};

export function runReembed(args: RunReembedArgs): ReembedHandle {
  let cancelled = false;
  let cancelEmbed: (() => void) | null = null;

  const promise = (async (): Promise<{ done: number; total: number }> => {
    const preset = EMBED_PRESETS[args.presetId];
    const providerId = PRESET_TO_PROVIDER[args.presetId];
    const targetDim = resolvePresetDim(preset);
    const chunks = await readChunksForScope(args.scope);
    if (cancelled) return { done: 0, total: 0 };

    const toReembed = chunks.filter((c) => {
      const cdim = chunkEffectiveDim(c);
      return !matchesTargetDim(preset, cdim);
    });

    if (toReembed.length === 0) {
      return { done: 0, total: 0 };
    }

    const sourceIds = Array.from(new Set(toReembed.map((c) => c.sourceId)));
    for (const sourceId of sourceIds) {
      await setEmbeddingStatus(sourceId, "embedding", {
        provider: String(providerId),
        model: preset.model,
      });
    }

    const handle = embedSourceChunks({
      apiKey: args.apiKey,
      providerId,
      model: preset.model,
      chunks: toReembed.map((c) => ({ id: c.id, text: c.text })),
      ...(args.onProgress ? { onProgress: args.onProgress } : {}),
    });
    cancelEmbed = handle.cancel;

    let result;
    try {
      result = await handle.promise;
    } catch (err) {
      for (const sourceId of sourceIds) {
        await setEmbeddingStatus(sourceId, "error", {
          provider: String(providerId),
          model: preset.model,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
      if (cancelled) return { done: 0, total: toReembed.length };
      throw err;
    }

    const dim = result.dim || targetDim;
    let written = 0;
    for (const e of result.embeddings) {
      if (cancelled) break;
      await setChunkEmbedding(e.id, e.vector, result.model, {
        dim,
        provider: result.providerId,
      });
      written += 1;
    }

    const writtenSourceIds = new Set(
      result.embeddings.map((e) => {
        const chunk = toReembed.find((c) => c.id === e.id);
        return chunk?.sourceId;
      }),
    );
    for (const sourceId of sourceIds) {
      if (!sourceId) continue;
      await setEmbeddingStatus(sourceId, writtenSourceIds.has(sourceId) ? "ready" : "missing", {
        provider: String(result.providerId),
        model: result.model,
      });
    }

    return { done: written, total: toReembed.length };
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      cancelEmbed?.();
    },
  };
}
