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
// Phase 5 (Roadmap) — `PlanBlockRecord` type is gone but the BackupV6/V7/V8
// payload shapes still reference it for restore-compat. Inline a frozen
// historical shape so legacy backups can still parse without dragging the
// removed Plan code back into the live type tree.
type LegacyPlanBlockRecord = {
  id: string;
  workspaceId: string;
  startTs: number;
  durationMin: number;
  title: string;
  titleEn?: string | undefined;
  note?: string | undefined;
  noteEn?: string | undefined;
  kind: string;
  curriculumItemId?: string | undefined;
  sourceId?: string | undefined;
  status?: string | undefined;
  completedAt?: number | undefined;
  remindAtTs?: number | undefined;
  recurrenceRule?: string | undefined;
  createdAt: number;
  updatedAt: number;
};
import type {
  ConceptEdgeRecord,
  ConceptRecord,
} from "@/lib/concepts/types";
import type { QuizSessionRecord } from "@/lib/quiz/types";
import type {
  CurriculumItemRecord,
  CurriculumRecord,
  LessonNoteRecord,
  StudyJournalEntryRecord,
} from "@/lib/study/types";
import type { PodcastRecord } from "@/lib/podcast/types";
import type {
  RoadmapEdgeRecord,
  RoadmapNodeRecord,
  RoadmapRecord,
} from "@/lib/roadmap/types";

// On-disk shape for a chunk: Float32Array embeddings cannot be JSON-serialized,
// so we round-trip them through base64. `embedding === null` means no vector
// was present; `undefined` is normalised to `null` here so JSON keys are stable.
export type ChunkBackupShape = Omit<
  ChunkRecord,
  "embedding" | "embeddingModel"
> & {
  embedding: string | null;
  embeddingModel: string | null;
};

export interface BackupV2 {
  schemaVersion: 2;
  exportedAt: number;
  app: "tme";
  workspaces: WorkspaceRecord[];
  sources: SourceRecord[];
  chunks: ChunkBackupShape[];
  highlights: HighlightRecord[];
  decks: DeckRecord[];
  flashcards: FlashcardRecord[];
  reviewLogs: ReviewLogRecord[];
  chatThreads: ChatThreadRecord[];
  chatMessages: ChatMessageRecord[];
  integrity: string;
}

export interface BackupV3 {
  schemaVersion: 3;
  exportedAt: number;
  app: "tme";
  workspaces: WorkspaceRecord[];
  sources: SourceRecord[];
  chunks: ChunkBackupShape[];
  highlights: HighlightRecord[];
  decks: DeckRecord[];
  flashcards: FlashcardRecord[];
  reviewLogs: ReviewLogRecord[];
  chatThreads: ChatThreadRecord[];
  chatMessages: ChatMessageRecord[];
  quizSessions: QuizSessionRecord[];
  concepts: ConceptRecord[];
  conceptEdges: ConceptEdgeRecord[];
  integrity: string;
}

export interface BackupV4 {
  schemaVersion: 4;
  exportedAt: number;
  app: "tme";
  workspaces: WorkspaceRecord[];
  sources: SourceRecord[];
  chunks: ChunkBackupShape[];
  highlights: HighlightRecord[];
  decks: DeckRecord[];
  flashcards: FlashcardRecord[];
  reviewLogs: ReviewLogRecord[];
  chatThreads: ChatThreadRecord[];
  chatMessages: ChatMessageRecord[];
  quizSessions: QuizSessionRecord[];
  concepts: ConceptRecord[];
  conceptEdges: ConceptEdgeRecord[];
  curricula: CurriculumRecord[];
  curriculumItems: CurriculumItemRecord[];
  lessonNotes: LessonNoteRecord[];
  studyJournalEntries: StudyJournalEntryRecord[];
  integrity: string;
}

// v5 adds `podcasts` (Phase 5.B). Binary audio (`podcastBlobs`) is
// excluded — same contract as `sourceBlobs`: the metadata round-trips
// through backup, the heavy blob is regenerated on demand. Importing a
// pre-v5 backup yields `podcasts: []` (handled in `normalizeBackup`).
export interface BackupV5 {
  schemaVersion: 5;
  exportedAt: number;
  app: "tme";
  workspaces: WorkspaceRecord[];
  sources: SourceRecord[];
  chunks: ChunkBackupShape[];
  highlights: HighlightRecord[];
  decks: DeckRecord[];
  flashcards: FlashcardRecord[];
  reviewLogs: ReviewLogRecord[];
  chatThreads: ChatThreadRecord[];
  chatMessages: ChatMessageRecord[];
  quizSessions: QuizSessionRecord[];
  concepts: ConceptRecord[];
  conceptEdges: ConceptEdgeRecord[];
  curricula: CurriculumRecord[];
  curriculumItems: CurriculumItemRecord[];
  lessonNotes: LessonNoteRecord[];
  studyJournalEntries: StudyJournalEntryRecord[];
  podcasts: PodcastRecord[];
  integrity: string;
}

// v6 adds `planBlocks` (Phase 5.C). Previously the Plan page's blocks were
// orphaned at backup time — users lost their week grid on any restore. v6
// closes that hole. Importing a pre-v6 backup yields `planBlocks: []`.
export interface BackupV6 {
  schemaVersion: 6;
  exportedAt: number;
  app: "tme";
  workspaces: WorkspaceRecord[];
  sources: SourceRecord[];
  chunks: ChunkBackupShape[];
  highlights: HighlightRecord[];
  decks: DeckRecord[];
  flashcards: FlashcardRecord[];
  reviewLogs: ReviewLogRecord[];
  chatThreads: ChatThreadRecord[];
  chatMessages: ChatMessageRecord[];
  quizSessions: QuizSessionRecord[];
  concepts: ConceptRecord[];
  conceptEdges: ConceptEdgeRecord[];
  curricula: CurriculumRecord[];
  curriculumItems: CurriculumItemRecord[];
  lessonNotes: LessonNoteRecord[];
  studyJournalEntries: StudyJournalEntryRecord[];
  podcasts: PodcastRecord[];
  planBlocks: LegacyPlanBlockRecord[];
  integrity: string;
}

// v7 bumps the version so that messages carrying the new optional
// `webSearchUsed` / `webCitations` fields (Phase 5.5) round-trip through
// backup with an unambiguous schema marker. No top-level array changes:
// the new fields live inside `chatMessages[i]` and are already covered by
// the `ChatMessageRecord` type. Importing a pre-v7 backup is a no-op
// transform — the optional fields stay undefined on every restored row.
export interface BackupV7 {
  schemaVersion: 7;
  exportedAt: number;
  app: "tme";
  workspaces: WorkspaceRecord[];
  sources: SourceRecord[];
  chunks: ChunkBackupShape[];
  highlights: HighlightRecord[];
  decks: DeckRecord[];
  flashcards: FlashcardRecord[];
  reviewLogs: ReviewLogRecord[];
  chatThreads: ChatThreadRecord[];
  chatMessages: ChatMessageRecord[];
  quizSessions: QuizSessionRecord[];
  concepts: ConceptRecord[];
  conceptEdges: ConceptEdgeRecord[];
  curricula: CurriculumRecord[];
  curriculumItems: CurriculumItemRecord[];
  lessonNotes: LessonNoteRecord[];
  studyJournalEntries: StudyJournalEntryRecord[];
  podcasts: PodcastRecord[];
  planBlocks: LegacyPlanBlockRecord[];
  integrity: string;
}

// v8 adds `notes` + `noteFolders` (Phase 6.1 Notes Layer). Content is plain
// markdown so round-tripping is trivial — no binary, no base64 hop. Importing
// a pre-v8 backup yields `notes: []` and `noteFolders: []` (handled in
// `normalizeBackup`). The Tauri export path (Phase 7) will additionally
// drop each note to a real `.md` on disk, but here the metadata round-trip
// alone is enough to round-trip every web user's vault.
export interface BackupV8 {
  schemaVersion: 8;
  exportedAt: number;
  app: "tme";
  workspaces: WorkspaceRecord[];
  sources: SourceRecord[];
  chunks: ChunkBackupShape[];
  highlights: HighlightRecord[];
  decks: DeckRecord[];
  flashcards: FlashcardRecord[];
  reviewLogs: ReviewLogRecord[];
  chatThreads: ChatThreadRecord[];
  chatMessages: ChatMessageRecord[];
  quizSessions: QuizSessionRecord[];
  concepts: ConceptRecord[];
  conceptEdges: ConceptEdgeRecord[];
  curricula: CurriculumRecord[];
  curriculumItems: CurriculumItemRecord[];
  lessonNotes: LessonNoteRecord[];
  studyJournalEntries: StudyJournalEntryRecord[];
  podcasts: PodcastRecord[];
  planBlocks: LegacyPlanBlockRecord[];
  notes: NoteRecord[];
  noteFolders: NoteFolderRecord[];
  integrity: string;
}

// v9: Roadmap feature replaces Plan. `planBlocks` is dropped from the live
// payload — the Dexie table itself is gone (schema v28). The three Roadmap
// tables (roadmaps / roadmapNodes / roadmapEdges, schema v27) are added here
// so AI-generated roadmaps + per-node done status round-trip through backup;
// previously they were silently lost on export/import. Legacy backups
// (v6-v8) still parse via the historical shapes above; the import step
// discards their `planBlocks` array and defaults the roadmap arrays to `[]`.
export interface BackupV9 {
  schemaVersion: 9;
  exportedAt: number;
  app: "tme";
  workspaces: WorkspaceRecord[];
  sources: SourceRecord[];
  chunks: ChunkBackupShape[];
  highlights: HighlightRecord[];
  decks: DeckRecord[];
  flashcards: FlashcardRecord[];
  reviewLogs: ReviewLogRecord[];
  chatThreads: ChatThreadRecord[];
  chatMessages: ChatMessageRecord[];
  quizSessions: QuizSessionRecord[];
  concepts: ConceptRecord[];
  conceptEdges: ConceptEdgeRecord[];
  curricula: CurriculumRecord[];
  curriculumItems: CurriculumItemRecord[];
  lessonNotes: LessonNoteRecord[];
  studyJournalEntries: StudyJournalEntryRecord[];
  podcasts: PodcastRecord[];
  notes: NoteRecord[];
  noteFolders: NoteFolderRecord[];
  roadmaps: RoadmapRecord[];
  roadmapNodes: RoadmapNodeRecord[];
  roadmapEdges: RoadmapEdgeRecord[];
  integrity: string;
}

export type BackupPayload =
  | BackupV2
  | BackupV3
  | BackupV4
  | BackupV5
  | BackupV6
  | BackupV7
  | BackupV8
  | BackupV9;

export const BACKUP_SCHEMA_VERSION = 9 as const;

// SECURITY: the `apiKeys` table is deliberately NEVER written to a backup.
// Exporting credentials off-device would break the BYOK contract — even on
// the dev-only web path where the values are plaintext, and especially on
// Tauri where they live in the OS keychain (not Dexie). The same rule
// applies to `sourceBlobs` and `podcastBlobs` for a different reason: they
// are heavy binary that inflates backup size and can always be regenerated
// from upstream. The pre-Phase-9 `vault` table no longer exists.

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked to avoid stack overflow on very large embeddings via spread.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode(...Array.from(slice));
  }
  if (typeof btoa === "function") return btoa(binary);
  // Node fallback for environments without atob/btoa (e.g. older test runners).
  return Buffer.from(binary, "binary").toString("base64");
}

function chunkToBackupShape(chunk: ChunkRecord): ChunkBackupShape {
  const emb = chunk.embedding;
  const embedding =
    emb && emb.byteLength > 0
      ? bytesToBase64(
          new Uint8Array(emb.buffer, emb.byteOffset, emb.byteLength),
        )
      : null;
  return {
    id: chunk.id,
    sourceId: chunk.sourceId,
    workspaceId: chunk.workspaceId,
    index: chunk.index,
    text: chunk.text,
    tokenCount: chunk.tokenCount,
    page: chunk.page,
    section: chunk.section,
    headings: chunk.headings,
    createdAt: chunk.createdAt,
    embedding,
    embeddingModel: chunk.embeddingModel ?? null,
  };
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i] ?? 0;
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

export async function exportBackup(): Promise<Blob> {
  const [
    workspaces,
    sources,
    rawChunks,
    highlights,
    decks,
    flashcards,
    reviewLogs,
    chatThreads,
    chatMessages,
    quizSessions,
    concepts,
    conceptEdges,
    curricula,
    curriculumItems,
    lessonNotes,
    studyJournalEntries,
    podcasts,
    notes,
    noteFolders,
    roadmaps,
    roadmapNodes,
    roadmapEdges,
  ] = await Promise.all([
    db.workspaces.toArray(),
    db.sources.toArray(),
    db.chunks.toArray(),
    db.highlights.toArray(),
    db.decks.toArray(),
    db.flashcards.toArray(),
    db.reviewLogs.toArray(),
    db.chatThreads.toArray(),
    db.chatMessages.toArray(),
    db.quizSessions.toArray(),
    db.concepts.toArray(),
    db.conceptEdges.toArray(),
    db.curricula.toArray(),
    db.curriculumItems.toArray(),
    db.lessonNotes.toArray(),
    db.studyJournalEntries.toArray(),
    db.podcasts.toArray(),
    db.notes.toArray(),
    db.noteFolders.toArray(),
    db.roadmaps.toArray(),
    db.roadmapNodes.toArray(),
    db.roadmapEdges.toArray(),
  ]);

  const chunks = rawChunks.map(chunkToBackupShape);

  const payload: Omit<BackupV9, "integrity"> = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: Date.now(),
    app: "tme",
    workspaces,
    sources,
    chunks,
    highlights,
    decks,
    flashcards,
    reviewLogs,
    chatThreads,
    chatMessages,
    quizSessions,
    concepts,
    conceptEdges,
    curricula,
    curriculumItems,
    lessonNotes,
    studyJournalEntries,
    podcasts,
    notes,
    noteFolders,
    roadmaps,
    roadmapNodes,
    roadmapEdges,
  };

  const json = JSON.stringify(payload);
  const integrity = await sha256Hex(json);

  const final: BackupV9 = { ...payload, integrity };
  const finalJson = JSON.stringify(final);

  return new Blob([finalJson], { type: "application/json" });
}

export function defaultBackupFilename(now: Date = new Date()): string {
  const yyyy = now.getFullYear().toString().padStart(4, "0");
  const mm = (now.getMonth() + 1).toString().padStart(2, "0");
  const dd = now.getDate().toString().padStart(2, "0");
  return `tme-backup-${yyyy}-${mm}-${dd}.tmebak`;
}

// Internal helper exported for the import module — keeps the integrity check
// algorithm in one place so the two halves cannot drift apart.
export async function computePayloadHash(
  payload: Omit<BackupPayload, "integrity">,
): Promise<string> {
  return sha256Hex(JSON.stringify(payload));
}
