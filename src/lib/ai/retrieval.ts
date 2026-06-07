// Pure k-NN retrieval over chunk embeddings. No DB / network — just math.
// OpenAI text-embedding-3-small returns L2-normalized vectors, so cosine sim
// reduces to a dot product. We still defensively normalize the query in case
// callers pass raw vectors.

import type { ChunkRecord } from "@/lib/db/types";

export type RetrievedChunk = {
  chunk: ChunkRecord;
  score: number;
};

export type TopKInput = {
  queryEmbedding: Float32Array;
  chunks: ChunkRecord[];
  k?: number;
  maxTokens?: number;
};

export type TopKResult = {
  chunks: RetrievedChunk[];
  skippedCount: number;
};

const DEFAULT_K = 10;
const DEFAULT_MAX_TOKENS = 6000;

export function dotProduct(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += (a[i] as number) * (b[i] as number);
  }
  return sum;
}

export function l2Norm(v: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i += 1) {
    const x = v[i] as number;
    sum += x * x;
  }
  return Math.sqrt(sum);
}

export function cosineSim(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  const na = l2Norm(a);
  const nb = l2Norm(b);
  if (na === 0 || nb === 0) return 0;
  return dotProduct(a, b) / (na * nb);
}

export function topKChunks(input: TopKInput): TopKResult {
  const k = input.k ?? DEFAULT_K;
  const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS;
  const queryDim = input.queryEmbedding.length;
  let skippedCount = 0;

  // Mismatched dims would short-circuit cosineSim() to 0 and silently degrade
  // ranking; explicit skip + counter lets the UI prompt the user to reembed.
  // Always loop (no early-return on k<=0) so skippedCount stays accurate even
  // when the caller asks for zero results.
  const scored: RetrievedChunk[] = [];
  for (const chunk of input.chunks) {
    if (!chunk.embedding) continue;
    // Fall back to embedding.length for legacy chunks that pre-date the
    // v6→v7 migration backfill (where embeddingDim was first persisted).
    const chunkDim = chunk.embeddingDim ?? chunk.embedding.length;
    if (chunkDim !== queryDim) {
      skippedCount += 1;
      continue;
    }
    const score = cosineSim(input.queryEmbedding, chunk.embedding);
    scored.push({ chunk, score });
  }

  if (k <= 0) return { chunks: [], skippedCount };

  scored.sort((a, b) => b.score - a.score);

  const out: RetrievedChunk[] = [];
  let tokens = 0;
  for (const r of scored) {
    if (out.length >= k) break;
    const cost = r.chunk.tokenCount || 0;
    if (tokens + cost > maxTokens && out.length > 0) break;
    out.push(r);
    tokens += cost;
  }

  // Restore document order so the assistant sees the source as it flows on the
  // page rather than highest-similarity-first. Cache breakpoint stays stable
  // across queries because order is deterministic for a given retrieval set.
  out.sort((a, b) => a.chunk.index - b.chunk.index);
  return { chunks: out, skippedCount };
}
