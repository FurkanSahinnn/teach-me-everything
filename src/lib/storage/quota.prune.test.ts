import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSource, getSource } from "@/lib/db/sources";
import { db } from "@/lib/db/schema";
import type { ChunkRecord } from "@/lib/db/types";
import { pruneEmbeddings } from "./quota";

// Direct insert so we can set embeddingDim / embeddingProvider, which the
// public addChunk repo helper does not persist. Optional fields are only
// attached when supplied to respect exactOptionalPropertyTypes.
async function addChunk(
  partial: Partial<ChunkRecord> & { id: string },
): Promise<void> {
  const rec: ChunkRecord = {
    id: partial.id,
    sourceId: partial.sourceId ?? "src_1",
    workspaceId: partial.workspaceId ?? "ws_1",
    index: partial.index ?? 0,
    text: partial.text ?? "hello",
    tokenCount: partial.tokenCount ?? 10,
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

async function addEmbedded(
  id: string,
  extra: Partial<ChunkRecord> = {},
): Promise<void> {
  await addChunk({
    id,
    embedding: new Float32Array(1536),
    embeddingDim: 1536,
    embeddingModel: "text-embedding-3-small",
    embeddingProvider: "openai",
    ...extra,
  });
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe("pruneEmbeddings", () => {
  it("drops every embedding field but keeps chunk text", async () => {
    await addEmbedded("c1");

    const { cleared } = await pruneEmbeddings("ws_1");

    expect(cleared).toBe(1);
    const row = await db.chunks.get("c1");
    expect(row?.text).toBe("hello");
    expect(row?.embedding).toBeUndefined();
    expect(row?.embeddingModel).toBeUndefined();
    expect(row?.embeddingDim).toBeUndefined();
    expect(row?.embeddingProvider).toBeUndefined();
  });

  it("scopes to the given workspace, leaving others embedded", async () => {
    await addEmbedded("a1", { workspaceId: "ws_1" });
    await addEmbedded("b1", { workspaceId: "ws_2" });

    const { cleared } = await pruneEmbeddings("ws_1");

    expect(cleared).toBe(1);
    expect((await db.chunks.get("a1"))?.embedding).toBeUndefined();
    expect((await db.chunks.get("b1"))?.embedding).toBeInstanceOf(Float32Array);
    expect((await db.chunks.get("b1"))?.embeddingDim).toBe(1536);
  });

  it("counts only chunks that carried embedding metadata", async () => {
    await addEmbedded("e1");
    await addChunk({ id: "bare1", index: 1 });
    await addChunk({ id: "bare2", index: 2 });

    const { cleared } = await pruneEmbeddings("ws_1");

    expect(cleared).toBe(1);
  });

  // Pins the predicate widening: a chunk carrying ONLY a stale embeddingDim (or
  // ONLY an embeddingProvider) — no vector, no model — must still be detected
  // and cleared, else a wiped workspace keeps reading as "Consistent".
  it("clears a chunk carrying only a stale embeddingDim", async () => {
    await addChunk({ id: "dim_only", embeddingDim: 1536 });

    const { cleared } = await pruneEmbeddings("ws_1");

    expect(cleared).toBe(1);
    expect((await db.chunks.get("dim_only"))?.embeddingDim).toBeUndefined();
  });

  it("clears a chunk carrying only a stale embeddingProvider", async () => {
    await addChunk({ id: "prov_only", embeddingProvider: "openai" });

    const { cleared } = await pruneEmbeddings("ws_1");

    expect(cleared).toBe(1);
    expect(
      (await db.chunks.get("prov_only"))?.embeddingProvider,
    ).toBeUndefined();
  });

  it("cascades only sources with cleared chunks to 'missing', leaving others", async () => {
    // src_x has an embedded chunk → must flip to "missing".
    // src_bare has only a never-embedded chunk → must keep its "ready" status,
    // since the cascade is driven by actually-cleared chunks, not membership.
    await createSource({
      id: "src_x",
      workspaceId: "ws_1",
      type: "pdf",
      title: "Embedded doc",
      embeddingStatus: "ready",
    });
    await createSource({
      id: "src_bare",
      workspaceId: "ws_1",
      type: "pdf",
      title: "Bare doc",
      embeddingStatus: "ready",
    });
    await addEmbedded("c_x", { sourceId: "src_x" });
    await addChunk({ id: "c_bare", sourceId: "src_bare", index: 1 });

    await pruneEmbeddings("ws_1");

    expect((await getSource("src_x"))?.embeddingStatus).toBe("missing");
    expect((await getSource("src_bare"))?.embeddingStatus).toBe("ready");
  });

  it("clears all workspaces when called with no scope", async () => {
    await addEmbedded("a1", { workspaceId: "ws_1" });
    await addEmbedded("b1", { workspaceId: "ws_2" });

    const { cleared } = await pruneEmbeddings();

    expect(cleared).toBe(2);
    expect((await db.chunks.get("a1"))?.embedding).toBeUndefined();
    expect((await db.chunks.get("b1"))?.embedding).toBeUndefined();
  });
});
