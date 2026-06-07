"use client";

import { useLiveQuery } from "dexie-react-hooks";
import {
  countDueFlashcards,
  countFlashcards,
  listDecksByWorkspace,
  listDueFlashcards,
  listFlashcardsByDeck,
  listFlashcardsByWorkspace,
  listReviewLogs,
} from "./flashcards";
import {
  countHighlights,
  listHighlightsBySource,
  listHighlightsByWorkspace,
} from "./highlights";
import {
  listMessages,
  listThreadsBySource,
  listThreadsByWorkspace,
} from "./chats";
import { listChunksByIds, listChunksBySource } from "./chunks";
import {
  listConceptsByWorkspace,
  listEdgesByWorkspace,
} from "./concepts";
import {
  countSources,
  getSource,
  listNoteSourcesByWorkspace,
  listSources,
} from "./sources";
import { getSourceBlob, hasSourceBlob } from "./source-blobs";
import { db } from "./schema";
import {
  getCurriculumItem,
  getLessonNote,
  listCurriculaByWorkspace,
  listCurriculumItems,
  listLessonNotesByItem,
  listLessonNotesByWorkspace,
  listStudyJournalEntries,
} from "./study";
import {
  countRoadmapProgress,
  getRoadmap,
  listCompleteRoadmapNodeIds,
  listRoadmapEdges,
  listRoadmapNodes,
  listRoadmapsByWorkspace,
} from "./roadmaps";
import {
  getPodcast,
  getPodcastBlob,
  listPodcastsByWorkspace,
} from "./podcasts";
import {
  getNote,
  listBacklinks,
  listNotesByWorkspace,
} from "./notes";
import { getNoteSourceByNoteId } from "./sources";
import { listFoldersByWorkspace } from "./note-folders";
import { aggregateTagCounts } from "@/lib/notes/tag-tree";
import { getWorkspace, listWorkspaces } from "./workspaces";
import { computeCostUsd } from "@/lib/ai/pricing";
import {
  buildDashboardActivity,
  type DashboardActivity,
} from "@/lib/dashboard/activity";
import { useCurrentTime } from "@/hooks/useCurrentTime";

export function useWorkspaces(includeArchived = false) {
  return useLiveQuery(
    () => listWorkspaces({ includeArchived }),
    [includeArchived],
    [],
  );
}

export function useWorkspace(id: string | undefined) {
  return useLiveQuery(
    () =>
      id
        ? getWorkspace(id).then((r) => r ?? null)
        : Promise.resolve(null),
    [id],
  );
}

export function useSources(workspaceId: string | undefined) {
  return useLiveQuery(
    () => (workspaceId ? listSources(workspaceId) : Promise.resolve([])),
    [workspaceId],
    [],
  );
}

export function useSourceBlob(id: string | undefined) {
  return useLiveQuery(
    () => (id ? getSourceBlob(id) : Promise.resolve(null)),
    [id],
  );
}

export function useHasSourceBlob(id: string | undefined) {
  return useLiveQuery(
    () => (id ? hasSourceBlob(id) : Promise.resolve(false)),
    [id],
    false,
  );
}

export function useSource(id: string | undefined) {
  return useLiveQuery(
    () =>
      id
        ? getSource(id).then((r) => r ?? null)
        : Promise.resolve(null),
    [id],
  );
}

export function useSourceCount(workspaceId: string | undefined) {
  return useLiveQuery(
    () => (workspaceId ? countSources(workspaceId) : Promise.resolve(0)),
    [workspaceId],
    0,
  );
}

export function useChunksBySource(sourceId: string | undefined) {
  return useLiveQuery(
    () => (sourceId ? listChunksBySource(sourceId) : Promise.resolve([])),
    [sourceId],
    [],
  );
}

export function useChunksByIds(ids: string[] | undefined) {
  // Stable dep key — `ids` array reference would re-fire every render.
  const key = ids ? ids.join(",") : "";
  return useLiveQuery(
    () => (ids && ids.length > 0 ? listChunksByIds(ids) : Promise.resolve([])),
    [key],
    [],
  );
}

export function useConceptsByWorkspace(workspaceId: string | undefined) {
  return useLiveQuery(
    () =>
      workspaceId
        ? listConceptsByWorkspace(workspaceId)
        : Promise.resolve([]),
    [workspaceId],
    [],
  );
}

export function useConceptEdgesByWorkspace(workspaceId: string | undefined) {
  return useLiveQuery(
    () =>
      workspaceId ? listEdgesByWorkspace(workspaceId) : Promise.resolve([]),
    [workspaceId],
    [],
  );
}

export function useCurriculaByWorkspace(workspaceId: string | undefined) {
  return useLiveQuery(
    () =>
      workspaceId
        ? listCurriculaByWorkspace(workspaceId)
        : Promise.resolve([]),
    [workspaceId],
    [],
  );
}

export function useCurriculumItems(curriculumId: string | undefined) {
  return useLiveQuery(
    () =>
      curriculumId
        ? listCurriculumItems(curriculumId)
        : Promise.resolve([]),
    [curriculumId],
    [],
  );
}

export function useCurriculumItem(id: string | undefined) {
  return useLiveQuery(
    () => (id ? getCurriculumItem(id) : Promise.resolve(undefined)),
    [id],
  );
}

export function useLessonNotesByWorkspace(workspaceId: string | undefined) {
  return useLiveQuery(
    () =>
      workspaceId
        ? listLessonNotesByWorkspace(workspaceId)
        : Promise.resolve([]),
    [workspaceId],
    [],
  );
}

export function useLessonNotesByItem(curriculumItemId: string | undefined) {
  return useLiveQuery(
    () =>
      curriculumItemId
        ? listLessonNotesByItem(curriculumItemId)
        : Promise.resolve([]),
    [curriculumItemId],
    [],
  );
}

export function useLessonNote(id: string | undefined) {
  return useLiveQuery(
    () => (id ? getLessonNote(id) : Promise.resolve(undefined)),
    [id],
  );
}

export function useStudyJournalEntries(workspaceId: string | undefined) {
  return useLiveQuery(
    () =>
      workspaceId
        ? listStudyJournalEntries(workspaceId)
        : Promise.resolve([]),
    [workspaceId],
    [],
  );
}

export function usePodcast(id: string | undefined) {
  return useLiveQuery(
    () => (id ? getPodcast(id) : Promise.resolve(null)),
    [id],
  );
}

export function usePodcastBlob(podcastId: string | undefined) {
  return useLiveQuery(
    () =>
      podcastId
        ? getPodcastBlob(podcastId)
        : Promise.resolve(null),
    [podcastId],
  );
}

export function usePodcastsByWorkspace(workspaceId: string | undefined) {
  return useLiveQuery(
    () =>
      workspaceId
        ? listPodcastsByWorkspace(workspaceId)
        : Promise.resolve([]),
    [workspaceId],
    [],
  );
}

export function useHighlightsBySource(sourceId: string | undefined) {
  return useLiveQuery(
    () => (sourceId ? listHighlightsBySource(sourceId) : Promise.resolve([])),
    [sourceId],
    [],
  );
}

export function useHighlightsByWorkspace(workspaceId: string | undefined) {
  return useLiveQuery(
    () =>
      workspaceId
        ? listHighlightsByWorkspace(workspaceId)
        : Promise.resolve([]),
    [workspaceId],
    [],
  );
}

export function useHighlightCount(workspaceId: string | undefined) {
  return useLiveQuery(
    () => (workspaceId ? countHighlights(workspaceId) : Promise.resolve(0)),
    [workspaceId],
    0,
  );
}

export function useDecks(workspaceId: string | undefined) {
  return useLiveQuery(
    () =>
      workspaceId ? listDecksByWorkspace(workspaceId) : Promise.resolve([]),
    [workspaceId],
    [],
  );
}

export function useFlashcardsByWorkspace(workspaceId: string | undefined) {
  return useLiveQuery(
    () =>
      workspaceId
        ? listFlashcardsByWorkspace(workspaceId)
        : Promise.resolve([]),
    [workspaceId],
    [],
  );
}

export function useFlashcardsByDeck(deckId: string | undefined) {
  return useLiveQuery(
    () => (deckId ? listFlashcardsByDeck(deckId) : Promise.resolve([])),
    [deckId],
    [],
  );
}

export function useDueFlashcards(
  workspaceId: string | undefined,
  limit = 50,
) {
  const now = useCurrentTime();
  return useLiveQuery(
    () =>
      workspaceId
        ? listDueFlashcards(workspaceId, now, limit)
        : Promise.resolve([]),
    [workspaceId, limit, now],
    [],
  );
}

export function useFlashcardCount(workspaceId: string | undefined) {
  return useLiveQuery(
    () => (workspaceId ? countFlashcards(workspaceId) : Promise.resolve(0)),
    [workspaceId],
    0,
  );
}

export function useDueFlashcardCount(workspaceId: string | undefined) {
  const now = useCurrentTime();
  return useLiveQuery(
    () =>
      workspaceId ? countDueFlashcards(workspaceId, now) : Promise.resolve(0),
    [workspaceId, now],
    0,
  );
}

export function useReviewLogs(flashcardId: string | undefined) {
  return useLiveQuery(
    () => (flashcardId ? listReviewLogs(flashcardId) : Promise.resolve([])),
    [flashcardId],
    [],
  );
}

export function useThreadsByWorkspace(workspaceId: string | undefined) {
  return useLiveQuery(
    () =>
      workspaceId
        ? listThreadsByWorkspace(workspaceId)
        : Promise.resolve([]),
    [workspaceId],
    [],
  );
}

export function useThreadsBySource(sourceId: string | undefined) {
  return useLiveQuery(
    () => (sourceId ? listThreadsBySource(sourceId) : Promise.resolve([])),
    [sourceId],
    [],
  );
}

export function useMessages(threadId: string | undefined) {
  return useLiveQuery(
    () => (threadId ? listMessages(threadId) : Promise.resolve([])),
    [threadId],
    [],
  );
}

// AI cost aggregation hooks. We sum across `chatMessages` (the only place
// usage is recorded — embeddings + tool calls deliberately roll up into the
// assistant turn that issued them) and recompute on every Dexie change so the
// chip in the topbar stays live without polling.
//
// Cost is *estimated* (computeCostUsd uses static price tables); the
// disclaimer in CostSection makes that explicit to the user.

export interface TotalCostResult {
  totalUsd: number;
  messageCount: number;
  loading: boolean;
}

export function useTotalCost(opts?: {
  since?: number | undefined;
}): TotalCostResult {
  const since = opts?.since ?? 0;
  const result = useLiveQuery(
    async () => {
      // `createdAt > 0` is satisfied by every record we've ever written;
      // using `.above(since)` lets us reuse the indexed range query for both
      // "today" (since = startOfDay) and "all time" (since = 0).
      const messages = await db.chatMessages
        .where("createdAt")
        .above(since)
        .toArray();
      let totalUsd = 0;
      let counted = 0;
      for (const m of messages) {
        if (!m.model) continue;
        const cost = computeCostUsd(m.model, {
          input_tokens: m.tokensIn,
          output_tokens: m.tokensOut,
          cache_read_input_tokens: m.cacheReadTokens,
          cache_creation_input_tokens: m.cacheCreationTokens,
        });
        if (cost > 0) {
          totalUsd += cost;
          counted += 1;
        }
      }
      return { totalUsd, messageCount: counted };
    },
    [since],
  );
  if (!result) return { totalUsd: 0, messageCount: 0, loading: true };
  return { ...result, loading: false };
}

export type CostByModel = Record<string, { usd: number; count: number }>;

export function useCostByModel(opts?: {
  since?: number | undefined;
}): CostByModel {
  const since = opts?.since ?? 0;
  const result = useLiveQuery(
    async () => {
      const messages = await db.chatMessages
        .where("createdAt")
        .above(since)
        .toArray();
      const byModel: CostByModel = {};
      for (const m of messages) {
        if (!m.model) continue;
        const cost = computeCostUsd(m.model, {
          input_tokens: m.tokensIn,
          output_tokens: m.tokensOut,
          cache_read_input_tokens: m.cacheReadTokens,
          cache_creation_input_tokens: m.cacheCreationTokens,
        });
        if (cost <= 0) continue;
        const bucket = byModel[m.model] ?? { usd: 0, count: 0 };
        bucket.usd += cost;
        bucket.count += 1;
        byModel[m.model] = bucket;
      }
      return byModel;
    },
    [since],
    {} as CostByModel,
  );
  return result;
}

import { computeStreakDays, computeStreakHeatmap } from "@/lib/srs/streak";

const STREAK_WINDOW_DAYS = 30;
const STREAK_WINDOW_MS = STREAK_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export type DashboardStats = {
  workspaceCount: number;
  sourceCount: number;
  flashcardCount: number;
  dueFlashcardCount: number;
  highlightCount: number;
  weeklyReviewCount: number;
  /** Consecutive local-midnight days with at least one review, walking back
   *  from now. 0 if today has no reviews. */
  streakDays: number;
  /** Per-day review counts for the trailing 30-day window. Index 0 = oldest,
   *  last = today. Used by the dashboard heatmap. */
  streakHeatmap: number[];
  loading: boolean;
};

// Aggregates global counts across every Dexie table for the dashboard.
// Each table is counted in its own live query so the panel re-renders as
// soon as any one number changes. The weekly window slides 7 days back
// from `Date.now()` — accuracy beats alignment to a calendar week since
// the dashboard refreshes live.
//
// `workspaceCount` excludes archived workspaces. We compute it from the
// listing fn (which already filters `archivedAt !== null`) instead of
// indexing on `archivedAt` directly — Dexie's `where('archivedAt')` would
// require a sentinel value, but our schema stores `null`.
export function useDashboardStats(): DashboardStats {
  const now = useCurrentTime();
  const workspaceCount = useLiveQuery(
    () => listWorkspaces({ includeArchived: false }).then((ws) => ws.length),
    [],
    -1,
  );
  const sourceCount = useLiveQuery(() => db.sources.count(), [], -1);
  const flashcardCount = useLiveQuery(() => db.flashcards.count(), [], -1);
  const dueFlashcardCount = useLiveQuery(
    () => db.flashcards.where("dueAt").belowOrEqual(now).count(),
    [now],
    -1,
  );
  const highlightCount = useLiveQuery(() => db.highlights.count(), [], -1);
  const weeklyReviewCount = useLiveQuery(
    () =>
      db.reviewLogs
        .where("reviewedAt")
        .above(now - 7 * 24 * 60 * 60 * 1000)
        .count(),
    [now],
    -1,
  );
  // Pull only the timestamp column for the trailing 30-day window so we don't
  // hydrate full review records to count buckets. Dexie's `each` walks the
  // index without materializing the rest of the row.
  const recentReviewTimestamps = useLiveQuery(async () => {
    const out: number[] = [];
    await db.reviewLogs
      .where("reviewedAt")
      .above(now - STREAK_WINDOW_MS)
      .each((row) => {
        out.push(row.reviewedAt);
      });
    return out;
  }, [now]);

  const values = [
    workspaceCount,
    sourceCount,
    flashcardCount,
    dueFlashcardCount,
    highlightCount,
    weeklyReviewCount,
    recentReviewTimestamps,
  ];
  const loading = values.some((v) => v === undefined || v === -1);
  const safe = (n: number | undefined): number =>
    n === undefined || n === -1 ? 0 : n;

  const timestamps = recentReviewTimestamps ?? [];
  const streakDays = computeStreakDays(timestamps);
  const streakHeatmap = computeStreakHeatmap(
    timestamps,
    now,
    STREAK_WINDOW_DAYS,
  );

  return {
    workspaceCount: safe(workspaceCount),
    sourceCount: safe(sourceCount),
    flashcardCount: safe(flashcardCount),
    dueFlashcardCount: safe(dueFlashcardCount),
    highlightCount: safe(highlightCount),
    weeklyReviewCount: safe(weeklyReviewCount),
    streakDays,
    streakHeatmap,
    loading,
  };
}

export function useDashboardActivity(): DashboardActivity & { loading: boolean } {
  const now = useCurrentTime();
  const activity = useLiveQuery(
    async () => {
      const [
        flashcards,
        reviewLogs,
        sources,
        highlights,
        chatMessages,
        quizSessions,
      ] = await Promise.all([
        db.flashcards.toArray(),
        db.reviewLogs.toArray(),
        db.sources.toArray(),
        db.highlights.toArray(),
        db.chatMessages.toArray(),
        db.quizSessions.toArray(),
      ]);

      return buildDashboardActivity(
        {
          flashcards,
          reviewLogs,
          sources,
          highlights,
          chatMessages,
          quizSessions,
        },
        now,
      );
    },
    [now],
  );

  return {
    today: activity?.today ?? [],
    recent: activity?.recent ?? [],
    loading: activity === undefined,
  };
}

// Phase 6.4 — Notes layer hooks. The tree component reads both tables in
// parallel; consumers can pull either (e.g. backlinks panel just needs notes).
export function useNotesByWorkspace(workspaceId: string | undefined) {
  return useLiveQuery(
    () => (workspaceId ? listNotesByWorkspace(workspaceId) : Promise.resolve([])),
    [workspaceId],
    [],
  );
}

export function useNoteFoldersByWorkspace(workspaceId: string | undefined) {
  return useLiveQuery(
    () => (workspaceId ? listFoldersByWorkspace(workspaceId) : Promise.resolve([])),
    [workspaceId],
    [],
  );
}

export function useNote(id: string | undefined) {
  // Phase 6.8.1 — Return `undefined` (not `null`) when `id` is absent so the
  // page's stale-URL guard, which only fires on `selectedNote === null`, can't
  // misinterpret the previously-resolved no-id value as a deleted-note signal
  // during the brief re-query window when `noteIdParam` flips undefined→newId.
  // `null` is still emitted when the id is valid but the row is gone — that's
  // the actual deleted-note path the guard exists to handle.
  return useLiveQuery(
    () => (id ? getNote(id).then((r) => r ?? null) : Promise.resolve(undefined)),
    [id],
  );
}

// Phase 6.9 — Notes-as-Source. Returns the linked SourceRecord for a note
// (created when the user first clicks "Embed as source") or `null` when no
// such row exists. Splits `undefined` (loading / no input) from `null`
// (resolved → no source) so the toolbar button can show a Skeleton state
// distinct from the "idle" CTA state. Live-query re-fires whenever the
// sources table mutates so re-syncs flip the button to `synced` instantly.
export function useNoteSource(noteId: string | undefined) {
  return useLiveQuery(
    () =>
      noteId
        ? getNoteSourceByNoteId(noteId).then((r) => r ?? null)
        : Promise.resolve(null),
    [noteId],
  );
}

// Phase 6.9.8 — workspace-wide note-source map keyed by noteId so the
// NoteTree can paint a Sparkles dot on each embedded row without firing one
// useLiveQuery per child. Returns an empty Map while loading (Dexie's
// useLiveQuery returns the previous value during deps changes — fall back
// to a fresh Map so consumers don't accidentally hold a stale reference).
// SourceRecord.noteId is nullable in the type system; the filter ensures
// the Map only contains entries with a defined noteId.
export function useNoteSourcesByWorkspace(
  workspaceId: string | undefined,
): Map<string, import("./types").SourceRecord> {
  const rows = useLiveQuery(
    () =>
      workspaceId
        ? listNoteSourcesByWorkspace(workspaceId)
        : Promise.resolve([]),
    [workspaceId],
    [] as import("./types").SourceRecord[],
  );
  // Build the Map outside useMemo so consumers always get a stable shape;
  // the underlying live-query array reference is what changes, not the Map
  // identity. Callers re-derive their per-row check from the Map by id.
  const map = new Map<string, import("./types").SourceRecord>();
  for (const s of rows ?? []) {
    if (s.noteId) map.set(s.noteId, s);
  }
  return map;
}

// Phase 6.5 — Backlinks panel hook. Returns every note in the workspace
// whose denormalised wikilinks array carries `targetTitle`. The repo
// sorts by `updatedAt` desc so the panel shows recently-touched references
// first. Re-runs whenever the title changes (e.g. on rename-sweep).
export function useBacklinks(
  workspaceId: string | undefined,
  targetTitle: string | undefined,
) {
  return useLiveQuery(
    () =>
      workspaceId && targetTitle && targetTitle.length > 0
        ? listBacklinks(workspaceId, targetTitle)
        : Promise.resolve([]),
    [workspaceId, targetTitle],
    [],
  );
}

// Phase 6.6 — Tag panel hook. Aggregates the denormalised `tags[]` field
// across every note in the workspace into a `Map<tag, noteCount>`. The
// raw `notes.where('workspaceId')` query is enough because the projection
// already happens inside `projectFromContent`; we just sum across rows.
// `useLiveQuery` re-fires whenever any note in the workspace mutates,
// keeping the sidebar count chips in sync without manual invalidation.
export function useTagsByWorkspace(workspaceId: string | undefined) {
  return useLiveQuery(
    async () => {
      if (!workspaceId) return new Map<string, number>();
      const rows = await listNotesByWorkspace(workspaceId);
      return aggregateTagCounts(rows);
    },
    [workspaceId],
    new Map<string, number>(),
  );
}

// Roadmap hooks. Mirror the Plan hooks' shape so consumers can swap one
// page for the other with minimal churn. Each hook returns the latest
// resolved value from Dexie and re-fires whenever the underlying table
// mutates. `useRoadmapProgress` is the live "N / M done" feed used by the
// roadmap card and the topbar progress chip.

export function useRoadmapsByWorkspace(workspaceId: string | undefined) {
  return useLiveQuery(
    () =>
      workspaceId
        ? listRoadmapsByWorkspace(workspaceId)
        : Promise.resolve([]),
    [workspaceId],
    [],
  );
}

export function useRoadmap(id: string | undefined) {
  return useLiveQuery(
    () =>
      id
        ? getRoadmap(id).then((r) => r ?? null)
        : Promise.resolve(null),
    [id],
  );
}

export function useRoadmapNodes(roadmapId: string | undefined) {
  return useLiveQuery(
    () =>
      roadmapId ? listRoadmapNodes(roadmapId) : Promise.resolve([]),
    [roadmapId],
    [],
  );
}

export function useRoadmapEdges(roadmapId: string | undefined) {
  return useLiveQuery(
    () =>
      roadmapId ? listRoadmapEdges(roadmapId) : Promise.resolve([]),
    [roadmapId],
    [],
  );
}

export function useRoadmapProgress(roadmapId: string | undefined) {
  return useLiveQuery(
    () =>
      roadmapId
        ? countRoadmapProgress(roadmapId)
        : Promise.resolve({ total: 0, done: 0 }),
    [roadmapId],
    { total: 0, done: 0 },
  );
}

// Node ids that count as complete (manual done OR linked deck fully learned),
// so the canvas dim/checkmark visual matches the activity-derived progress
// bar. Reacts to flashcard reviews because the query reads the flashcards
// table.
export function useRoadmapCompleteNodeIds(roadmapId: string | undefined) {
  return useLiveQuery(
    () =>
      roadmapId
        ? listCompleteRoadmapNodeIds(roadmapId)
        : Promise.resolve<string[]>([]),
    [roadmapId],
    [] as string[],
  );
}
