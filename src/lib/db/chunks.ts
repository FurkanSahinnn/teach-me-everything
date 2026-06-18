import { newId } from "@/lib/utils/id";
import { db } from "./schema";
import type { ChunkRecord } from "./types";

export type ChunkInput = Omit<ChunkRecord, "id" | "createdAt"> & {
  id?: string;
};

export async function addChunk(input: ChunkInput): Promise<ChunkRecord> {
  const record: ChunkRecord = {
    id: input.id ?? newId("ck"),
    sourceId: input.sourceId,
    workspaceId: input.workspaceId,
    index: input.index,
    text: input.text,
    tokenCount: input.tokenCount,
    page: input.page,
    section: input.section,
    headings: input.headings,
    embeddingModel: input.embeddingModel,
    embedding: input.embedding,
    createdAt: Date.now(),
  };
  await db.chunks.add(record);
  return record;
}

export async function bulkAddChunks(
  inputs: ChunkInput[],
): Promise<ChunkRecord[]> {
  const now = Date.now();
  const records: ChunkRecord[] = inputs.map((input) => ({
    id: input.id ?? newId("ck"),
    sourceId: input.sourceId,
    workspaceId: input.workspaceId,
    index: input.index,
    text: input.text,
    tokenCount: input.tokenCount,
    page: input.page,
    section: input.section,
    headings: input.headings,
    embeddingModel: input.embeddingModel,
    embedding: input.embedding,
    createdAt: now,
  }));
  await db.chunks.bulkAdd(records);
  return records;
}

export async function getChunk(id: string): Promise<ChunkRecord | undefined> {
  return db.chunks.get(id);
}

export async function listChunksBySource(
  sourceId: string,
): Promise<ChunkRecord[]> {
  return db.chunks.where("sourceId").equals(sourceId).sortBy("index");
}

/** Bulk fetch by id list, preserving the request order. Used by mind-map
 *  inspector to render backlink quote spans for a concept's chunkRefs. */
export async function listChunksByIds(ids: string[]): Promise<ChunkRecord[]> {
  if (ids.length === 0) return [];
  const rows = await db.chunks.bulkGet(ids);
  return rows.filter((r): r is ChunkRecord => r !== undefined);
}

export async function setChunkEmbedding(
  id: string,
  embedding: Float32Array,
  model: string,
  opts?: { dim?: number; provider?: string },
): Promise<void> {
  // embeddingDim eagerly persisted so the retrieval dim guard can short-circuit
  // without rehydrating the Float32Array length on every query.
  await db.chunks.update(id, {
    embedding,
    embeddingModel: model,
    embeddingDim: opts?.dim ?? embedding.length,
    ...(opts?.provider ? { embeddingProvider: opts.provider } : {}),
  });
}

export async function deleteChunksBySource(sourceId: string): Promise<void> {
  await db.chunks.where("sourceId").equals(sourceId).delete();
}

export async function countChunks(workspaceId: string): Promise<number> {
  return db.chunks.where("workspaceId").equals(workspaceId).count();
}

// Workspace Chat — every chunk across ALL sources in a workspace. The chunks
// table already carries an indexed `workspaceId` (denormalised at write time
// by addChunk/bulkAddChunks), so this is a single indexed range query — no
// need to gather sources first. Sorted by (sourceId, index) so callers that
// re-group retrieved chunks back by source get a stable in-document order.
export async function listChunksByWorkspace(
  workspaceId: string,
): Promise<ChunkRecord[]> {
  const rows = await db.chunks
    .where("workspaceId")
    .equals(workspaceId)
    .toArray();
  return rows.sort((a, b) => {
    if (a.sourceId !== b.sourceId) {
      return a.sourceId < b.sourceId ? -1 : 1;
    }
    return a.index - b.index;
  });
}
