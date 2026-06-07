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
  for (const c of chunks) {
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
