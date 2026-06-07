import { describe, it, expect } from "vitest";
import { cosineSim, dotProduct, l2Norm, topKChunks } from "./retrieval";
import type { ChunkRecord } from "@/lib/db/types";

function vec(values: number[]): Float32Array {
  return Float32Array.from(values);
}

function chunk(
  index: number,
  embedding: Float32Array | undefined,
  tokenCount = 100,
  embeddingDim?: number,
): ChunkRecord {
  return {
    id: `c${index}`,
    sourceId: "src1",
    workspaceId: "ws1",
    index,
    text: `chunk ${index}`,
    tokenCount,
    ...(embedding ? { embedding } : {}),
    ...(embeddingDim !== undefined ? { embeddingDim } : {}),
    createdAt: 0,
  };
}

describe("dotProduct / l2Norm / cosineSim", () => {
  it("dotProduct returns 0 for length mismatch", () => {
    expect(dotProduct(vec([1, 2]), vec([1]))).toBe(0);
  });

  it("dotProduct computes the inner product", () => {
    expect(dotProduct(vec([1, 2, 3]), vec([4, 5, 6]))).toBe(32);
  });

  it("l2Norm returns sqrt of sum of squares", () => {
    expect(l2Norm(vec([3, 4]))).toBeCloseTo(5, 6);
  });

  it("cosineSim is 1 for identical vectors and -1 for opposites", () => {
    expect(cosineSim(vec([1, 2, 3]), vec([1, 2, 3]))).toBeCloseTo(1, 6);
    expect(cosineSim(vec([1, 2, 3]), vec([-1, -2, -3]))).toBeCloseTo(-1, 6);
  });

  it("cosineSim is 0 for orthogonal vectors", () => {
    expect(cosineSim(vec([1, 0]), vec([0, 1]))).toBe(0);
  });

  it("cosineSim returns 0 when either vector has zero norm", () => {
    expect(cosineSim(vec([0, 0, 0]), vec([1, 1, 1]))).toBe(0);
  });
});

describe("topKChunks", () => {
  const query = vec([1, 0, 0]);

  it("returns an empty result for empty inputs", () => {
    expect(topKChunks({ queryEmbedding: query, chunks: [], k: 5 })).toEqual({
      chunks: [],
      skippedCount: 0,
    });
    expect(
      topKChunks({ queryEmbedding: query, chunks: [chunk(0, undefined)], k: 0 }),
    ).toEqual({ chunks: [], skippedCount: 0 });
  });

  it("skips chunks that lack an embedding", () => {
    const result = topKChunks({
      queryEmbedding: query,
      chunks: [chunk(0, undefined), chunk(1, vec([1, 0, 0]))],
      k: 5,
    });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]?.chunk.id).toBe("c1");
    // No-embedding is a separate path from dim mismatch.
    expect(result.skippedCount).toBe(0);
  });

  it("selects the k highest-similarity chunks", () => {
    const chunks = [
      chunk(0, vec([0, 1, 0])),       // sim 0
      chunk(1, vec([0.9, 0.1, 0])),   // sim ~0.99
      chunk(2, vec([1, 0, 0])),       // sim 1
      chunk(3, vec([-1, 0, 0])),      // sim -1
      chunk(4, vec([0.5, 0.5, 0])),   // sim ~0.71
    ];
    const result = topKChunks({ queryEmbedding: query, chunks, k: 3 });
    expect(result.chunks.map((r) => r.chunk.id).sort()).toEqual(["c1", "c2", "c4"]);
    expect(result.skippedCount).toBe(0);
  });

  it("restores document order in the returned set", () => {
    const chunks = [
      chunk(0, vec([0.5, 0.5, 0])),
      chunk(1, vec([0.9, 0.1, 0])),
      chunk(2, vec([1, 0, 0])),
    ];
    const result = topKChunks({ queryEmbedding: query, chunks, k: 3 });
    expect(result.chunks.map((r) => r.chunk.index)).toEqual([0, 1, 2]);
  });

  it("respects the maxTokens budget", () => {
    const chunks = [
      chunk(0, vec([1, 0, 0]), 4000),
      chunk(1, vec([0.9, 0.1, 0]), 4000),
      chunk(2, vec([0.8, 0.2, 0]), 4000),
    ];
    const result = topKChunks({
      queryEmbedding: query,
      chunks,
      k: 10,
      maxTokens: 6000,
    });
    expect(result.chunks).toHaveLength(1);
  });

  it("uses default k=10 and budget=6000 when omitted", () => {
    const chunks = Array.from({ length: 12 }, (_, i) =>
      chunk(i, vec([1, 0, 0]), 100),
    );
    const result = topKChunks({ queryEmbedding: query, chunks });
    expect(result.chunks).toHaveLength(10);
  });

  it("silently skips dim-mismatched chunks and counts them", () => {
    const q4 = vec([1, 0, 0, 0]);
    const chunks = [
      chunk(0, vec([1, 0, 0, 0]), 100, 4),       // match
      chunk(1, vec([1, 0, 0, 0, 0, 0, 0, 0]), 100, 8), // skip (dim 8)
      chunk(2, vec([0, 1, 0, 0, 0, 0, 0, 0]), 100, 8), // skip (dim 8)
    ];
    const result = topKChunks({ queryEmbedding: q4, chunks, k: 5 });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]?.chunk.id).toBe("c0");
    expect(result.skippedCount).toBe(2);
  });

  it("falls back to embedding.length when embeddingDim is undefined (legacy chunks)", () => {
    const q3 = vec([1, 0, 0]);
    // Legacy chunk: embedding present but embeddingDim never persisted.
    const c = chunk(0, vec([1, 0, 0]));
    const result = topKChunks({ queryEmbedding: q3, chunks: [c], k: 5 });
    expect(result.chunks).toHaveLength(1);
    expect(result.skippedCount).toBe(0);
  });

  it("returns no chunks when every chunk has a mismatched dim", () => {
    const q4 = vec([1, 0, 0, 0]);
    const chunks = [
      chunk(0, vec([1, 0]), 100, 2),
      chunk(1, vec([1, 0, 0]), 100, 3),
      chunk(2, vec([1, 0, 0, 0, 0, 0]), 100, 6),
    ];
    const result = topKChunks({ queryEmbedding: q4, chunks, k: 5 });
    expect(result.chunks).toHaveLength(0);
    expect(result.skippedCount).toBe(3);
  });

  it("counts only dim mismatches, not missing embeddings", () => {
    const q3 = vec([1, 0, 0]);
    const chunks = [
      chunk(0, undefined),                      // no embedding — not counted
      chunk(1, vec([1, 0, 0, 0, 0, 0]), 100, 6),// dim mismatch — counted
      chunk(2, vec([1, 0, 0]), 100, 3),         // match
    ];
    const result = topKChunks({ queryEmbedding: q3, chunks, k: 5 });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]?.chunk.id).toBe("c2");
    expect(result.skippedCount).toBe(1);
  });

  it("still computes skippedCount when k=0", () => {
    const q3 = vec([1, 0, 0]);
    const chunks = [
      chunk(0, vec([1, 0, 0, 0, 0, 0]), 100, 6),
      chunk(1, vec([1, 0, 0]), 100, 3),
    ];
    const result = topKChunks({ queryEmbedding: q3, chunks, k: 0 });
    expect(result.chunks).toHaveLength(0);
    // Loop must run before the k<=0 guard so the UI can surface the mismatch.
    expect(result.skippedCount).toBe(1);
  });
});
