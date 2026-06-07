import { db } from "./schema";
import type { SourceBlobRecord } from "./types";

export async function saveSourceBlob(
  sourceId: string,
  file: File | Blob,
  opts: { contentType?: string } = {},
): Promise<SourceBlobRecord> {
  const contentType =
    opts.contentType ??
    (file instanceof File ? file.type : "") ??
    "application/octet-stream";
  const record: SourceBlobRecord = {
    sourceId,
    blob: file instanceof File ? new Blob([file], { type: contentType }) : file,
    contentType,
    byteSize: file.size,
    createdAt: Date.now(),
  };
  await db.sourceBlobs.put(record);
  return record;
}

export async function getSourceBlob(sourceId: string): Promise<Blob | null> {
  const row = await db.sourceBlobs.get(sourceId);
  return row?.blob ?? null;
}

export async function getSourceBlobMeta(
  sourceId: string,
): Promise<Pick<SourceBlobRecord, "contentType" | "byteSize" | "createdAt"> | null> {
  const row = await db.sourceBlobs.get(sourceId);
  if (!row) return null;
  return {
    contentType: row.contentType,
    byteSize: row.byteSize,
    createdAt: row.createdAt,
  };
}

export async function hasSourceBlob(sourceId: string): Promise<boolean> {
  const count = await db.sourceBlobs.where("sourceId").equals(sourceId).count();
  return count > 0;
}

export async function deleteSourceBlob(sourceId: string): Promise<void> {
  await db.sourceBlobs.delete(sourceId);
}
