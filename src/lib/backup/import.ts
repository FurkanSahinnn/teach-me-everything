import { db } from "@/lib/db/schema";
import type {
  ChatMessageRecord,
  ChatThreadRecord,
  ChunkRecord,
  DeckRecord,
  FlashcardRecord,
  HighlightRecord,
  NoteFolderRecord,
  NoteRecord,
  ReviewLogRecord,
  SourceRecord,
  WorkspaceRecord,
} from "@/lib/db/types";
import type {
  ConceptEdgeRecord,
  ConceptRecord,
} from "@/lib/concepts/types";
import type { QuizItem, QuizSessionRecord } from "@/lib/quiz/types";
import type {
  CurriculumItemRecord,
  CurriculumRecord,
  LessonNoteRecord,
  StudyJournalEntryRecord,
  StudySourceRef,
} from "@/lib/study/types";
import type {
  PodcastRecord,
  PodcastSegment,
  PodcastSourceRef,
} from "@/lib/podcast/types";
import type {
  RoadmapEdgeRecord,
  RoadmapNodeRecord,
  RoadmapRecord,
} from "@/lib/roadmap/types";
import type { ArticleAnalysisRecord } from "@/lib/article-analysis/types";
import {
  BACKUP_SCHEMA_VERSION,
  computePayloadHash,
  type BackupPayload,
  type BackupV10,
  type ChunkBackupShape,
} from "./export";

export class BackupSchemaError extends Error {
  constructor(
    message: string,
    public readonly receivedVersion: number,
  ) {
    super(message);
    this.name = "BackupSchemaError";
  }
}

export class BackupIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupIntegrityError";
  }
}

export class BackupParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupParseError";
  }
}

export interface ImportPreview {
  workspaceCount: number;
  sourceCount: number;
  flashcardCount: number;
  conflictingWorkspaceIds: string[];
  schemaVersion: number;
}

export interface ImportResult {
  imported: number;
  remapped: number;
}

export interface ImportOptions {
  onConflict?: "remap" | "abort";
}

// ---- Type guards (zod-free, exactOptionalPropertyTypes-aware) ----

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isArr(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function assertBackupShape(value: unknown): asserts value is BackupPayload {
  if (!isObj(value)) {
    throw new BackupParseError("Backup root must be an object");
  }
  const required = [
    "schemaVersion",
    "exportedAt",
    "app",
    "workspaces",
    "sources",
    "chunks",
    "highlights",
    "decks",
    "flashcards",
    "reviewLogs",
    "chatThreads",
    "chatMessages",
    "integrity",
  ];
  for (const key of required) {
    if (!(key in value)) {
      throw new BackupParseError(`Missing required field: ${key}`);
    }
  }
  if (value.app !== "tme") {
    throw new BackupParseError(`Unknown app marker: ${String(value.app)}`);
  }
  if (!isStr(value.integrity)) {
    throw new BackupParseError("integrity must be a string");
  }
  for (const key of [
    "workspaces",
    "sources",
    "chunks",
    "highlights",
    "decks",
    "flashcards",
    "reviewLogs",
    "chatThreads",
    "chatMessages",
  ]) {
    if (!isArr((value as Record<string, unknown>)[key])) {
      throw new BackupParseError(`${key} must be an array`);
    }
  }
  if (value.schemaVersion === 3 || value.schemaVersion === 4) {
    for (const key of ["quizSessions", "concepts", "conceptEdges"]) {
      if (!isArr((value as Record<string, unknown>)[key])) {
        throw new BackupParseError(`${key} must be an array`);
      }
    }
  }
  if (
    value.schemaVersion === 4 ||
    value.schemaVersion === 5 ||
    value.schemaVersion === 6
  ) {
    for (const key of [
      "curricula",
      "curriculumItems",
      "lessonNotes",
      "studyJournalEntries",
    ]) {
      if (!isArr((value as Record<string, unknown>)[key])) {
        throw new BackupParseError(`${key} must be an array`);
      }
    }
  }
  if (value.schemaVersion === 5 || value.schemaVersion === 6) {
    if (!isArr((value as Record<string, unknown>)["podcasts"])) {
      throw new BackupParseError("podcasts must be an array");
    }
  }
  if (
    value.schemaVersion === 6 ||
    value.schemaVersion === 7 ||
    value.schemaVersion === 8
  ) {
    if (!isArr((value as Record<string, unknown>)["planBlocks"])) {
      throw new BackupParseError("planBlocks must be an array");
    }
  }
  if (value.schemaVersion === 8 || value.schemaVersion === 9) {
    for (const key of ["notes", "noteFolders"]) {
      if (!isArr((value as Record<string, unknown>)[key])) {
        throw new BackupParseError(`${key} must be an array`);
      }
    }
  }
}

// ---- base64 → Float32Array decode ----

function base64ToBytes(b64: string): Uint8Array {
  const binary =
    typeof atob === "function"
      ? atob(b64)
      : Buffer.from(b64, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeChunk(shape: ChunkBackupShape): ChunkRecord {
  const base: ChunkRecord = {
    id: shape.id,
    sourceId: shape.sourceId,
    workspaceId: shape.workspaceId,
    index: shape.index,
    text: shape.text,
    tokenCount: shape.tokenCount,
    page: shape.page,
    section: shape.section,
    headings: shape.headings,
    createdAt: shape.createdAt,
  };
  if (shape.embedding !== null) {
    const bytes = base64ToBytes(shape.embedding);
    // Copy into a fresh ArrayBuffer so the Float32Array owns aligned storage.
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    base.embedding = new Float32Array(ab);
  }
  if (shape.embeddingModel !== null) {
    base.embeddingModel = shape.embeddingModel;
  }
  return base;
}

// ---- Public API ----

async function readJson(file: File): Promise<unknown> {
  const text = await file.text();
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new BackupParseError(
      `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function verifyIntegrity(parsed: BackupPayload): Promise<void> {
  const { integrity, ...withoutIntegrity } = parsed;
  const computed = await computePayloadHash(withoutIntegrity);
  if (computed !== integrity) {
    throw new BackupIntegrityError(
      "Backup file failed integrity check (sha256 mismatch)",
    );
  }
}

function ensureSchemaVersion(version: number): void {
  // Every prior major must be enumerated explicitly so a version bump never
  // accidentally rejects a backup the user took two phases ago.
  if (![2, 3, 4, 5, 6, 7, 8, 9, BACKUP_SCHEMA_VERSION].includes(version)) {
    throw new BackupSchemaError(
      `Unsupported backup schemaVersion ${version} (expected 2, 3, 4, 5, 6, 7, 8, 9, or ${BACKUP_SCHEMA_VERSION})`,
      version,
    );
  }
}

function normalizeBackup(parsed: BackupPayload): BackupV10 {
  if (parsed.schemaVersion === BACKUP_SCHEMA_VERSION) {
    // Backfill the roadmap + analysis arrays for v10 backups produced before
    // those tables joined the backup payload (older exports omitted them).
    // Integrity is verified against the original payload, so this post-verify
    // backfill is safe.
    return {
      ...parsed,
      roadmaps: parsed.roadmaps ?? [],
      roadmapNodes: parsed.roadmapNodes ?? [],
      roadmapEdges: parsed.roadmapEdges ?? [],
      articleAnalyses: parsed.articleAnalyses ?? [],
    };
  }
  const { integrity: _integrity, ...rest } = parsed;
  void _integrity;
  const v3Fields =
    parsed.schemaVersion === 3 ||
    parsed.schemaVersion === 4 ||
    parsed.schemaVersion === 5 ||
    parsed.schemaVersion === 6 ||
    parsed.schemaVersion === 7 ||
    parsed.schemaVersion === 8 ||
    parsed.schemaVersion === 9
      ? {
          quizSessions: parsed.quizSessions,
          concepts: parsed.concepts,
          conceptEdges: parsed.conceptEdges,
        }
      : {
          quizSessions: [],
          concepts: [],
          conceptEdges: [],
        };
  const v4Fields =
    parsed.schemaVersion === 4 ||
    parsed.schemaVersion === 5 ||
    parsed.schemaVersion === 6 ||
    parsed.schemaVersion === 7 ||
    parsed.schemaVersion === 8 ||
    parsed.schemaVersion === 9
      ? {
          curricula: parsed.curricula,
          curriculumItems: parsed.curriculumItems,
          lessonNotes: parsed.lessonNotes,
          studyJournalEntries: parsed.studyJournalEntries,
        }
      : {
          curricula: [],
          curriculumItems: [],
          lessonNotes: [],
          studyJournalEntries: [],
        };
  const v5Fields =
    parsed.schemaVersion === 5 ||
    parsed.schemaVersion === 6 ||
    parsed.schemaVersion === 7 ||
    parsed.schemaVersion === 8 ||
    parsed.schemaVersion === 9
      ? { podcasts: parsed.podcasts }
      : { podcasts: [] };
  const v8Fields =
    parsed.schemaVersion === 8 || parsed.schemaVersion === 9
      ? { notes: parsed.notes, noteFolders: parsed.noteFolders }
      : { notes: [], noteFolders: [] };
  // Roadmap tables first shipped in v9, so a v9 backup carries them; older
  // v2-v8 payloads never had them and default to empty.
  const v9Fields: {
    roadmaps: BackupV10["roadmaps"];
    roadmapNodes: BackupV10["roadmapNodes"];
    roadmapEdges: BackupV10["roadmapEdges"];
  } =
    parsed.schemaVersion === 9
      ? {
          roadmaps: parsed.roadmaps,
          roadmapNodes: parsed.roadmapNodes,
          roadmapEdges: parsed.roadmapEdges,
        }
      : { roadmaps: [], roadmapNodes: [], roadmapEdges: [] };
  // `articleAnalyses` (v10) never existed in any legacy v2-v9 payload, so it
  // always defaults to empty here; a genuine v10 backup short-circuits above.
  const v10Fields: { articleAnalyses: BackupV10["articleAnalyses"] } = {
    articleAnalyses: [],
  };
  // v6/v7/v8 carried `planBlocks` (Plan feature). v9+ drops Plan entirely
  // (Roadmap supersedes it — docs/ROADMAP_FEATURE_SPEC.md). We strip the
  // field out of legacy payloads at restore time; the user explicitly
  // accepted that Plan data is not preserved during the Q&A 2026-05-25.
  const { planBlocks: _legacyPlanBlocks, notes: _legacyNotes, noteFolders: _legacyNoteFolders, ...restWithoutLegacy } = rest as Record<string, unknown>;
  void _legacyPlanBlocks;
  void _legacyNotes;
  void _legacyNoteFolders;
  return {
    ...(restWithoutLegacy as Omit<BackupV10, "schemaVersion" | "integrity" | "quizSessions" | "concepts" | "conceptEdges" | "curricula" | "curriculumItems" | "lessonNotes" | "studyJournalEntries" | "podcasts" | "notes" | "noteFolders" | "roadmaps" | "roadmapNodes" | "roadmapEdges" | "articleAnalyses">),
    schemaVersion: BACKUP_SCHEMA_VERSION,
    ...v3Fields,
    ...v4Fields,
    ...v5Fields,
    ...v8Fields,
    ...v9Fields,
    ...v10Fields,
    integrity: parsed.integrity,
  };
}

export async function previewImport(file: File): Promise<ImportPreview> {
  const parsed = await readJson(file);
  assertBackupShape(parsed);
  ensureSchemaVersion(parsed.schemaVersion);
  await verifyIntegrity(parsed);
  const backup = normalizeBackup(parsed);

  const incomingIds = new Set(backup.workspaces.map((w) => w.id));
  const existing = await db.workspaces.toArray();
  const existingIds = new Set(existing.map((w) => w.id));
  const conflictingWorkspaceIds = Array.from(incomingIds).filter((id) =>
    existingIds.has(id),
  );

  return {
    workspaceCount: backup.workspaces.length,
    sourceCount: backup.sources.length,
    flashcardCount: backup.flashcards.length,
    conflictingWorkspaceIds,
    schemaVersion: parsed.schemaVersion,
  };
}

function mintId(): string {
  // Browser + Node ≥19 both ship crypto.randomUUID. fake-indexeddb tests
  // run under Node, which provides it via webcrypto in the test setup.
  return crypto.randomUUID();
}

export async function importBackup(
  file: File,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const onConflict = opts.onConflict ?? "remap";
  const parsed = await readJson(file);
  assertBackupShape(parsed);
  ensureSchemaVersion(parsed.schemaVersion);
  await verifyIntegrity(parsed);
  const backup = normalizeBackup(parsed);

  // Build remap tables BEFORE we touch the DB so the transaction body stays
  // synchronous w.r.t. external work (matters for Dexie + fake-indexeddb).
  const existingWorkspaceIds = new Set(
    (await db.workspaces.toArray()).map((w) => w.id),
  );
  const workspaceRemap = new Map<string, string>();
  for (const w of backup.workspaces) {
    if (existingWorkspaceIds.has(w.id)) {
      if (onConflict === "abort") {
        throw new BackupParseError(
          `Workspace ID conflict: ${w.id} (abort requested)`,
        );
      }
      workspaceRemap.set(w.id, mintId());
    }
  }

  const remapsWholeWorkspace = (workspaceId: string): boolean =>
    workspaceRemap.has(workspaceId);

  const existingSourceIds = new Set((await db.sources.toArray()).map((s) => s.id));
  const sourceRemap = new Map<string, string>();
  for (const s of backup.sources) {
    if (remapsWholeWorkspace(s.workspaceId) || existingSourceIds.has(s.id)) {
      sourceRemap.set(s.id, mintId());
    }
  }

  const existingChunkIds = new Set((await db.chunks.toArray()).map((c) => c.id));
  const chunkRemap = new Map<string, string>();
  for (const c of backup.chunks) {
    if (remapsWholeWorkspace(c.workspaceId) || existingChunkIds.has(c.id)) {
      chunkRemap.set(c.id, mintId());
    }
  }

  const existingHighlightIds = new Set(
    (await db.highlights.toArray()).map((h) => h.id),
  );
  const highlightRemap = new Map<string, string>();
  for (const h of backup.highlights) {
    if (remapsWholeWorkspace(h.workspaceId) || existingHighlightIds.has(h.id)) {
      highlightRemap.set(h.id, mintId());
    }
  }

  const existingDeckIds = new Set((await db.decks.toArray()).map((d) => d.id));
  const deckRemap = new Map<string, string>();
  for (const d of backup.decks) {
    if (remapsWholeWorkspace(d.workspaceId) || existingDeckIds.has(d.id)) {
      deckRemap.set(d.id, mintId());
    }
  }

  const existingFlashcardIds = new Set(
    (await db.flashcards.toArray()).map((f) => f.id),
  );
  const flashcardRemap = new Map<string, string>();
  for (const f of backup.flashcards) {
    if (remapsWholeWorkspace(f.workspaceId) || existingFlashcardIds.has(f.id)) {
      flashcardRemap.set(f.id, mintId());
    }
  }

  const existingReviewLogIds = new Set(
    (await db.reviewLogs.toArray()).map((r) => r.id),
  );
  const reviewLogRemap = new Map<string, string>();
  for (const r of backup.reviewLogs) {
    if (remapsWholeWorkspace(r.workspaceId) || existingReviewLogIds.has(r.id)) {
      reviewLogRemap.set(r.id, mintId());
    }
  }

  const existingThreadIds = new Set(
    (await db.chatThreads.toArray()).map((t) => t.id),
  );
  const threadRemap = new Map<string, string>();
  for (const t of backup.chatThreads) {
    if (remapsWholeWorkspace(t.workspaceId) || existingThreadIds.has(t.id)) {
      threadRemap.set(t.id, mintId());
    }
  }

  const existingMessageIds = new Set(
    (await db.chatMessages.toArray()).map((m) => m.id),
  );
  const messageRemap = new Map<string, string>();
  for (const m of backup.chatMessages) {
    if (remapsWholeWorkspace(m.workspaceId) || existingMessageIds.has(m.id)) {
      messageRemap.set(m.id, mintId());
    }
  }

  const existingQuizSessionIds = new Set(
    (await db.quizSessions.toArray()).map((q) => q.id),
  );
  const quizSessionRemap = new Map<string, string>();
  for (const q of backup.quizSessions) {
    if (remapsWholeWorkspace(q.workspaceId) || existingQuizSessionIds.has(q.id)) {
      quizSessionRemap.set(q.id, mintId());
    }
  }

  const existingConceptIds = new Set(
    (await db.concepts.toArray()).map((c) => c.id),
  );
  const conceptRemap = new Map<string, string>();
  for (const c of backup.concepts) {
    if (remapsWholeWorkspace(c.workspaceId) || existingConceptIds.has(c.id)) {
      conceptRemap.set(c.id, mintId());
    }
  }

  const existingConceptEdgeIds = new Set(
    (await db.conceptEdges.toArray()).map((e) => e.id),
  );
  const conceptEdgeRemap = new Map<string, string>();
  for (const e of backup.conceptEdges) {
    if (remapsWholeWorkspace(e.workspaceId) || existingConceptEdgeIds.has(e.id)) {
      conceptEdgeRemap.set(e.id, mintId());
    }
  }

  const existingCurriculumIds = new Set(
    (await db.curricula.toArray()).map((c) => c.id),
  );
  const curriculumRemap = new Map<string, string>();
  for (const c of backup.curricula) {
    if (remapsWholeWorkspace(c.workspaceId) || existingCurriculumIds.has(c.id)) {
      curriculumRemap.set(c.id, mintId());
    }
  }

  const existingCurriculumItemIds = new Set(
    (await db.curriculumItems.toArray()).map((i) => i.id),
  );
  const curriculumItemRemap = new Map<string, string>();
  for (const item of backup.curriculumItems) {
    if (
      remapsWholeWorkspace(item.workspaceId) ||
      existingCurriculumItemIds.has(item.id)
    ) {
      curriculumItemRemap.set(item.id, mintId());
    }
  }

  const existingLessonNoteIds = new Set(
    (await db.lessonNotes.toArray()).map((note) => note.id),
  );
  const lessonNoteRemap = new Map<string, string>();
  for (const note of backup.lessonNotes) {
    if (
      remapsWholeWorkspace(note.workspaceId) ||
      existingLessonNoteIds.has(note.id)
    ) {
      lessonNoteRemap.set(note.id, mintId());
    }
  }

  const existingJournalIds = new Set(
    (await db.studyJournalEntries.toArray()).map((entry) => entry.id),
  );
  const journalRemap = new Map<string, string>();
  for (const entry of backup.studyJournalEntries) {
    if (
      remapsWholeWorkspace(entry.workspaceId) ||
      existingJournalIds.has(entry.id)
    ) {
      journalRemap.set(entry.id, mintId());
    }
  }

  const existingPodcastIds = new Set(
    (await db.podcasts.toArray()).map((p) => p.id),
  );
  const podcastRemap = new Map<string, string>();
  for (const p of backup.podcasts) {
    if (remapsWholeWorkspace(p.workspaceId) || existingPodcastIds.has(p.id)) {
      podcastRemap.set(p.id, mintId());
    }
  }

  const existingNoteFolderIds = new Set(
    (await db.noteFolders.toArray()).map((f) => f.id),
  );
  const noteFolderRemap = new Map<string, string>();
  for (const folder of backup.noteFolders) {
    if (
      remapsWholeWorkspace(folder.workspaceId) ||
      existingNoteFolderIds.has(folder.id)
    ) {
      noteFolderRemap.set(folder.id, mintId());
    }
  }

  const existingNoteIds = new Set(
    (await db.notes.toArray()).map((n) => n.id),
  );
  const noteRemap = new Map<string, string>();
  for (const note of backup.notes) {
    if (remapsWholeWorkspace(note.workspaceId) || existingNoteIds.has(note.id)) {
      noteRemap.set(note.id, mintId());
    }
  }

  const existingRoadmapIds = new Set(
    (await db.roadmaps.toArray()).map((r) => r.id),
  );
  const roadmapRemap = new Map<string, string>();
  for (const r of backup.roadmaps) {
    if (remapsWholeWorkspace(r.workspaceId) || existingRoadmapIds.has(r.id)) {
      roadmapRemap.set(r.id, mintId());
    }
  }

  // Nodes/edges key off `roadmapId`, not `workspaceId`, so they are remapped
  // when their parent roadmap was remapped (whole-workspace conflict or a
  // roadmap-id collision) or when their own id already exists locally.
  const existingRoadmapNodeIds = new Set(
    (await db.roadmapNodes.toArray()).map((n) => n.id),
  );
  const roadmapNodeRemap = new Map<string, string>();
  for (const n of backup.roadmapNodes) {
    if (roadmapRemap.has(n.roadmapId) || existingRoadmapNodeIds.has(n.id)) {
      roadmapNodeRemap.set(n.id, mintId());
    }
  }

  const existingRoadmapEdgeIds = new Set(
    (await db.roadmapEdges.toArray()).map((e) => e.id),
  );
  const roadmapEdgeRemap = new Map<string, string>();
  for (const e of backup.roadmapEdges) {
    if (roadmapRemap.has(e.roadmapId) || existingRoadmapEdgeIds.has(e.id)) {
      roadmapEdgeRemap.set(e.id, mintId());
    }
  }

  const existingAnalysisIds = new Set(
    (await db.articleAnalyses.toArray()).map((a) => a.id),
  );
  const analysisRemap = new Map<string, string>();
  for (const a of backup.articleAnalyses) {
    if (remapsWholeWorkspace(a.workspaceId) || existingAnalysisIds.has(a.id)) {
      analysisRemap.set(a.id, mintId());
    }
  }

  const remapWs = (id: string): string => workspaceRemap.get(id) ?? id;
  const remapSource = (id: string | undefined): string | undefined =>
    id === undefined ? undefined : (sourceRemap.get(id) ?? id);
  const remapSourceId = (id: string): string => sourceRemap.get(id) ?? id;
  const remapChunk = (id: string | undefined): string | undefined =>
    id === undefined ? undefined : (chunkRemap.get(id) ?? id);
  const remapChunkId = (id: string): string => chunkRemap.get(id) ?? id;
  const remapDeck = (id: string | undefined): string | undefined =>
    id === undefined ? undefined : (deckRemap.get(id) ?? id);
  const remapFlashcard = (id: string): string => flashcardRemap.get(id) ?? id;
  const remapThread = (id: string): string => threadRemap.get(id) ?? id;
  const remapConcept = (id: string): string => conceptRemap.get(id) ?? id;
  const remapCurriculum = (id: string): string => curriculumRemap.get(id) ?? id;
  const remapCurriculumItem = (id: string): string =>
    curriculumItemRemap.get(id) ?? id;
  const remapLessonNote = (id: string | undefined): string | undefined =>
    id === undefined ? undefined : (lessonNoteRemap.get(id) ?? id);
  const remapNoteFolder = (
    id: string | null,
  ): string | null => {
    if (id === null) return null;
    return noteFolderRemap.get(id) ?? id;
  };

  const remapSourceRefs = (refs: StudySourceRef[]): StudySourceRef[] =>
    refs.map((ref) => ({
      ...ref,
      sourceId: remapSourceId(ref.sourceId),
      ...(ref.chunkIds
        ? { chunkIds: ref.chunkIds.map((id) => remapChunkId(id)) }
        : {}),
    }));

  const remapPodcastSourceRefs = (
    refs: PodcastSourceRef[] | undefined,
  ): PodcastSourceRef[] | undefined => {
    if (!refs) return undefined;
    return refs.map((ref) => ({
      ...ref,
      sourceId: remapSourceId(ref.sourceId),
      ...(ref.chunkIds
        ? { chunkIds: ref.chunkIds.map((id) => remapChunkId(id)) }
        : {}),
    }));
  };

  const remapPodcastSegment = (segment: PodcastSegment): PodcastSegment => {
    const next: PodcastSegment = {
      speaker: segment.speaker,
      text: segment.text,
    };
    if (segment.startMs !== undefined) next.startMs = segment.startMs;
    if (segment.durationMs !== undefined) next.durationMs = segment.durationMs;
    const refs = remapPodcastSourceRefs(segment.sourceRefs);
    if (refs !== undefined) next.sourceRefs = refs;
    return next;
  };

  const remapQuizItem = (item: QuizItem): QuizItem => {
    if (item.sourceChunkId === undefined) return item;
    return { ...item, sourceChunkId: remapChunkId(item.sourceChunkId) };
  };
  const remapFlashcardCitations = (
    citations: FlashcardRecord["citations"],
  ): FlashcardRecord["citations"] =>
    citations?.map((citation) => ({
      ...citation,
      ...(citation.sourceId !== undefined
        ? { sourceId: remapSourceId(citation.sourceId) }
        : {}),
    }));
  const remapChatCitations = (
    citations: ChatMessageRecord["citations"],
  ): ChatMessageRecord["citations"] =>
    citations?.map((citation) => ({
      ...citation,
      ...(citation.sourceId !== undefined
        ? { sourceId: remapSourceId(citation.sourceId) }
        : {}),
      ...(citation.chunkId !== undefined
        ? { chunkId: remapChunkId(citation.chunkId) }
        : {}),
    }));
  const remapGeneratedFrom = (
    generatedFrom: FlashcardRecord["generatedFrom"],
  ): FlashcardRecord["generatedFrom"] => {
    if (!generatedFrom) return undefined;
    return {
      ...generatedFrom,
      ...(generatedFrom.chunkIds
        ? {
            chunkIds: generatedFrom.chunkIds.map(
              (id) => remapChunk(id) ?? id,
            ),
          }
        : {}),
    };
  };

  const workspaces: WorkspaceRecord[] = backup.workspaces.map((w) => ({
    ...w,
    id: remapWs(w.id),
  }));
  const sources: SourceRecord[] = backup.sources.map((s) => ({
    ...s,
    id: sourceRemap.get(s.id) ?? s.id,
    workspaceId: remapWs(s.workspaceId),
  }));
  const chunks: ChunkRecord[] = backup.chunks.map((c) => {
    const decoded = decodeChunk(c);
    return {
      ...decoded,
      id: chunkRemap.get(decoded.id) ?? decoded.id,
      sourceId: remapSource(decoded.sourceId) ?? decoded.sourceId,
      workspaceId: remapWs(decoded.workspaceId),
    };
  });
  const highlights: HighlightRecord[] = backup.highlights.map((h) => ({
    ...h,
    id: highlightRemap.get(h.id) ?? h.id,
    sourceId: remapSource(h.sourceId) ?? h.sourceId,
    chunkId: remapChunk(h.chunkId),
    workspaceId: remapWs(h.workspaceId),
  }));
  const decks: DeckRecord[] = backup.decks.map((d) => ({
    ...d,
    id: remapDeck(d.id) ?? d.id,
    workspaceId: remapWs(d.workspaceId),
  }));
  const flashcards: FlashcardRecord[] = backup.flashcards.map((f) => {
    const next: FlashcardRecord = {
      ...f,
      id: flashcardRemap.get(f.id) ?? f.id,
      workspaceId: remapWs(f.workspaceId),
      sourceId: remapSource(f.sourceId),
      chunkId: remapChunk(f.chunkId),
      citations: remapFlashcardCitations(f.citations),
      generatedFrom: remapGeneratedFrom(f.generatedFrom),
    };
    if (f.deckId !== undefined) {
      next.deckId = remapDeck(f.deckId);
    }
    return next;
  });
  const reviewLogs: ReviewLogRecord[] = backup.reviewLogs.map((r) => ({
    ...r,
    id: reviewLogRemap.get(r.id) ?? r.id,
    flashcardId: remapFlashcard(r.flashcardId),
    workspaceId: remapWs(r.workspaceId),
  }));
  const chatThreads: ChatThreadRecord[] = backup.chatThreads.map((t) => ({
    ...t,
    id: threadRemap.get(t.id) ?? t.id,
    workspaceId: remapWs(t.workspaceId),
    sourceId: remapSource(t.sourceId),
  }));
  const chatMessages: ChatMessageRecord[] = backup.chatMessages.map((m) => ({
    ...m,
    id: messageRemap.get(m.id) ?? m.id,
    threadId: remapThread(m.threadId),
    workspaceId: remapWs(m.workspaceId),
    citations: remapChatCitations(m.citations),
  }));
  const quizSessions: QuizSessionRecord[] = backup.quizSessions.map((q) => ({
    ...q,
    id: quizSessionRemap.get(q.id) ?? q.id,
    workspaceId: remapWs(q.workspaceId),
    sourceId: remapSource(q.sourceId),
    items: q.items.map(remapQuizItem),
  }));
  const concepts: ConceptRecord[] = backup.concepts.map((c) => ({
    ...c,
    id: conceptRemap.get(c.id) ?? c.id,
    workspaceId: remapWs(c.workspaceId),
    sourceIds: c.sourceIds.map((id) => remapSource(id) ?? id),
    chunkRefs: c.chunkRefs.map((id) => remapChunk(id) ?? id),
  }));
  const conceptEdges: ConceptEdgeRecord[] = backup.conceptEdges.map((e) => ({
    ...e,
    id: conceptEdgeRemap.get(e.id) ?? e.id,
    workspaceId: remapWs(e.workspaceId),
    fromId: remapConcept(e.fromId),
    toId: remapConcept(e.toId),
    evidenceChunkIds: e.evidenceChunkIds.map((id) => remapChunk(id) ?? id),
  }));
  const curricula: CurriculumRecord[] = backup.curricula.map((c) => ({
    ...c,
    id: remapCurriculum(c.id),
    workspaceId: remapWs(c.workspaceId),
    sourceIds: c.sourceIds.map(remapSourceId),
  }));
  const curriculumItems: CurriculumItemRecord[] = backup.curriculumItems.map(
    (item) => ({
      ...item,
      id: remapCurriculumItem(item.id),
      workspaceId: remapWs(item.workspaceId),
      curriculumId: remapCurriculum(item.curriculumId),
      parentId:
        item.parentId === undefined
          ? undefined
          : remapCurriculumItem(item.parentId),
      sourceRefs: remapSourceRefs(item.sourceRefs),
    }),
  );
  const lessonNotes: LessonNoteRecord[] = backup.lessonNotes.map((note) => ({
    ...note,
    id: lessonNoteRemap.get(note.id) ?? note.id,
    workspaceId: remapWs(note.workspaceId),
    curriculumItemId: remapCurriculumItem(note.curriculumItemId),
    sourceRefs: remapSourceRefs(note.sourceRefs),
  }));
  const studyJournalEntries: StudyJournalEntryRecord[] =
    backup.studyJournalEntries.map((entry) => ({
      ...entry,
      id: journalRemap.get(entry.id) ?? entry.id,
      workspaceId: remapWs(entry.workspaceId),
      lessonNoteId: remapLessonNote(entry.lessonNoteId),
      sourceId: remapSource(entry.sourceId),
      sourceRefs: remapSourceRefs(entry.sourceRefs),
    }));
  const podcasts: PodcastRecord[] = backup.podcasts.map((p) => ({
    ...p,
    id: podcastRemap.get(p.id) ?? p.id,
    workspaceId: remapWs(p.workspaceId),
    sourceIds: p.sourceIds.map(remapSourceId),
    segments: p.segments.map(remapPodcastSegment),
  }));
  const noteFolders: NoteFolderRecord[] = backup.noteFolders.map((f) => ({
    ...f,
    id: noteFolderRemap.get(f.id) ?? f.id,
    workspaceId: remapWs(f.workspaceId),
    parentId: remapNoteFolder(f.parentId),
  }));
  // Notes denormalise `wikilinks` and `tags`. The bracket targets are
  // user-typed strings (note titles, not ids) so they are NOT remapped —
  // a workspace conflict that remapped a note's id has no bearing on what
  // its outbound wikilinks point to. `path` is folder-derived; it will
  // diverge if the parent folder was remapped, but the next call to
  // updateNote() recomputes it from `folderId` + `title`, so we leave the
  // stored path alone here (read-only round-trip).
  const notes: NoteRecord[] = backup.notes.map((n) => ({
    ...n,
    id: noteRemap.get(n.id) ?? n.id,
    workspaceId: remapWs(n.workspaceId),
    folderId: remapNoteFolder(n.folderId),
  }));
  const remapRoadmap = (id: string): string => roadmapRemap.get(id) ?? id;
  const remapRoadmapNode = (id: string): string =>
    roadmapNodeRemap.get(id) ?? id;
  const roadmaps: RoadmapRecord[] = backup.roadmaps.map((r) => ({
    ...r,
    id: remapRoadmap(r.id),
    workspaceId: remapWs(r.workspaceId),
  }));
  const roadmapNodes: RoadmapNodeRecord[] = backup.roadmapNodes.map((n) => ({
    ...n,
    id: remapRoadmapNode(n.id),
    roadmapId: remapRoadmap(n.roadmapId),
    parentId: n.parentId === null ? null : remapRoadmapNode(n.parentId),
  }));
  const roadmapEdges: RoadmapEdgeRecord[] = backup.roadmapEdges.map((e) => ({
    ...e,
    id: roadmapEdgeRemap.get(e.id) ?? e.id,
    roadmapId: remapRoadmap(e.roadmapId),
    fromNodeId: remapRoadmapNode(e.fromNodeId),
    toNodeId: remapRoadmapNode(e.toNodeId),
  }));
  // An analysis binds to exactly one workspace + source. The structured
  // payload also embeds best-effort `chunkId` citations, but those are
  // re-resolved in code on the detail page (see article-analysis/types.ts),
  // so we leave the JSON blob alone and only remap the row-level FKs.
  const articleAnalyses: ArticleAnalysisRecord[] = backup.articleAnalyses.map(
    (a) => ({
      ...a,
      id: analysisRemap.get(a.id) ?? a.id,
      workspaceId: remapWs(a.workspaceId),
      sourceId: remapSourceId(a.sourceId),
    }),
  );
  // Plan blocks (legacy v6-v8 payloads) are intentionally discarded here:
  // Roadmap replaces Plan and the Dexie table itself is gone.
  await db.transaction(
    "rw",
    [
      db.workspaces,
      db.sources,
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
      db.notes,
      db.noteFolders,
      db.roadmaps,
      db.roadmapNodes,
      db.roadmapEdges,
      db.articleAnalyses,
    ],
    async () => {
      // bulkPut so re-importing your own backup over a clean DB is idempotent
      // for non-conflicting IDs; conflicts have already been remapped above.
      await db.workspaces.bulkPut(workspaces);
      await db.sources.bulkPut(sources);
      await db.chunks.bulkPut(chunks);
      await db.highlights.bulkPut(highlights);
      await db.decks.bulkPut(decks);
      await db.flashcards.bulkPut(flashcards);
      await db.reviewLogs.bulkPut(reviewLogs);
      await db.chatThreads.bulkPut(chatThreads);
      await db.chatMessages.bulkPut(chatMessages);
      await db.quizSessions.bulkPut(quizSessions);
      await db.concepts.bulkPut(concepts);
      await db.conceptEdges.bulkPut(conceptEdges);
      await db.curricula.bulkPut(curricula);
      await db.curriculumItems.bulkPut(curriculumItems);
      await db.lessonNotes.bulkPut(lessonNotes);
      await db.studyJournalEntries.bulkPut(studyJournalEntries);
      await db.podcasts.bulkPut(podcasts);
      await db.noteFolders.bulkPut(noteFolders);
      await db.notes.bulkPut(notes);
      await db.roadmaps.bulkPut(roadmaps);
      await db.roadmapNodes.bulkPut(roadmapNodes);
      await db.roadmapEdges.bulkPut(roadmapEdges);
      await db.articleAnalyses.bulkPut(articleAnalyses);
    },
  );

  const imported =
    workspaces.length +
    sources.length +
    chunks.length +
    highlights.length +
    decks.length +
    flashcards.length +
    reviewLogs.length +
    chatThreads.length +
    chatMessages.length +
    quizSessions.length +
    concepts.length +
    conceptEdges.length +
    curricula.length +
    curriculumItems.length +
    lessonNotes.length +
    studyJournalEntries.length +
    podcasts.length +
    noteFolders.length +
    notes.length +
    roadmaps.length +
    roadmapNodes.length +
    roadmapEdges.length +
    articleAnalyses.length;

  return {
    imported,
    remapped:
      workspaceRemap.size +
      sourceRemap.size +
      chunkRemap.size +
      highlightRemap.size +
      deckRemap.size +
      flashcardRemap.size +
      reviewLogRemap.size +
      threadRemap.size +
      messageRemap.size +
      quizSessionRemap.size +
      conceptRemap.size +
      conceptEdgeRemap.size +
      curriculumRemap.size +
      curriculumItemRemap.size +
      lessonNoteRemap.size +
      journalRemap.size +
      podcastRemap.size +
      noteFolderRemap.size +
      noteRemap.size +
      roadmapRemap.size +
      roadmapNodeRemap.size +
      roadmapEdgeRemap.size +
      analysisRemap.size,
  };
}
