// Node → workspace retrieval. Embeds a roadmap node's topic and ranks the
// workspace's chunks by cosine similarity so the inspector can surface the
// most relevant source material ("Related sources") and, later, ground
// per-node flashcard/lesson generation. Costs one small query embedding;
// the cosine pass itself is local + free.

import { getApiKey } from "@/lib/db/api-keys-repo";
import { getEmbedProvider } from "@/lib/ai/providers/registry";
import { topKChunks, type RetrievedChunk } from "@/lib/ai/retrieval";
import { db } from "@/lib/db/schema";
import type { ChunkRecord } from "@/lib/db/types";
import type { ProviderId } from "@/lib/ai/providers/types";

const DEFAULT_EMBED_MODEL = "text-embedding-3-small";
// Providers that run locally need no API key (the adapter omits the header).
const LOCAL_EMBED_PROVIDERS = new Set(["ollama", "lm-studio", "llama-cpp"]);

export type RelatedReason =
  | "no_chunks"
  | "no_embeddings"
  | "no_key"
  | "embed_failed"
  | "empty";

export type RelatedResult = {
  chunks: RetrievedChunk[];
  reason?: RelatedReason;
  // Underlying provider error message when reason === "embed_failed", so the
  // UI can tell the user WHY (rate limit, retired model, bad key…) instead of
  // a blank "search failed".
  detail?: string;
};

export type RelatedSource = {
  sourceId: string;
  bestScore: number;
  chunkCount: number;
};

// Injection seam so the retrieval orchestration is unit-testable without a
// live embed provider / IndexedDB.
export type RetrieveRelatedDeps = {
  loadChunks?: (workspaceId: string) => Promise<ChunkRecord[]>;
  embedQuery?: (args: {
    provider: string;
    model: string;
    query: string;
  }) => Promise<Float32Array | null>;
};

async function defaultLoadChunks(workspaceId: string): Promise<ChunkRecord[]> {
  return db.chunks.where("workspaceId").equals(workspaceId).toArray();
}

async function defaultEmbedQuery(args: {
  provider: string;
  model: string;
  query: string;
}): Promise<Float32Array | null> {
  let apiKey: string | null = "";
  if (!LOCAL_EMBED_PROVIDERS.has(args.provider)) {
    try {
      apiKey = await getApiKey(args.provider as Parameters<typeof getApiKey>[0]);
    } catch {
      apiKey = null;
    }
  }
  if (apiKey === null) return null;
  const result = await getEmbedProvider(args.provider as ProviderId).embed({
    apiKey,
    model: args.model,
    inputs: [args.query],
  });
  return result.vectors[0] ?? null;
}

/**
 * Rank the workspace's embedded chunks against `query`. Returns the top-k
 * retrieved chunks, or an empty list + a `reason` the UI can explain
 * (no embeddings yet, missing key, embed call failed, nothing relevant).
 */
export async function retrieveRelatedChunks(
  workspaceId: string,
  query: string,
  opts: {
    k?: number;
    /** Token budget for the returned excerpts (caps prompt size / cost). */
    maxTokens?: number;
    /** Narrow retrieval to specific source ids. Empty/undefined = all. */
    sourceIds?: readonly string[];
  } & RetrieveRelatedDeps = {},
): Promise<RelatedResult> {
  const loadChunks = opts.loadChunks ?? defaultLoadChunks;
  const embedQuery = opts.embedQuery ?? defaultEmbedQuery;

  const all = await loadChunks(workspaceId);
  if (all.length === 0) return { chunks: [], reason: "no_chunks" };
  // Optional per-document scope: ground only on the selected sources.
  const sourceFilter =
    opts.sourceIds && opts.sourceIds.length > 0
      ? new Set(opts.sourceIds)
      : null;
  const scoped = sourceFilter
    ? all.filter((c) => sourceFilter.has(c.sourceId))
    : all;
  if (scoped.length === 0) return { chunks: [], reason: "no_chunks" };
  const withEmbeddings = scoped.filter((c) => c.embedding);
  if (withEmbeddings.length === 0) return { chunks: [], reason: "no_embeddings" };

  const provider =
    withEmbeddings.find((c) => c.embeddingProvider)?.embeddingProvider ??
    "openai";
  const model =
    withEmbeddings.find((c) => c.embeddingModel)?.embeddingModel ??
    DEFAULT_EMBED_MODEL;

  let queryVec: Float32Array | null;
  try {
    queryVec = await embedQuery({ provider, model, query });
  } catch (err) {
    // Surface the real cause — the embed model used to vectorize the chunks
    // (`${provider}/${model}`) may be retired/rate-limited/misconfigured, or
    // there's no key for that provider.
    return {
      chunks: [],
      reason: "embed_failed",
      detail: describeEmbedError(provider, model, err),
    };
  }
  if (queryVec === null) return { chunks: [], reason: "no_key" };

  const retrieved = topKChunks({
    queryEmbedding: queryVec,
    chunks: withEmbeddings,
    k: opts.k ?? 8,
    ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
  });
  if (retrieved.chunks.length === 0) return { chunks: [], reason: "empty" };
  return { chunks: retrieved.chunks };
}

// Extract a human-readable reason from any thrown shape — a ProviderError
// carries `status` + `code` alongside `message`, and some errors stringify to
// "[object Object]" when their message was built from an object. Pull whatever
// useful fields exist so the inspector shows "401 · missing_key · …" instead
// of an opaque blob.
function describeEmbedError(
  provider: string,
  model: string,
  err: unknown,
): string {
  const base = `${provider}/${model}`;
  if (err && typeof err === "object") {
    const o = err as { status?: unknown; code?: unknown; message?: unknown };
    const status = typeof o.status === "number" ? String(o.status) : "";
    const code = typeof o.code === "string" ? o.code : "";
    const msg =
      typeof o.message === "string" &&
      o.message.length > 0 &&
      o.message !== "[object Object]"
        ? o.message
        : "";
    const parts = [status, code, msg].filter((x) => x.length > 0);
    if (parts.length > 0) return `${base}: ${parts.join(" · ")}`;
  }
  return `${base}: ${String(err)}`;
}

/**
 * Collapse retrieved chunks into distinct sources, keeping each source's best
 * similarity score and how many of its chunks matched. Sorted best-first.
 * Pure — the caller resolves source titles from its own sources list.
 */
export function distinctSourcesFromChunks(
  retrieved: RetrievedChunk[],
): RelatedSource[] {
  const bySource = new Map<string, RelatedSource>();
  for (const r of retrieved) {
    const sourceId = r.chunk.sourceId;
    const existing = bySource.get(sourceId);
    if (existing) {
      existing.chunkCount += 1;
      if (r.score > existing.bestScore) existing.bestScore = r.score;
    } else {
      bySource.set(sourceId, {
        sourceId,
        bestScore: r.score,
        chunkCount: 1,
      });
    }
  }
  return Array.from(bySource.values()).sort(
    (a, b) => b.bestScore - a.bestScore,
  );
}
