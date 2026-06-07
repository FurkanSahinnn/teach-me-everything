import { newId } from "@/lib/utils/id";
import { db } from "./schema";
import type { HighlightRecord } from "./types";

export type HighlightInput = {
  id?: string;
  sourceId: string;
  workspaceId: string;
  chunkId?: string;
  text: string;
  userNote?: string;
  color: string;
  spanStart: number;
  spanEnd: number;
};

export type HighlightPatch = Partial<
  Pick<HighlightRecord, "userNote" | "color">
>;

export async function createHighlight(
  input: HighlightInput,
): Promise<HighlightRecord> {
  const now = Date.now();
  const record: HighlightRecord = {
    id: input.id ?? newId("hl"),
    sourceId: input.sourceId,
    workspaceId: input.workspaceId,
    chunkId: input.chunkId,
    text: input.text,
    userNote: input.userNote,
    color: input.color,
    spanStart: input.spanStart,
    spanEnd: input.spanEnd,
    createdAt: now,
    updatedAt: now,
  };
  await db.highlights.add(record);
  return record;
}

export async function updateHighlight(
  id: string,
  patch: HighlightPatch,
): Promise<void> {
  await db.highlights.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteHighlight(id: string): Promise<void> {
  await db.highlights.delete(id);
}

export async function listHighlightsBySource(
  sourceId: string,
): Promise<HighlightRecord[]> {
  const items = await db.highlights
    .where("sourceId")
    .equals(sourceId)
    .toArray();
  return items.sort((a, b) => a.spanStart - b.spanStart);
}

export async function listHighlightsByWorkspace(
  workspaceId: string,
): Promise<HighlightRecord[]> {
  const items = await db.highlights
    .where("workspaceId")
    .equals(workspaceId)
    .toArray();
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function countHighlights(workspaceId: string): Promise<number> {
  return db.highlights.where("workspaceId").equals(workspaceId).count();
}
