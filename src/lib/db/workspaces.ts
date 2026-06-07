import { newId } from "@/lib/utils/id";
import { db } from "./schema";
import type { WorkspaceRecord } from "./types";

export type WorkspaceInput = {
  id?: string;
  name: string;
  nameEn?: string;
  color: string;
  initials: string;
  goal?: string;
  goalEn?: string;
};

export type WorkspacePatch = Partial<Omit<WorkspaceInput, "id">>;

export async function createWorkspace(
  input: WorkspaceInput,
): Promise<WorkspaceRecord> {
  const now = Date.now();
  const record: WorkspaceRecord = {
    id: input.id ?? newId("ws"),
    name: input.name,
    nameEn: input.nameEn,
    color: input.color,
    initials: input.initials,
    goal: input.goal,
    goalEn: input.goalEn,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  await db.workspaces.add(record);
  return record;
}

export async function getWorkspace(
  id: string,
): Promise<WorkspaceRecord | undefined> {
  return db.workspaces.get(id);
}

export async function updateWorkspace(
  id: string,
  patch: WorkspacePatch,
): Promise<void> {
  await db.workspaces.update(id, { ...patch, updatedAt: Date.now() });
}

export async function archiveWorkspace(id: string): Promise<void> {
  const now = Date.now();
  await db.workspaces.update(id, { archivedAt: now, updatedAt: now });
}

export async function unarchiveWorkspace(id: string): Promise<void> {
  await db.workspaces.update(id, { archivedAt: null, updatedAt: Date.now() });
}

export async function deleteWorkspace(id: string): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.workspaces,
      db.sources,
      db.sourceBlobs,
      db.chunks,
      db.highlights,
      db.decks,
      db.flashcards,
      db.reviewLogs,
      db.chatThreads,
      db.chatMessages,
      db.quizSessions,
      db.concepts,
      db.conceptEdges,
      db.curricula,
      db.curriculumItems,
      db.lessonNotes,
      db.studyJournalEntries,
      db.podcasts,
      db.podcastBlobs,
      db.notes,
      db.noteFolders,
      db.roadmaps,
      db.roadmapNodes,
      db.roadmapEdges,
    ],
    async () => {
      // Heavy/related rows keyed by a *parent* id (not workspaceId) must be
      // collected before their parents are deleted: source blobs (by
      // sourceId), podcast blobs (by podcastId), roadmap nodes/edges (by
      // roadmapId). Previously notes, noteFolders, roadmaps, and sourceBlobs
      // were left behind entirely — orphaned rows that haunt later queries
      // and inflate storage.
      const sourceIds = await db.sources
        .where("workspaceId")
        .equals(id)
        .primaryKeys();
      if (sourceIds.length > 0) {
        await db.sourceBlobs.bulkDelete(sourceIds);
      }
      const podcastIds = await db.podcasts
        .where("workspaceId")
        .equals(id)
        .primaryKeys();
      if (podcastIds.length > 0) {
        await db.podcastBlobs.bulkDelete(podcastIds);
      }
      const roadmapIds = await db.roadmaps
        .where("workspaceId")
        .equals(id)
        .primaryKeys();
      if (roadmapIds.length > 0) {
        await db.roadmapNodes.where("roadmapId").anyOf(roadmapIds).delete();
        await db.roadmapEdges.where("roadmapId").anyOf(roadmapIds).delete();
      }
      await db.roadmaps.where("workspaceId").equals(id).delete();
      await db.notes.where("workspaceId").equals(id).delete();
      await db.noteFolders.where("workspaceId").equals(id).delete();
      await db.podcasts.where("workspaceId").equals(id).delete();
      await db.studyJournalEntries.where("workspaceId").equals(id).delete();
      await db.lessonNotes.where("workspaceId").equals(id).delete();
      await db.curriculumItems.where("workspaceId").equals(id).delete();
      await db.curricula.where("workspaceId").equals(id).delete();
      await db.conceptEdges.where("workspaceId").equals(id).delete();
      await db.concepts.where("workspaceId").equals(id).delete();
      await db.quizSessions.where("workspaceId").equals(id).delete();
      await db.chatMessages.where("workspaceId").equals(id).delete();
      await db.chatThreads.where("workspaceId").equals(id).delete();
      await db.reviewLogs.where("workspaceId").equals(id).delete();
      await db.flashcards.where("workspaceId").equals(id).delete();
      await db.decks.where("workspaceId").equals(id).delete();
      await db.highlights.where("workspaceId").equals(id).delete();
      await db.chunks.where("workspaceId").equals(id).delete();
      await db.sources.where("workspaceId").equals(id).delete();
      await db.workspaces.delete(id);
    },
  );
}

export async function listWorkspaces(
  opts: { includeArchived?: boolean } = {},
): Promise<WorkspaceRecord[]> {
  const all = await db.workspaces.toArray();
  const filtered = opts.includeArchived
    ? all
    : all.filter((w) => w.archivedAt === null);
  return filtered.sort((a, b) => b.updatedAt - a.updatedAt);
}
