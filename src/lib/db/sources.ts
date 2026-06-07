import { newId } from "@/lib/utils/id";
import { db } from "./schema";
import type {
  EmbeddingStatus,
  IngestStatus,
  SourceRecord,
  SourceType,
} from "./types";

export type SourceInput = {
  id?: string;
  workspaceId: string;
  type: SourceType;
  title: string;
  titleEn?: string;
  author?: string;
  url?: string;
  contentHash?: string;
  byteSize?: number;
  pageCount?: number;
  meta?: Record<string, unknown>;
  ingestStatus?: IngestStatus;
  embeddingStatus?: EmbeddingStatus;
  embeddingProvider?: string;
  embeddingModel?: string;
  // Phase 6.9 — Notes-as-Source. Populated only for `type === "note"`
  // sources; the linked note id is preserved on every read so the editor
  // toolbar button can derive its sync state without a secondary lookup.
  noteId?: string;
};

export type SourcePatch = Partial<
  Omit<SourceInput, "id" | "workspaceId" | "type">
>;

export async function createSource(input: SourceInput): Promise<SourceRecord> {
  const now = Date.now();
  const record: SourceRecord = {
    id: input.id ?? newId("src"),
    workspaceId: input.workspaceId,
    type: input.type,
    title: input.title,
    titleEn: input.titleEn,
    author: input.author,
    url: input.url,
    contentHash: input.contentHash,
    byteSize: input.byteSize,
    pageCount: input.pageCount,
    meta: input.meta,
    ingestStatus: input.ingestStatus ?? "pending",
    embeddingStatus: input.embeddingStatus ?? "missing",
    embeddingProvider: input.embeddingProvider,
    embeddingModel: input.embeddingModel,
    noteId: input.noteId,
    createdAt: now,
    updatedAt: now,
  };
  await db.sources.add(record);
  return record;
}

export async function getSource(
  id: string,
): Promise<SourceRecord | undefined> {
  return db.sources.get(id);
}

export async function updateSource(
  id: string,
  patch: SourcePatch,
): Promise<void> {
  await db.sources.update(id, { ...patch, updatedAt: Date.now() });
}

export async function setIngestStatus(
  id: string,
  status: IngestStatus,
  errorMessage?: string,
): Promise<void> {
  const patch: Partial<SourceRecord> = {
    ingestStatus: status,
    updatedAt: Date.now(),
  };
  if (status === "error") patch.errorMessage = errorMessage ?? "Unknown error";
  if (status === "ready") patch.errorMessage = undefined;
  await db.sources.update(id, patch);
}

export async function setEmbeddingStatus(
  id: string,
  status: EmbeddingStatus,
  opts?: {
    errorMessage?: string;
    provider?: string;
    model?: string;
  },
): Promise<void> {
  const patch: Partial<SourceRecord> = {
    embeddingStatus: status,
    updatedAt: Date.now(),
  };
  if (opts?.provider !== undefined) patch.embeddingProvider = opts.provider;
  if (opts?.model !== undefined) patch.embeddingModel = opts.model;
  if (status === "error") {
    patch.embeddingError = opts?.errorMessage ?? "Unknown embedding error";
  }
  if (status === "ready" || status === "embedding" || status === "queued") {
    patch.embeddingError = undefined;
  }
  await db.sources.update(id, patch);
}

export async function deleteSource(id: string): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.sources,
      db.chunks,
      db.highlights,
      db.flashcards,
      db.chatThreads,
      db.chatMessages,
      db.quizSessions,
      db.concepts,
      db.conceptEdges,
      db.sourceBlobs,
    ],
    async () => {
      const chunks = await db.chunks.where("sourceId").equals(id).toArray();
      const chunkIds = new Set(chunks.map((c) => c.id));
      const threads = await db.chatThreads
        .where("sourceId")
        .equals(id)
        .toArray();
      const threadIds = threads.map((t) => t.id);
      if (threadIds.length > 0) {
        await db.chatMessages.where("threadId").anyOf(threadIds).delete();
      }
      await db.chatThreads.where("sourceId").equals(id).delete();
      await db.quizSessions.where("sourceId").equals(id).delete();
      await db.flashcards
        .where("sourceId")
        .equals(id)
        .modify({ sourceId: undefined, chunkId: undefined });
      const concepts = await db.concepts.toArray();
      const deletedConceptIds = new Set<string>();
      for (const concept of concepts) {
        if (!concept.sourceIds.includes(id)) continue;
        const nextSourceIds = concept.sourceIds.filter((sid) => sid !== id);
        const nextChunkRefs = concept.chunkRefs.filter(
          (chunkId) => !chunkIds.has(chunkId),
        );
        if (nextSourceIds.length === 0) {
          deletedConceptIds.add(concept.id);
          await db.concepts.delete(concept.id);
        } else {
          await db.concepts.update(concept.id, {
            sourceIds: nextSourceIds,
            chunkRefs: nextChunkRefs,
            updatedAt: Date.now(),
          });
        }
      }
      await db.conceptEdges
        .filter((edge) => {
          if (deletedConceptIds.has(edge.fromId)) return true;
          if (deletedConceptIds.has(edge.toId)) return true;
          return (
            edge.evidenceChunkIds.length > 0 &&
            edge.evidenceChunkIds.every((chunkId) => chunkIds.has(chunkId))
          );
        })
        .delete();
      if (chunkIds.size > 0) {
        await db.conceptEdges.toCollection().modify((edge) => {
          edge.evidenceChunkIds = edge.evidenceChunkIds.filter(
            (chunkId) => !chunkIds.has(chunkId),
          );
        });
      }
      await db.highlights.where("sourceId").equals(id).delete();
      await db.chunks.where("sourceId").equals(id).delete();
      await db.sourceBlobs.delete(id);
      await db.sources.delete(id);
    },
  );
}

export async function listSources(
  workspaceId: string,
): Promise<SourceRecord[]> {
  const items = await db.sources
    .where("workspaceId")
    .equals(workspaceId)
    .toArray();
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Phase 6.9.8 — workspace-scoped slice of sources whose `type === "note"`.
 * Used by the NoteTree sidebar to render a Sparkles dot on rows that have an
 * embedded counterpart. Linear filter against `listSources(...)` is fine —
 * note-sources are a tiny subset and the table already lives in memory
 * thanks to Dexie's IndexedDB cache.
 */
export async function listNoteSourcesByWorkspace(
  workspaceId: string,
): Promise<SourceRecord[]> {
  const all = await listSources(workspaceId);
  return all.filter((s) => s.type === "note");
}

export async function findSourceByHash(
  workspaceId: string,
  contentHash: string,
): Promise<SourceRecord | undefined> {
  return db.sources
    .where("contentHash")
    .equals(contentHash)
    .and((s) => s.workspaceId === workspaceId)
    .first();
}

/**
 * Look up a source by canonical URL within a workspace. Used by the
 * research ingest pipeline to short-circuit re-ingesting an URL the user
 * has already added (e.g. clicking "Add selected as sources" twice in a
 * row). The schema has no `[workspaceId+url]` compound index — workspace
 * fanout is small (tens of sources typical), so a linear filter on the
 * workspace-scoped slice is fine.
 */
export async function findSourceByUrl(
  workspaceId: string,
  url: string,
): Promise<SourceRecord | undefined> {
  return db.sources
    .where("workspaceId")
    .equals(workspaceId)
    .and((s) => s.url === url)
    .first();
}

export async function countSources(workspaceId: string): Promise<number> {
  return db.sources.where("workspaceId").equals(workspaceId).count();
}

export async function countSourcesNeedingEmbedding(
  workspaceId?: string,
): Promise<number> {
  const rows =
    workspaceId === undefined
      ? await db.sources.toArray()
      : await db.sources.where("workspaceId").equals(workspaceId).toArray();
  return rows.filter(
    (s) =>
      s.ingestStatus === "ready" &&
      (s.embeddingStatus === undefined ||
        s.embeddingStatus === "missing" ||
        s.embeddingStatus === "skipped" ||
        s.embeddingStatus === "error"),
  ).length;
}

// ─── Phase 6.9 — Notes-as-Source ────────────────────────────────────────────
//
// A user-authored markdown note (Phase 6 vault) can opt into the embedding
// pipeline via the editor toolbar's "Embed as source" button. The note stays
// editable in the CM6 vault; the linked SourceRecord lives in parallel and
// owns the chunks/embeddings half of the relationship.
//
// State machine (driven by `lastEmbeddedContentHash` vs the current note's
// sha256): idle (no source) → embedding → synced ⇄ dirty. The two `mark*`
// helpers update only the bookkeeping fields, leaving content + chunks to
// the embed worker (Phase 6.9.2). `getNoteSourceByNoteId` answers the live
// query that drives the button's visible state.

export type CreateNoteSourceInput = {
  noteId: string;
  workspaceId: string;
  // Override the title pulled from the linked note. Used by tests; production
  // callers pass the note id and let the helper read the current title.
  title?: string;
};

/**
 * Create a `type: "note"` SourceRecord linked back to the given noteId. The
 * note's current title is copied at creation time (and kept in sync by
 * `renameNoteTitleWithSweep`). `ingestStatus` is set to `"ready"` because
 * markdown notes need no parse/chunk pass before embedding; the embedding
 * pipeline picks them up via the standard `embeddingStatus: "missing"`
 * signal — see `embedNoteAsSource` (6.9.2) for the actual chunk + embed run.
 *
 * Throws if the note row is missing. Callers that need an idempotent
 * lookup-or-create should pair this with `getNoteSourceByNoteId` first.
 */
export async function createNoteSource(
  input: CreateNoteSourceInput,
): Promise<SourceRecord> {
  const note = await db.notes.get(input.noteId);
  if (!note) {
    throw new Error(`createNoteSource: note ${input.noteId} not found`);
  }
  const title =
    input.title?.trim() ||
    note.title.trim() ||
    "Untitled";
  return createSource({
    workspaceId: input.workspaceId,
    type: "note",
    title,
    noteId: input.noteId,
    ingestStatus: "ready",
    embeddingStatus: "missing",
  });
}

/**
 * Look up the SourceRecord (if any) linked to the given noteId. Uses the
 * v23 `noteId` index so the query is a single-row equality lookup. Returns
 * undefined when the note has never been embedded.
 */
export async function getNoteSourceByNoteId(
  noteId: string,
): Promise<SourceRecord | undefined> {
  return db.sources.where("noteId").equals(noteId).first();
}

/**
 * Force a note-source into the `dirty` state by clearing its
 * `lastEmbeddedContentHash`. The toolbar button will flip to ⚠ Sync on the
 * next live-query tick. Used after an explicit "Resync" action or when the
 * embed worker detects mid-stream corruption.
 */
export async function markNoteSourceDirty(sourceId: string): Promise<void> {
  await db.sources.update(sourceId, {
    lastEmbeddedContentHash: undefined,
    updatedAt: Date.now(),
  });
}

/**
 * Record a successful embed against a note-source. `hash` is the sha256 of
 * the note content that was embedded (paired with chunk content hashes for
 * per-chunk diff reuse). The button flips back to ✓ Embedded once the live
 * query observes the matching hash.
 */
export async function markNoteSourceSynced(
  sourceId: string,
  hash: string,
): Promise<void> {
  const now = Date.now();
  await db.sources.update(sourceId, {
    lastEmbeddedContentHash: hash,
    lastEmbeddedAt: now,
    embeddingStatus: "ready",
    updatedAt: now,
  });
}
