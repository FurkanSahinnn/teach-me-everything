// Podcasts repo. Two tables in lockstep: `podcasts` (metadata row,
// indexable, in backup) + `podcastBlobs` (binary audio, 1:1 by
// podcastId, excluded from backup). Every mutation that creates or
// removes a podcast row also touches the blob row inside the same
// Dexie transaction so the pair never drifts.

import { newId } from "@/lib/utils/id";
import type {
  PodcastBlobRecord,
  PodcastChapter,
  PodcastRecord,
  PodcastSegment,
  PodcastStatus,
  PodcastUsage,
  PodcastVoice,
} from "@/lib/podcast/types";
import { db } from "./schema";

export type CreatePodcastInput = {
  workspaceId: string;
  title: string;
  titleEn?: string | undefined;
  description?: string | undefined;
  descriptionEn?: string | undefined;
  locale: "tr" | "en";
  sourceIds: string[];
  segments: PodcastSegment[];
  chapters: PodcastChapter[];
  voices: PodcastVoice[];
  modelId: string;
  generationPromptVersion: string;
  status?: PodcastStatus | undefined;
  usage?: PodcastUsage | undefined;
};

export async function createPodcast(
  input: CreatePodcastInput,
): Promise<PodcastRecord> {
  const now = Date.now();
  const record: PodcastRecord = {
    id: newId("pod"),
    workspaceId: input.workspaceId,
    title: input.title,
    locale: input.locale,
    sourceIds: input.sourceIds.slice(),
    segments: input.segments.slice(),
    chapters: input.chapters.slice(),
    voices: input.voices.slice(),
    modelId: input.modelId,
    generationPromptVersion: input.generationPromptVersion,
    status: input.status ?? "scripted",
    createdAt: now,
    updatedAt: now,
  };
  if (input.titleEn !== undefined) record.titleEn = input.titleEn;
  if (input.description !== undefined) record.description = input.description;
  if (input.descriptionEn !== undefined) {
    record.descriptionEn = input.descriptionEn;
  }
  if (input.usage !== undefined) record.usage = input.usage;
  await db.podcasts.add(record);
  return record;
}

export async function getPodcast(id: string): Promise<PodcastRecord | null> {
  const row = await db.podcasts.get(id);
  return row ?? null;
}

export async function listPodcastsByWorkspace(
  workspaceId: string,
): Promise<PodcastRecord[]> {
  const rows = await db.podcasts
    .where("workspaceId")
    .equals(workspaceId)
    .sortBy("createdAt");
  return rows.reverse();
}

export type UpdatePodcastInput = Partial<
  Pick<
    PodcastRecord,
    | "title"
    | "titleEn"
    | "description"
    | "descriptionEn"
    | "segments"
    | "chapters"
    | "voices"
    | "ttsProvider"
    | "ttsModelId"
    | "audioMimeType"
    | "totalMs"
    | "status"
    | "errorMessage"
    | "usage"
    | "audioDisclosure"
  >
>;

export async function updatePodcast(
  id: string,
  patch: UpdatePodcastInput,
): Promise<void> {
  // Dexie's `update()` ignores undefined keys, which matches what we
  // want: callers can build a partial patch object without first
  // stripping undefineds.
  await db.podcasts.update(id, { ...patch, updatedAt: Date.now() });
}

export async function setPodcastStatus(
  id: string,
  status: PodcastStatus,
  errorMessage?: string,
): Promise<void> {
  const patch: UpdatePodcastInput = { status };
  if (status === "error") {
    patch.errorMessage = errorMessage ?? "Unknown error";
  } else if (errorMessage !== undefined) {
    patch.errorMessage = errorMessage;
  }
  await updatePodcast(id, patch);
}

export async function setPodcastBlob(
  podcastId: string,
  blob: Blob,
  contentType: string,
): Promise<void> {
  const record: PodcastBlobRecord = {
    podcastId,
    blob,
    contentType,
    byteSize: blob.size,
    createdAt: Date.now(),
  };
  await db.podcastBlobs.put(record);
}

export async function getPodcastBlob(
  podcastId: string,
): Promise<PodcastBlobRecord | null> {
  const row = await db.podcastBlobs.get(podcastId);
  return row ?? null;
}

export async function deletePodcast(id: string): Promise<void> {
  await db.transaction("rw", [db.podcasts, db.podcastBlobs], async () => {
    await db.podcastBlobs.delete(id);
    await db.podcasts.delete(id);
  });
}

/**
 * Cascade-delete every podcast (and its audio blob) for a workspace.
 * Used by `deleteWorkspace` — kept here so the blob-cleanup logic stays
 * next to the table that owns it, and the workspace cascade only has
 * to call one function.
 */
export async function deletePodcastsByWorkspace(
  workspaceId: string,
): Promise<void> {
  const ids = await db.podcasts
    .where("workspaceId")
    .equals(workspaceId)
    .primaryKeys();
  if (ids.length === 0) return;
  await db.transaction("rw", [db.podcasts, db.podcastBlobs], async () => {
    await db.podcastBlobs.bulkDelete(ids);
    await db.podcasts.bulkDelete(ids);
  });
}
