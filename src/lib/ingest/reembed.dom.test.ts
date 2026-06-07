import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/schema";
import type { ChunkRecord } from "@/lib/db/types";
import { planReembed } from "./reembed";

// Insert a ChunkRecord without leaking explicit `undefined` fields, which
// would trip exactOptionalPropertyTypes. Optional embedding fields are only
// set when supplied so legacy/missing-embedding paths can be exercised.
async function addChunk(
  partial: Partial<ChunkRecord> & { id: string },
): Promise<void> {
  const rec: ChunkRecord = {
    id: partial.id,
    sourceId: partial.sourceId ?? "src_1",
    workspaceId: partial.workspaceId ?? "ws_1",
    index: partial.index ?? 0,
    text: partial.text ?? "hello",
    tokenCount: partial.tokenCount ?? 100,
    createdAt: partial.createdAt ?? Date.now(),
    ...(partial.embedding !== undefined ? { embedding: partial.embedding } : {}),
    ...(partial.embeddingDim !== undefined
      ? { embeddingDim: partial.embeddingDim }
      : {}),
    ...(partial.embeddingModel !== undefined
      ? { embeddingModel: partial.embeddingModel }
      : {}),
    ...(partial.embeddingProvider !== undefined
      ? { embeddingProvider: partial.embeddingProvider }
      : {}),
  };
  await db.chunks.add(rec);
}

describe("planReembed", () => {
  beforeEach(async () => {
    await db.chunks.clear();
  });

  it("counts dim mismatches against the target preset", async () => {
    for (let i = 0; i < 3; i += 1) {
      await addChunk({
        id: `match_${i}`,
        index: i,
        embedding: new Float32Array(1536),
        embeddingDim: 1536,
        embeddingModel: "text-embedding-3-small",
      });
    }
    for (let i = 0; i < 2; i += 1) {
      await addChunk({
        id: `mismatch_${i}`,
        index: 3 + i,
        embedding: new Float32Array(1024),
        embeddingDim: 1024,
        embeddingModel: "voyage-3",
      });
    }

    const plan = await planReembed(
      { kind: "workspace", workspaceId: "ws_1" },
      "openai-3-small",
    );

    expect(plan.totalChunks).toBe(5);
    expect(plan.toReembed).toBe(2);
    expect(plan.targetDim).toBe(1536);
  });

  it("reports zero when every chunk already matches the target dim", async () => {
    for (let i = 0; i < 4; i += 1) {
      await addChunk({
        id: `ok_${i}`,
        index: i,
        embedding: new Float32Array(1536),
        embeddingDim: 1536,
      });
    }

    const plan = await planReembed(
      { kind: "workspace", workspaceId: "ws_1" },
      "openai-3-small",
    );

    expect(plan.toReembed).toBe(0);
  });

  it("falls back to embedding.length when embeddingDim is unset", async () => {
    // Legacy v6 chunk: embedding present but embeddingDim never persisted.
    await addChunk({
      id: "legacy_1",
      embedding: new Float32Array(1536),
    });

    const plan = await planReembed(
      { kind: "workspace", workspaceId: "ws_1" },
      "openai-3-small",
    );

    expect(plan.toReembed).toBe(0);
  });

  it("counts chunks with no embedding as needing reembedding", async () => {
    for (let i = 0; i < 3; i += 1) {
      await addChunk({ id: `empty_${i}`, index: i });
    }

    const plan = await planReembed(
      { kind: "workspace", workspaceId: "ws_1" },
      "openai-3-small",
    );

    expect(plan.toReembed).toBe(3);
  });

  it("estimates cost as tokens × per-million price", async () => {
    await addChunk({ id: "cost_1", tokenCount: 1000 });

    const plan = await planReembed(
      { kind: "workspace", workspaceId: "ws_1" },
      "openai-3-small",
    );

    expect(plan.estTokens).toBe(1000);
    // openai-3-small input price is $0.02 per 1M tokens → 1000 tokens = $0.00002
    expect(plan.estCostUsd).toBeCloseTo(0.00002, 8);
  });
});
