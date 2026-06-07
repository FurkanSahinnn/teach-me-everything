import { describe, expect, it } from "vitest";
import type { RetrievedChunk } from "@/lib/ai/retrieval";
import type { ChunkRecord } from "@/lib/db/types";
import { distinctSourcesFromChunks, retrieveRelatedChunks } from "./related";

function chunk(
  id: string,
  sourceId: string,
  embedding: Float32Array | undefined,
): ChunkRecord {
  return {
    id,
    sourceId,
    workspaceId: "w1",
    index: 0,
    text: id,
    tokenCount: 10,
    page: null,
    section: null,
    headings: [],
    createdAt: 0,
    ...(embedding
      ? {
          embedding,
          embeddingProvider: "openai",
          embeddingModel: "text-embedding-3-small",
          embeddingDim: embedding.length,
        }
      : {}),
  } as unknown as ChunkRecord;
}

const emb = (n: number): Float32Array => Float32Array.from([n, 0, 0]);

describe("distinctSourcesFromChunks", () => {
  it("groups by source with best score + count, sorted best-first", () => {
    const retrieved: RetrievedChunk[] = [
      { chunk: chunk("c1", "sA", undefined), score: 0.5 },
      { chunk: chunk("c2", "sA", undefined), score: 0.8 },
      { chunk: chunk("c3", "sB", undefined), score: 0.6 },
    ];
    const out = distinctSourcesFromChunks(retrieved);
    expect(out.map((s) => s.sourceId)).toEqual(["sA", "sB"]);
    expect(out[0]).toMatchObject({ sourceId: "sA", bestScore: 0.8, chunkCount: 2 });
    expect(out[1]).toMatchObject({ sourceId: "sB", bestScore: 0.6, chunkCount: 1 });
  });
});

describe("retrieveRelatedChunks", () => {
  it("reports no_chunks for an empty workspace", async () => {
    const res = await retrieveRelatedChunks("w1", "q", {
      loadChunks: async () => [],
    });
    expect(res.reason).toBe("no_chunks");
    expect(res.chunks).toHaveLength(0);
  });

  it("reports no_embeddings when chunks have no vectors", async () => {
    const res = await retrieveRelatedChunks("w1", "q", {
      loadChunks: async () => [chunk("c1", "sA", undefined)],
    });
    expect(res.reason).toBe("no_embeddings");
  });

  it("reports no_key when the embedder yields null", async () => {
    const res = await retrieveRelatedChunks("w1", "q", {
      loadChunks: async () => [chunk("c1", "sA", emb(1))],
      embedQuery: async () => null,
    });
    expect(res.reason).toBe("no_key");
  });

  it("ranks chunks by similarity to the query embedding", async () => {
    const res = await retrieveRelatedChunks("w1", "q", {
      loadChunks: async () => [
        chunk("c1", "sA", emb(1)),
        chunk("c2", "sB", emb(-1)),
      ],
      embedQuery: async () => emb(1),
    });
    expect(res.reason).toBeUndefined();
    expect(res.chunks[0]?.chunk.id).toBe("c1");
  });

  it("scopes retrieval to the given sourceIds", async () => {
    const res = await retrieveRelatedChunks("w1", "q", {
      loadChunks: async () => [
        chunk("c1", "sA", emb(1)),
        chunk("c2", "sB", emb(1)),
      ],
      embedQuery: async () => emb(1),
      sourceIds: ["sA"],
    });
    expect(res.chunks.map((c) => c.chunk.id)).toEqual(["c1"]);
  });

  it("reports no_chunks when the sourceIds match nothing", async () => {
    const res = await retrieveRelatedChunks("w1", "q", {
      loadChunks: async () => [chunk("c1", "sA", emb(1))],
      embedQuery: async () => emb(1),
      sourceIds: ["sZ"],
    });
    expect(res.reason).toBe("no_chunks");
  });
});
