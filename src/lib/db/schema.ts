import Dexie, { type Table } from "dexie";
import type {
  ChatMessageRecord,
  ChatThreadRecord,
  ChunkRecord,
  DeckRecord,
  FlashcardRecord,
  HighlightRecord,
  ReviewLogRecord,
  SeedFlagRecord,
  SourceBlobRecord,
  SourceRecord,
  WorkspaceRecord,
} from "./types";
import type { QuizSessionRecord } from "@/lib/quiz/types";
import type {
  ConceptEdgeRecord,
  ConceptRecord,
} from "@/lib/concepts/types";
import type {
  CurriculumItemRecord,
  CurriculumRecord,
  LessonNoteRecord,
  StudyJournalEntryRecord,
} from "@/lib/study/types";
import type {
  PodcastBlobRecord,
  PodcastRecord,
} from "@/lib/podcast/types";
import type { NoteFolderRecord, NoteRecord } from "./types";
import type {
  ModelDescriptor,
  ProviderId,
} from "@/lib/ai/providers/types";
import type {
  RoadmapEdgeRecord,
  RoadmapNodeRecord,
  RoadmapRecord,
} from "@/lib/roadmap/types";

// Mirrors providers/types.ts CloudProviderId order; embed-only and non-AI
// services are appended so the same table holds every key kind users may add.
export type ApiKeyProvider =
  | "claude-code-oauth"
  | "anthropic"
  | "openai"
  | "google-gemini"
  | "openrouter"
  | "groq"
  | "deepseek"
  | "glm"
  | "xai"
  | "mistral"
  | "together"
  | "cerebras"
  | "perplexity"
  | "voyage"
  | "cohere"
  | "jina"
  | "huggingface"
  | "firecrawl"
  | "exa"
  | "tavily"
  | "diffbot"
  | "brightdata"
  | "brave"
  | "ollama"
  | "lm-studio"
  | "llama-cpp"
  | `custom:${string}`;

export type Provider = ApiKeyProvider;

// Phase 9 — Stores the API key as plaintext on web (dev-only) and is the
// shape returned by the Tauri keychain proxy (Tauri ignores this table at
// runtime). Pre-Phase-9 rows carried `{ciphertext, iv, recoveryCiphertext?,
// recoveryIv?}`; the v23 upgrade clears the table because those rows are
// no longer decryptable without the deleted master-password flow.
export type ApiKeyRecord = {
  provider: ApiKeyProvider;
  plaintext: string;
  updatedAt: number;
};

// Phase 10.B — Cached provider /models catalog so the Settings picker can
// surface the *real* set of chat models the user can hit with their BYOK
// key. `baseUrl` is captured at fetch time so a later custom-endpoint
// override invalidates the cache automatically (different URL → cache
// miss). `models` is the already-filtered + tier-inferred list ready for
// the dropdown; the hook tier-rebuilds nothing at read time.
export type ProviderModelsCacheRecord = {
  presetId: ProviderId;
  baseUrl: string;
  models: ModelDescriptor[];
  fetchedAt: number;
};

export class TmeDb extends Dexie {
  apiKeys!: Table<ApiKeyRecord, ApiKeyProvider>;
  workspaces!: Table<WorkspaceRecord, string>;
  sources!: Table<SourceRecord, string>;
  chunks!: Table<ChunkRecord, string>;
  highlights!: Table<HighlightRecord, string>;
  decks!: Table<DeckRecord, string>;
  flashcards!: Table<FlashcardRecord, string>;
  reviewLogs!: Table<ReviewLogRecord, string>;
  chatThreads!: Table<ChatThreadRecord, string>;
  chatMessages!: Table<ChatMessageRecord, string>;
  quizSessions!: Table<QuizSessionRecord, string>;
  concepts!: Table<ConceptRecord, string>;
  conceptEdges!: Table<ConceptEdgeRecord, string>;
  curricula!: Table<CurriculumRecord, string>;
  curriculumItems!: Table<CurriculumItemRecord, string>;
  lessonNotes!: Table<LessonNoteRecord, string>;
  studyJournalEntries!: Table<StudyJournalEntryRecord, string>;
  sourceBlobs!: Table<SourceBlobRecord, string>;
  podcasts!: Table<PodcastRecord, string>;
  podcastBlobs!: Table<PodcastBlobRecord, string>;
  notes!: Table<NoteRecord, string>;
  noteFolders!: Table<NoteFolderRecord, string>;
  providerModelsCache!: Table<ProviderModelsCacheRecord, ProviderId>;
  roadmaps!: Table<RoadmapRecord, string>;
  roadmapNodes!: Table<RoadmapNodeRecord, string>;
  roadmapEdges!: Table<RoadmapEdgeRecord, string>;
  seedFlags!: Table<SeedFlagRecord, string>;

  constructor() {
    super("tme");

    this.version(1).stores({
      apiKeys: "provider, updatedAt",
      vault: "id",
    });

    this.version(2).stores({
      apiKeys: "provider, updatedAt",
      vault: "id",
      workspaces: "id, updatedAt, archivedAt",
      sources:
        "id, workspaceId, ingestStatus, contentHash, [workspaceId+createdAt], [workspaceId+updatedAt]",
      chunks: "id, sourceId, workspaceId, [sourceId+index]",
      highlights: "id, sourceId, chunkId, workspaceId, [sourceId+createdAt]",
      decks: "id, workspaceId",
      flashcards:
        "id, workspaceId, deckId, sourceId, dueAt, [workspaceId+dueAt], [deckId+dueAt]",
      reviewLogs: "id, flashcardId, workspaceId, reviewedAt",
      chatThreads:
        "id, workspaceId, sourceId, pinned, [workspaceId+updatedAt], [sourceId+updatedAt]",
      chatMessages: "id, threadId, workspaceId, [threadId+createdAt]",
      seedFlags: "id",
    });

    // v3: Add optional recoveryCiphertext / recoveryIv fields to apiKeys.
    // Existing rows keep these fields undefined; they get filled the next
    // time a key is written when a recovery key exists in memory.
    this.version(3)
      .stores({
        apiKeys: "provider, updatedAt",
        vault: "id",
        workspaces: "id, updatedAt, archivedAt",
        sources:
          "id, workspaceId, ingestStatus, contentHash, [workspaceId+createdAt], [workspaceId+updatedAt]",
        chunks: "id, sourceId, workspaceId, [sourceId+index]",
        highlights:
          "id, sourceId, chunkId, workspaceId, [sourceId+createdAt]",
        decks: "id, workspaceId",
        flashcards:
          "id, workspaceId, deckId, sourceId, dueAt, [workspaceId+dueAt], [deckId+dueAt]",
        reviewLogs: "id, flashcardId, workspaceId, reviewedAt",
        chatThreads:
          "id, workspaceId, sourceId, pinned, [workspaceId+updatedAt], [sourceId+updatedAt]",
        chatMessages: "id, threadId, workspaceId, [threadId+createdAt]",
        seedFlags: "id",
      })
      .upgrade(async (tx) => {
        // Pure type-extension migration: no existing data needs to change.
        // Touch the table so the upgrade transaction commits cleanly.
        await tx.table("apiKeys").toCollection().count();
      });

    // v4: Type-only extensions — no new indexes are required.
    //   - flashcards.lapses: backfill to 0 on every existing row so leech
    //     detection (>= 8) has a stable starting point without forcing every
    //     consumer to coalesce `?? 0` at read time.
    //   - chatThreads.{pinned?, renamedAt?}: schema-only widen (already in
    //     types.ts). Pure type-extension; no data migration required.
    this.version(4)
      .stores({
        apiKeys: "provider, updatedAt",
        vault: "id",
        workspaces: "id, updatedAt, archivedAt",
        sources:
          "id, workspaceId, ingestStatus, contentHash, [workspaceId+createdAt], [workspaceId+updatedAt]",
        chunks: "id, sourceId, workspaceId, [sourceId+index]",
        highlights:
          "id, sourceId, chunkId, workspaceId, [sourceId+createdAt]",
        decks: "id, workspaceId",
        flashcards:
          "id, workspaceId, deckId, sourceId, dueAt, [workspaceId+dueAt], [deckId+dueAt]",
        reviewLogs: "id, flashcardId, workspaceId, reviewedAt",
        chatThreads:
          "id, workspaceId, sourceId, pinned, [workspaceId+updatedAt], [sourceId+updatedAt]",
        chatMessages: "id, threadId, workspaceId, [threadId+createdAt]",
        seedFlags: "id",
      })
      .upgrade(async (tx) => {
        await tx
          .table("flashcards")
          .toCollection()
          .modify((row: { lapses?: number }) => {
            if (typeof row.lapses !== "number") row.lapses = 0;
          });
      });

    // v5: Pure type-extension — `ApiKeyProvider` literal union widens to 17+
    // cloud presets + embed-only providers + `custom:${string}`. Stored
    // `provider` is already a string, so no row rewrite is needed.
    this.version(5)
      .stores({
        apiKeys: "provider, updatedAt",
        vault: "id",
        workspaces: "id, updatedAt, archivedAt",
        sources:
          "id, workspaceId, ingestStatus, contentHash, [workspaceId+createdAt], [workspaceId+updatedAt]",
        chunks: "id, sourceId, workspaceId, [sourceId+index]",
        highlights:
          "id, sourceId, chunkId, workspaceId, [sourceId+createdAt]",
        decks: "id, workspaceId",
        flashcards:
          "id, workspaceId, deckId, sourceId, dueAt, [workspaceId+dueAt], [deckId+dueAt]",
        reviewLogs: "id, flashcardId, workspaceId, reviewedAt",
        chatThreads:
          "id, workspaceId, sourceId, pinned, [workspaceId+updatedAt], [sourceId+updatedAt]",
        chatMessages: "id, threadId, workspaceId, [threadId+createdAt]",
        seedFlags: "id",
      })
      .upgrade(async (tx) => {
        await tx.table("apiKeys").toCollection().count();
      });

    // v6: Pure type-extension — `ApiKeyProvider` literal union widens with the
    // 3 local presets (ollama / lm-studio / llama-cpp). Stored `provider` is
    // a free-form string at the Dexie layer, so no row rewrite is needed; the
    // version bump exists only so Dexie commits a clean upgrade transaction
    // and downstream type guards stay coherent.
    this.version(6)
      .stores({
        apiKeys: "provider, updatedAt",
        vault: "id",
        workspaces: "id, updatedAt, archivedAt",
        sources:
          "id, workspaceId, ingestStatus, contentHash, [workspaceId+createdAt], [workspaceId+updatedAt]",
        chunks: "id, sourceId, workspaceId, [sourceId+index]",
        highlights:
          "id, sourceId, chunkId, workspaceId, [sourceId+createdAt]",
        decks: "id, workspaceId",
        flashcards:
          "id, workspaceId, deckId, sourceId, dueAt, [workspaceId+dueAt], [deckId+dueAt]",
        reviewLogs: "id, flashcardId, workspaceId, reviewedAt",
        chatThreads:
          "id, workspaceId, sourceId, pinned, [workspaceId+updatedAt], [sourceId+updatedAt]",
        chatMessages: "id, threadId, workspaceId, [threadId+createdAt]",
        seedFlags: "id",
      })
      .upgrade(async (tx) => {
        await tx.table("apiKeys").toCollection().count();
      });

    // v7: Backfill optional embedding metadata on chunks so retrieval can
    // dim-guard mixed-provider workspaces without guessing 1536 forever.
    // Idempotent: a re-run on already-backfilled rows is a no-op because we
    // only write when the field is missing.
    this.version(7)
      .stores({
        apiKeys: "provider, updatedAt",
        vault: "id",
        workspaces: "id, updatedAt, archivedAt",
        sources:
          "id, workspaceId, ingestStatus, contentHash, [workspaceId+createdAt], [workspaceId+updatedAt]",
        chunks: "id, sourceId, workspaceId, [sourceId+index]",
        highlights:
          "id, sourceId, chunkId, workspaceId, [sourceId+createdAt]",
        decks: "id, workspaceId",
        flashcards:
          "id, workspaceId, deckId, sourceId, dueAt, [workspaceId+dueAt], [deckId+dueAt]",
        reviewLogs: "id, flashcardId, workspaceId, reviewedAt",
        chatThreads:
          "id, workspaceId, sourceId, pinned, [workspaceId+updatedAt], [sourceId+updatedAt]",
        chatMessages: "id, threadId, workspaceId, [threadId+createdAt]",
        seedFlags: "id",
      })
      .upgrade(async (tx) => {
        await tx
          .table("chunks")
          .toCollection()
          .modify(
            (row: {
              embedding?: Float32Array;
              embeddingDim?: number;
              embeddingProvider?: string;
              embeddingModel?: string;
            }) => {
              if (!row.embedding) return;
              if (typeof row.embeddingDim !== "number") {
                row.embeddingDim = row.embedding.length;
              }
              if (typeof row.embeddingProvider !== "string") {
                row.embeddingProvider = "openai";
              }
              if (typeof row.embeddingModel !== "string") {
                row.embeddingModel = "text-embedding-3-small";
              }
            },
          );
      });

    // v8: Add a top-level `createdAt` index on chatMessages so the cost-chip
    // live-query (`useTotalCost` / `useCostByModel`) can filter "since
    // midnight" via `where("createdAt").above(since)`. Previously only the
    // compound `[threadId+createdAt]` index existed, and a where-clause on
    // an unindexed key raises DexieError on first paint, which the
    // ErrorBoundary catches but degrades the chip into permanent fallback.
    // Dexie reindexes existing rows automatically when a new index is
    // declared — no upgrade body needed beyond the schema declaration.
    this.version(8).stores({
      apiKeys: "provider, updatedAt",
      vault: "id",
      workspaces: "id, updatedAt, archivedAt",
      sources:
        "id, workspaceId, ingestStatus, contentHash, [workspaceId+createdAt], [workspaceId+updatedAt]",
      chunks: "id, sourceId, workspaceId, [sourceId+index]",
      highlights:
        "id, sourceId, chunkId, workspaceId, [sourceId+createdAt]",
      decks: "id, workspaceId",
      flashcards:
        "id, workspaceId, deckId, sourceId, dueAt, [workspaceId+dueAt], [deckId+dueAt]",
      reviewLogs: "id, flashcardId, workspaceId, reviewedAt",
      chatThreads:
        "id, workspaceId, sourceId, pinned, [workspaceId+updatedAt], [sourceId+updatedAt]",
      chatMessages: "id, threadId, workspaceId, createdAt, [threadId+createdAt]",
      seedFlags: "id",
    });

    // v9: Pure type-extension — `ReviewLogRecord.durationMs?` lives at the
    // value layer; we never filter on it, so no new index is needed. The
    // version bump exists only so Dexie commits a clean upgrade transaction
    // and downstream consumers (real streak compute + future weekly study
    // minutes) can safely read the field without coercion. Existing rows
    // remain durationMs-undefined; callers coalesce to 0.
    this.version(9)
      .stores({
        apiKeys: "provider, updatedAt",
        vault: "id",
        workspaces: "id, updatedAt, archivedAt",
        sources:
          "id, workspaceId, ingestStatus, contentHash, [workspaceId+createdAt], [workspaceId+updatedAt]",
        chunks: "id, sourceId, workspaceId, [sourceId+index]",
        highlights:
          "id, sourceId, chunkId, workspaceId, [sourceId+createdAt]",
        decks: "id, workspaceId",
        flashcards:
          "id, workspaceId, deckId, sourceId, dueAt, [workspaceId+dueAt], [deckId+dueAt]",
        reviewLogs: "id, flashcardId, workspaceId, reviewedAt",
        chatThreads:
          "id, workspaceId, sourceId, pinned, [workspaceId+updatedAt], [sourceId+updatedAt]",
        chatMessages: "id, threadId, workspaceId, createdAt, [threadId+createdAt]",
        seedFlags: "id",
      })
      .upgrade(async (tx) => {
        await tx.table("reviewLogs").toCollection().count();
      });

    // v10: Pure type-extension for `FlashcardRecord.generatedFrom?` — used
    // only for provenance display (icon on AI-generated cards) and dedupe
    // hashing during batch generation. Not indexed; no upgrade body needed
    // beyond a touch transaction so Dexie commits cleanly.
    this.version(10)
      .stores({
        apiKeys: "provider, updatedAt",
        vault: "id",
        workspaces: "id, updatedAt, archivedAt",
        sources:
          "id, workspaceId, ingestStatus, contentHash, [workspaceId+createdAt], [workspaceId+updatedAt]",
        chunks: "id, sourceId, workspaceId, [sourceId+index]",
        highlights:
          "id, sourceId, chunkId, workspaceId, [sourceId+createdAt]",
        decks: "id, workspaceId",
        flashcards:
          "id, workspaceId, deckId, sourceId, dueAt, [workspaceId+dueAt], [deckId+dueAt]",
        reviewLogs: "id, flashcardId, workspaceId, reviewedAt",
        chatThreads:
          "id, workspaceId, sourceId, pinned, [workspaceId+updatedAt], [sourceId+updatedAt]",
        chatMessages: "id, threadId, workspaceId, createdAt, [threadId+createdAt]",
        seedFlags: "id",
      })
      .upgrade(async (tx) => {
        await tx.table("flashcards").toCollection().count();
      });

    // v11: New `quizSessions` table — items + answers stored inline because
    // they are session-scoped and never queried in isolation. Indexed on
    // workspaceId and startedAt so the page can list recent sessions and on
    // sourceId for per-source history. Pure additive — no upgrade body
    // needed for existing rows in other tables.
    this.version(11)
      .stores({
        apiKeys: "provider, updatedAt",
        vault: "id",
        workspaces: "id, updatedAt, archivedAt",
        sources:
          "id, workspaceId, ingestStatus, contentHash, [workspaceId+createdAt], [workspaceId+updatedAt]",
        chunks: "id, sourceId, workspaceId, [sourceId+index]",
        highlights:
          "id, sourceId, chunkId, workspaceId, [sourceId+createdAt]",
        decks: "id, workspaceId",
        flashcards:
          "id, workspaceId, deckId, sourceId, dueAt, [workspaceId+dueAt], [deckId+dueAt]",
        reviewLogs: "id, flashcardId, workspaceId, reviewedAt",
        chatThreads:
          "id, workspaceId, sourceId, pinned, [workspaceId+updatedAt], [sourceId+updatedAt]",
        chatMessages: "id, threadId, workspaceId, createdAt, [threadId+createdAt]",
        quizSessions:
          "id, workspaceId, sourceId, startedAt, [workspaceId+startedAt]",
        seedFlags: "id",
      });

    // v12: New `concepts` + `conceptEdges` tables for the Mind Map view (4.E).
    // Concepts indexed on labelNorm so the extractor can dedupe by exact
    // normalized name in O(1); edges indexed on fromId for inspector queries
    // (and a compound [workspaceId+fromId] for workspace-scoped traversal).
    // Pure additive — existing rows are untouched.
    this.version(12)
      .stores({
        apiKeys: "provider, updatedAt",
        vault: "id",
        workspaces: "id, updatedAt, archivedAt",
        sources:
          "id, workspaceId, ingestStatus, contentHash, [workspaceId+createdAt], [workspaceId+updatedAt]",
        chunks: "id, sourceId, workspaceId, [sourceId+index]",
        highlights:
          "id, sourceId, chunkId, workspaceId, [sourceId+createdAt]",
        decks: "id, workspaceId",
        flashcards:
          "id, workspaceId, deckId, sourceId, dueAt, [workspaceId+dueAt], [deckId+dueAt]",
        reviewLogs: "id, flashcardId, workspaceId, reviewedAt",
        chatThreads:
          "id, workspaceId, sourceId, pinned, [workspaceId+updatedAt], [sourceId+updatedAt]",
        chatMessages: "id, threadId, workspaceId, createdAt, [threadId+createdAt]",
        quizSessions:
          "id, workspaceId, sourceId, startedAt, [workspaceId+startedAt]",
        concepts:
          "id, workspaceId, labelNorm, [workspaceId+labelNorm], [workspaceId+updatedAt]",
        conceptEdges:
          "id, workspaceId, fromId, toId, [workspaceId+fromId], [workspaceId+toId]",
        seedFlags: "id",
      });

    // v13: Source parse readiness and embedding readiness diverge. A source can
    // be readable (`ingestStatus=ready`) while vectors are missing/skipped/error.
    // Existing rows are backfilled from chunk vectors so old libraries open
    // correctly without forcing an immediate reembed.
    this.version(13)
      .stores({
        apiKeys: "provider, updatedAt",
        vault: "id",
        workspaces: "id, updatedAt, archivedAt",
        sources:
          "id, workspaceId, ingestStatus, embeddingStatus, contentHash, [workspaceId+createdAt], [workspaceId+updatedAt]",
        chunks: "id, sourceId, workspaceId, [sourceId+index]",
        highlights:
          "id, sourceId, chunkId, workspaceId, [sourceId+createdAt]",
        decks: "id, workspaceId",
        flashcards:
          "id, workspaceId, deckId, sourceId, dueAt, [workspaceId+dueAt], [deckId+dueAt]",
        reviewLogs: "id, flashcardId, workspaceId, reviewedAt",
        chatThreads:
          "id, workspaceId, sourceId, pinned, [workspaceId+updatedAt], [sourceId+updatedAt]",
        chatMessages: "id, threadId, workspaceId, createdAt, [threadId+createdAt]",
        quizSessions:
          "id, workspaceId, sourceId, startedAt, [workspaceId+startedAt]",
        concepts:
          "id, workspaceId, labelNorm, [workspaceId+labelNorm], [workspaceId+updatedAt]",
        conceptEdges:
          "id, workspaceId, fromId, toId, [workspaceId+fromId], [workspaceId+toId]",
        seedFlags: "id",
      })
      .upgrade(async (tx) => {
        const chunkRows = await tx.table("chunks").toArray();
        const embeddedSourceIds = new Set<string>();
        for (const chunk of chunkRows as Array<{
          sourceId?: string;
          embedding?: Float32Array;
        }>) {
          if (chunk.sourceId && chunk.embedding) {
            embeddedSourceIds.add(chunk.sourceId);
          }
        }
        await tx
          .table("sources")
          .toCollection()
          .modify(
            (source: {
              id: string;
              ingestStatus?: string;
              embeddingStatus?: string;
            }) => {
              if (typeof source.embeddingStatus === "string") return;
              if (source.ingestStatus === "ready") {
                source.embeddingStatus = embeddedSourceIds.has(source.id)
                  ? "ready"
                  : "missing";
              } else if (source.ingestStatus === "error") {
                source.embeddingStatus = "missing";
              } else {
                source.embeddingStatus = "queued";
              }
            },
          );
      });

    // v14: Guided Study / AI Course Builder persistence (Phase 4.5).
    // Pure additive: curricula own ordered curriculumItems; lessonNotes and
    // studyJournalEntries are workspace-scoped so backup/restore and delete
    // cascade can move/remove a complete guided-study surface atomically.
    this.version(14).stores({
      apiKeys: "provider, updatedAt",
      vault: "id",
      workspaces: "id, updatedAt, archivedAt",
      sources:
        "id, workspaceId, ingestStatus, embeddingStatus, contentHash, [workspaceId+createdAt], [workspaceId+updatedAt]",
      chunks: "id, sourceId, workspaceId, [sourceId+index]",
      highlights:
        "id, sourceId, chunkId, workspaceId, [sourceId+createdAt]",
      decks: "id, workspaceId",
      flashcards:
        "id, workspaceId, deckId, sourceId, dueAt, [workspaceId+dueAt], [deckId+dueAt]",
      reviewLogs: "id, flashcardId, workspaceId, reviewedAt",
      chatThreads:
        "id, workspaceId, sourceId, pinned, [workspaceId+updatedAt], [sourceId+updatedAt]",
      chatMessages: "id, threadId, workspaceId, createdAt, [threadId+createdAt]",
      quizSessions:
        "id, workspaceId, sourceId, startedAt, [workspaceId+startedAt]",
      concepts:
        "id, workspaceId, labelNorm, [workspaceId+labelNorm], [workspaceId+updatedAt]",
      conceptEdges:
        "id, workspaceId, fromId, toId, [workspaceId+fromId], [workspaceId+toId]",
      curricula: "id, workspaceId, status, [workspaceId+updatedAt]",
      curriculumItems:
        "id, workspaceId, curriculumId, parentId, status, [curriculumId+order], [workspaceId+status]",
      lessonNotes:
        "id, workspaceId, curriculumItemId, status, [workspaceId+createdAt], [curriculumItemId+createdAt]",
      studyJournalEntries:
        "id, workspaceId, lessonNoteId, sourceId, createdAt, [workspaceId+createdAt]",
      seedFlags: "id",
    });

    // v15: New `sourceBlobs` table — original binary kept alongside parsed
    // chunks so the reader can render the source visually (e.g. PDF canvas +
    // textLayer) instead of only the chunked plain text. PK is sourceId
    // (1:1 with sources). The blob field is binary, not indexed; only
    // sourceId is queryable. Cascade delete is handled in deleteSource().
    this.version(15).stores({
      apiKeys: "provider, updatedAt",
      vault: "id",
      workspaces: "id, updatedAt, archivedAt",
      sources:
        "id, workspaceId, ingestStatus, embeddingStatus, contentHash, [workspaceId+createdAt], [workspaceId+updatedAt]",
      chunks: "id, sourceId, workspaceId, [sourceId+index]",
      highlights:
        "id, sourceId, chunkId, workspaceId, [sourceId+createdAt]",
      decks: "id, workspaceId",
      flashcards:
        "id, workspaceId, deckId, sourceId, dueAt, [workspaceId+dueAt], [deckId+dueAt]",
      reviewLogs: "id, flashcardId, workspaceId, reviewedAt",
      chatThreads:
        "id, workspaceId, sourceId, pinned, [workspaceId+updatedAt], [sourceId+updatedAt]",
      chatMessages: "id, threadId, workspaceId, createdAt, [threadId+createdAt]",
      quizSessions:
        "id, workspaceId, sourceId, startedAt, [workspaceId+startedAt]",
      concepts:
        "id, workspaceId, labelNorm, [workspaceId+labelNorm], [workspaceId+updatedAt]",
      conceptEdges:
        "id, workspaceId, fromId, toId, [workspaceId+fromId], [workspaceId+toId]",
      curricula: "id, workspaceId, status, [workspaceId+updatedAt]",
      curriculumItems:
        "id, workspaceId, curriculumId, parentId, status, [curriculumId+order], [workspaceId+status]",
      lessonNotes:
        "id, workspaceId, curriculumItemId, status, [workspaceId+createdAt], [curriculumItemId+createdAt]",
      studyJournalEntries:
        "id, workspaceId, lessonNoteId, sourceId, createdAt, [workspaceId+createdAt]",
      sourceBlobs: "sourceId, createdAt",
      seedFlags: "id",
    });

    // v16: New `planBlocks` table — week/day calendar surface (Phase 5).
    // Each block holds a startTs (epoch ms) + durationMin so the Plan page
    // can build a real week grid from `usePlanBlocksInRange`. Optional
    // `curriculumItemId` and `sourceId` link a block back to the source it
    // references; both are loose links (dangling-tolerant) so deleting an
    // item or source does not require a cascade rewrite. The compound
    // `[workspaceId+startTs]` index powers "blocks this week" range queries.
    this.version(16).stores({
      apiKeys: "provider, updatedAt",
      vault: "id",
      workspaces: "id, updatedAt, archivedAt",
      sources:
        "id, workspaceId, ingestStatus, embeddingStatus, contentHash, [workspaceId+createdAt], [workspaceId+updatedAt]",
      chunks: "id, sourceId, workspaceId, [sourceId+index]",
      highlights:
        "id, sourceId, chunkId, workspaceId, [sourceId+createdAt]",
      decks: "id, workspaceId",
      flashcards:
        "id, workspaceId, deckId, sourceId, dueAt, [workspaceId+dueAt], [deckId+dueAt]",
      reviewLogs: "id, flashcardId, workspaceId, reviewedAt",
      chatThreads:
        "id, workspaceId, sourceId, pinned, [workspaceId+updatedAt], [sourceId+updatedAt]",
      chatMessages: "id, threadId, workspaceId, createdAt, [threadId+createdAt]",
      quizSessions:
        "id, workspaceId, sourceId, startedAt, [workspaceId+startedAt]",
      concepts:
        "id, workspaceId, labelNorm, [workspaceId+labelNorm], [workspaceId+updatedAt]",
      conceptEdges:
        "id, workspaceId, fromId, toId, [workspaceId+fromId], [workspaceId+toId]",
      curricula: "id, workspaceId, status, [workspaceId+updatedAt]",
      curriculumItems:
        "id, workspaceId, curriculumId, parentId, status, [curriculumId+order], [workspaceId+status]",
      lessonNotes:
        "id, workspaceId, curriculumItemId, status, [workspaceId+createdAt], [curriculumItemId+createdAt]",
      studyJournalEntries:
        "id, workspaceId, lessonNoteId, sourceId, createdAt, [workspaceId+createdAt]",
      sourceBlobs: "sourceId, createdAt",
      planBlocks:
        "id, workspaceId, curriculumItemId, sourceId, startTs, [workspaceId+startTs]",
      seedFlags: "id",
    });

    // v17: New `podcasts` + `podcastBlobs` tables — 2-host AI dialogue
    // surface (Phase 5.B). Script (`segments` / `chapters`) lives in the
    // metadata row so list views, search, and backup stay cheap; the
    // synthesized audio is kept 1:1 in `podcastBlobs` keyed by
    // `podcastId` so the heavy binary never enters list-row reads.
    // The `[workspaceId+createdAt]` compound index powers "podcasts in
    // this workspace, newest first" queries on the workspace overview.
    // Pure additive — existing rows are untouched.
    this.version(17).stores({
      apiKeys: "provider, updatedAt",
      vault: "id",
      workspaces: "id, updatedAt, archivedAt",
      sources:
        "id, workspaceId, ingestStatus, embeddingStatus, contentHash, [workspaceId+createdAt], [workspaceId+updatedAt]",
      chunks: "id, sourceId, workspaceId, [sourceId+index]",
      highlights:
        "id, sourceId, chunkId, workspaceId, [sourceId+createdAt]",
      decks: "id, workspaceId",
      flashcards:
        "id, workspaceId, deckId, sourceId, dueAt, [workspaceId+dueAt], [deckId+dueAt]",
      reviewLogs: "id, flashcardId, workspaceId, reviewedAt",
      chatThreads:
        "id, workspaceId, sourceId, pinned, [workspaceId+updatedAt], [sourceId+updatedAt]",
      chatMessages: "id, threadId, workspaceId, createdAt, [threadId+createdAt]",
      quizSessions:
        "id, workspaceId, sourceId, startedAt, [workspaceId+startedAt]",
      concepts:
        "id, workspaceId, labelNorm, [workspaceId+labelNorm], [workspaceId+updatedAt]",
      conceptEdges:
        "id, workspaceId, fromId, toId, [workspaceId+fromId], [workspaceId+toId]",
      curricula: "id, workspaceId, status, [workspaceId+updatedAt]",
      curriculumItems:
        "id, workspaceId, curriculumId, parentId, status, [curriculumId+order], [workspaceId+status]",
      lessonNotes:
        "id, workspaceId, curriculumItemId, status, [workspaceId+createdAt], [curriculumItemId+createdAt]",
      studyJournalEntries:
        "id, workspaceId, lessonNoteId, sourceId, createdAt, [workspaceId+createdAt]",
      sourceBlobs: "sourceId, createdAt",
      planBlocks:
        "id, workspaceId, curriculumItemId, sourceId, startTs, [workspaceId+startTs]",
      podcasts:
        "id, workspaceId, status, [workspaceId+createdAt], [workspaceId+status]",
      podcastBlobs: "podcastId, createdAt",
      seedFlags: "id",
    });

    // v18: planBlocks polish (Phase 5.C foundation). New `status` field
    // (scheduled/done/skipped/cancelled) + optional `completedAt`,
    // `remindAtTs`, `recurrenceRule`. Two new indexes:
    //   - `[workspaceId+status]` for "show only scheduled blocks" filters,
    //   - `remindAtTs` for the upcoming-reminder scheduler (visibilitychange
    //     re-arm in 5.C.C).
    // Existing rows are backfilled with `status: "scheduled"` so legacy
    // blocks remain visible on the week grid without manual rewrite.
    this.version(18)
      .stores({
        apiKeys: "provider, updatedAt",
        vault: "id",
        workspaces: "id, updatedAt, archivedAt",
        sources:
          "id, workspaceId, ingestStatus, embeddingStatus, contentHash, [workspaceId+createdAt], [workspaceId+updatedAt]",
        chunks: "id, sourceId, workspaceId, [sourceId+index]",
        highlights:
          "id, sourceId, chunkId, workspaceId, [sourceId+createdAt]",
        decks: "id, workspaceId",
        flashcards:
          "id, workspaceId, deckId, sourceId, dueAt, [workspaceId+dueAt], [deckId+dueAt]",
        reviewLogs: "id, flashcardId, workspaceId, reviewedAt",
        chatThreads:
          "id, workspaceId, sourceId, pinned, [workspaceId+updatedAt], [sourceId+updatedAt]",
        chatMessages: "id, threadId, workspaceId, createdAt, [threadId+createdAt]",
        quizSessions:
          "id, workspaceId, sourceId, startedAt, [workspaceId+startedAt]",
        concepts:
          "id, workspaceId, labelNorm, [workspaceId+labelNorm], [workspaceId+updatedAt]",
        conceptEdges:
          "id, workspaceId, fromId, toId, [workspaceId+fromId], [workspaceId+toId]",
        curricula: "id, workspaceId, status, [workspaceId+updatedAt]",
        curriculumItems:
          "id, workspaceId, curriculumId, parentId, status, [curriculumId+order], [workspaceId+status]",
        lessonNotes:
          "id, workspaceId, curriculumItemId, status, [workspaceId+createdAt], [curriculumItemId+createdAt]",
        studyJournalEntries:
          "id, workspaceId, lessonNoteId, sourceId, createdAt, [workspaceId+createdAt]",
        sourceBlobs: "sourceId, createdAt",
        planBlocks:
          "id, workspaceId, curriculumItemId, sourceId, startTs, status, remindAtTs, [workspaceId+startTs], [workspaceId+status], [workspaceId+remindAtTs]",
        podcasts:
          "id, workspaceId, status, [workspaceId+createdAt], [workspaceId+status]",
        podcastBlobs: "podcastId, createdAt",
        seedFlags: "id",
      })
      .upgrade(async (tx) => {
        await tx
          .table("planBlocks")
          .toCollection()
          .modify((row: { status?: string }) => {
            if (typeof row.status !== "string") row.status = "scheduled";
          });
      });

    // v19: Pure type-extension for `ChatMessageRecord` — new optional
    // `webSearchUsed` and `webCitations` fields (Phase 5.5 web search
    // foundation). Neither field is indexed; the reader filters citations
    // in memory from the messages array. The version bump exists only so
    // Dexie commits a clean upgrade transaction and downstream readers
    // (cost roll-ups, message rehydrate on reload) can rely on the field
    // being present-or-undefined rather than missing-from-the-row.
    this.version(19)
      .stores({
        apiKeys: "provider, updatedAt",
        vault: "id",
        workspaces: "id, updatedAt, archivedAt",
        sources:
          "id, workspaceId, ingestStatus, embeddingStatus, contentHash, [workspaceId+createdAt], [workspaceId+updatedAt]",
        chunks: "id, sourceId, workspaceId, [sourceId+index]",
        highlights:
          "id, sourceId, chunkId, workspaceId, [sourceId+createdAt]",
        decks: "id, workspaceId",
        flashcards:
          "id, workspaceId, deckId, sourceId, dueAt, [workspaceId+dueAt], [deckId+dueAt]",
        reviewLogs: "id, flashcardId, workspaceId, reviewedAt",
        chatThreads:
          "id, workspaceId, sourceId, pinned, [workspaceId+updatedAt], [sourceId+updatedAt]",
        chatMessages: "id, threadId, workspaceId, createdAt, [threadId+createdAt]",
        quizSessions:
          "id, workspaceId, sourceId, startedAt, [workspaceId+startedAt]",
        concepts:
          "id, workspaceId, labelNorm, [workspaceId+labelNorm], [workspaceId+updatedAt]",
        conceptEdges:
          "id, workspaceId, fromId, toId, [workspaceId+fromId], [workspaceId+toId]",
        curricula: "id, workspaceId, status, [workspaceId+updatedAt]",
        curriculumItems:
          "id, workspaceId, curriculumId, parentId, status, [curriculumId+order], [workspaceId+status]",
        lessonNotes:
          "id, workspaceId, curriculumItemId, status, [workspaceId+createdAt], [curriculumItemId+createdAt]",
        studyJournalEntries:
          "id, workspaceId, lessonNoteId, sourceId, createdAt, [workspaceId+createdAt]",
        sourceBlobs: "sourceId, createdAt",
        planBlocks:
          "id, workspaceId, curriculumItemId, sourceId, startTs, status, remindAtTs, [workspaceId+startTs], [workspaceId+status], [workspaceId+remindAtTs]",
        podcasts:
          "id, workspaceId, status, [workspaceId+createdAt], [workspaceId+status]",
        podcastBlobs: "podcastId, createdAt",
        seedFlags: "id",
      })
      .upgrade(async (tx) => {
        await tx.table("chatMessages").toCollection().count();
      });

    // v20: Pure type-extension — `ApiKeyProvider` literal union widens with the
    // 2 new research presets (diffbot / brightdata) for Phase 5.5.D URL fetcher
    // expansion. Stored `provider` is a free-form string at the Dexie layer,
    // so no row rewrite is needed; the version bump exists only so Dexie
    // commits a clean upgrade transaction and downstream type guards stay
    // coherent against the widened union.
    this.version(20)
      .stores({
        apiKeys: "provider, updatedAt",
        vault: "id",
        workspaces: "id, updatedAt, archivedAt",
        sources:
          "id, workspaceId, ingestStatus, embeddingStatus, contentHash, [workspaceId+createdAt], [workspaceId+updatedAt]",
        chunks: "id, sourceId, workspaceId, [sourceId+index]",
        highlights:
          "id, sourceId, chunkId, workspaceId, [sourceId+createdAt]",
        decks: "id, workspaceId",
        flashcards:
          "id, workspaceId, deckId, sourceId, dueAt, [workspaceId+dueAt], [deckId+dueAt]",
        reviewLogs: "id, flashcardId, workspaceId, reviewedAt",
        chatThreads:
          "id, workspaceId, sourceId, pinned, [workspaceId+updatedAt], [sourceId+updatedAt]",
        chatMessages: "id, threadId, workspaceId, createdAt, [threadId+createdAt]",
        quizSessions:
          "id, workspaceId, sourceId, startedAt, [workspaceId+startedAt]",
        concepts:
          "id, workspaceId, labelNorm, [workspaceId+labelNorm], [workspaceId+updatedAt]",
        conceptEdges:
          "id, workspaceId, fromId, toId, [workspaceId+fromId], [workspaceId+toId]",
        curricula: "id, workspaceId, status, [workspaceId+updatedAt]",
        curriculumItems:
          "id, workspaceId, curriculumId, parentId, status, [curriculumId+order], [workspaceId+status]",
        lessonNotes:
          "id, workspaceId, curriculumItemId, status, [workspaceId+createdAt], [curriculumItemId+createdAt]",
        studyJournalEntries:
          "id, workspaceId, lessonNoteId, sourceId, createdAt, [workspaceId+createdAt]",
        sourceBlobs: "sourceId, createdAt",
        planBlocks:
          "id, workspaceId, curriculumItemId, sourceId, startTs, status, remindAtTs, [workspaceId+startTs], [workspaceId+status], [workspaceId+remindAtTs]",
        podcasts:
          "id, workspaceId, status, [workspaceId+createdAt], [workspaceId+status]",
        podcastBlobs: "podcastId, createdAt",
        seedFlags: "id",
      })
      .upgrade(async (tx) => {
        await tx.table("apiKeys").toCollection().count();
      });

    // v21: Pure type-extension — `ApiKeyProvider` literal union widens with
    // the Brave search key (5.5.E "Konu ara → Kaynak ekle" modal). Brave is a
    // search surface (returns URLs for a query) rather than a research
    // extractor, so it lives outside RESEARCH_PRESETS but still needs a
    // stored key entry. Same pattern as v5/v6/v20: stores schema verbatim,
    // upgrade is a no-op `count()` so Dexie commits a clean transaction.
    this.version(21)
      .stores({
        apiKeys: "provider, updatedAt",
        vault: "id",
        workspaces: "id, updatedAt, archivedAt",
        sources:
          "id, workspaceId, ingestStatus, embeddingStatus, contentHash, [workspaceId+createdAt], [workspaceId+updatedAt]",
        chunks: "id, sourceId, workspaceId, [sourceId+index]",
        highlights:
          "id, sourceId, chunkId, workspaceId, [sourceId+createdAt]",
        decks: "id, workspaceId",
        flashcards:
          "id, workspaceId, deckId, sourceId, dueAt, [workspaceId+dueAt], [deckId+dueAt]",
        reviewLogs: "id, flashcardId, workspaceId, reviewedAt",
        chatThreads:
          "id, workspaceId, sourceId, pinned, [workspaceId+updatedAt], [sourceId+updatedAt]",
        chatMessages: "id, threadId, workspaceId, createdAt, [threadId+createdAt]",
        quizSessions:
          "id, workspaceId, sourceId, startedAt, [workspaceId+startedAt]",
        concepts:
          "id, workspaceId, labelNorm, [workspaceId+labelNorm], [workspaceId+updatedAt]",
        conceptEdges:
          "id, workspaceId, fromId, toId, [workspaceId+fromId], [workspaceId+toId]",
        curricula: "id, workspaceId, status, [workspaceId+updatedAt]",
        curriculumItems:
          "id, workspaceId, curriculumId, parentId, status, [curriculumId+order], [workspaceId+status]",
        lessonNotes:
          "id, workspaceId, curriculumItemId, status, [workspaceId+createdAt], [curriculumItemId+createdAt]",
        studyJournalEntries:
          "id, workspaceId, lessonNoteId, sourceId, createdAt, [workspaceId+createdAt]",
        sourceBlobs: "sourceId, createdAt",
        planBlocks:
          "id, workspaceId, curriculumItemId, sourceId, startTs, status, remindAtTs, [workspaceId+startTs], [workspaceId+status], [workspaceId+remindAtTs]",
        podcasts:
          "id, workspaceId, status, [workspaceId+createdAt], [workspaceId+status]",
        podcastBlobs: "podcastId, createdAt",
        seedFlags: "id",
      })
      .upgrade(async (tx) => {
        await tx.table("apiKeys").toCollection().count();
      });

    // v22: New `notes` + `noteFolders` tables — workspace-bound Obsidian-style
    // markdown notes (Phase 6.1). Hierarchical folders (`parentId` nullable
    // for root); notes live in zero-or-one folder via `folderId`. Tags +
    // wikilinks are denormalised onto each note row as multiEntry indexes so
    // backlink queries (`notes.where('wikilinks').equals(targetId)`) and tag
    // filters stay O(matches). `path` mirrors the folder breadcrumb (e.g.
    // "Daily/2026-05-15.md") so Phase 7 (Tauri shell) can swap the resolver
    // from id-lookup to filesystem-path-lookup without rewriting the schema.
    // Pure additive — existing rows in other tables are untouched.
    this.version(22).stores({
      apiKeys: "provider, updatedAt",
      vault: "id",
      workspaces: "id, updatedAt, archivedAt",
      sources:
        "id, workspaceId, ingestStatus, embeddingStatus, contentHash, [workspaceId+createdAt], [workspaceId+updatedAt]",
      chunks: "id, sourceId, workspaceId, [sourceId+index]",
      highlights:
        "id, sourceId, chunkId, workspaceId, [sourceId+createdAt]",
      decks: "id, workspaceId",
      flashcards:
        "id, workspaceId, deckId, sourceId, dueAt, [workspaceId+dueAt], [deckId+dueAt]",
      reviewLogs: "id, flashcardId, workspaceId, reviewedAt",
      chatThreads:
        "id, workspaceId, sourceId, pinned, [workspaceId+updatedAt], [sourceId+updatedAt]",
      chatMessages: "id, threadId, workspaceId, createdAt, [threadId+createdAt]",
      quizSessions:
        "id, workspaceId, sourceId, startedAt, [workspaceId+startedAt]",
      concepts:
        "id, workspaceId, labelNorm, [workspaceId+labelNorm], [workspaceId+updatedAt]",
      conceptEdges:
        "id, workspaceId, fromId, toId, [workspaceId+fromId], [workspaceId+toId]",
      curricula: "id, workspaceId, status, [workspaceId+updatedAt]",
      curriculumItems:
        "id, workspaceId, curriculumId, parentId, status, [curriculumId+order], [workspaceId+status]",
      lessonNotes:
        "id, workspaceId, curriculumItemId, status, [workspaceId+createdAt], [curriculumItemId+createdAt]",
      studyJournalEntries:
        "id, workspaceId, lessonNoteId, sourceId, createdAt, [workspaceId+createdAt]",
      sourceBlobs: "sourceId, createdAt",
      planBlocks:
        "id, workspaceId, curriculumItemId, sourceId, startTs, status, remindAtTs, [workspaceId+startTs], [workspaceId+status], [workspaceId+remindAtTs]",
      podcasts:
        "id, workspaceId, status, [workspaceId+createdAt], [workspaceId+status]",
      podcastBlobs: "podcastId, createdAt",
      notes:
        "id, workspaceId, folderId, updatedAt, *tags, *wikilinks, [workspaceId+folderId], [workspaceId+updatedAt], [workspaceId+path]",
      noteFolders:
        "id, workspaceId, parentId, [workspaceId+parentId], [workspaceId+path]",
      seedFlags: "id",
    });

    // v23: Phase 6.9 — Notes-as-Source. New `noteId` index on `sources` so
    // `getNoteSourceByNoteId(noteId)` is a single-row equality lookup rather
    // than a full-table scan. `SourceRecord.{noteId, lastEmbeddedContentHash,
    // lastEmbeddedAt}` and `NoteRecord.autoEmbedOnSave` are pure type-level
    // additions — existing rows leave them undefined and readers coalesce
    // (`?? false`, `=== undefined` state-check). The upgrade body is a no-op
    // `count()` touch so Dexie commits a clean transaction; no row rewrite
    // is needed because every existing source already carries a `type`
    // value from prior writes (the v23 union widening with `"note"` only
    // adds a *new* legal value, doesn't change semantics of `"pdf"` etc.).
    this.version(23)
      .stores({
        apiKeys: "provider, updatedAt",
        vault: "id",
        workspaces: "id, updatedAt, archivedAt",
        sources:
          "id, workspaceId, ingestStatus, embeddingStatus, contentHash, noteId, [workspaceId+createdAt], [workspaceId+updatedAt]",
        chunks: "id, sourceId, workspaceId, [sourceId+index]",
        highlights:
          "id, sourceId, chunkId, workspaceId, [sourceId+createdAt]",
        decks: "id, workspaceId",
        flashcards:
          "id, workspaceId, deckId, sourceId, dueAt, [workspaceId+dueAt], [deckId+dueAt]",
        reviewLogs: "id, flashcardId, workspaceId, reviewedAt",
        chatThreads:
          "id, workspaceId, sourceId, pinned, [workspaceId+updatedAt], [sourceId+updatedAt]",
        chatMessages: "id, threadId, workspaceId, createdAt, [threadId+createdAt]",
        quizSessions:
          "id, workspaceId, sourceId, startedAt, [workspaceId+startedAt]",
        concepts:
          "id, workspaceId, labelNorm, [workspaceId+labelNorm], [workspaceId+updatedAt]",
        conceptEdges:
          "id, workspaceId, fromId, toId, [workspaceId+fromId], [workspaceId+toId]",
        curricula: "id, workspaceId, status, [workspaceId+updatedAt]",
        curriculumItems:
          "id, workspaceId, curriculumId, parentId, status, [curriculumId+order], [workspaceId+status]",
        lessonNotes:
          "id, workspaceId, curriculumItemId, status, [workspaceId+createdAt], [curriculumItemId+createdAt]",
        studyJournalEntries:
          "id, workspaceId, lessonNoteId, sourceId, createdAt, [workspaceId+createdAt]",
        sourceBlobs: "sourceId, createdAt",
        planBlocks:
          "id, workspaceId, curriculumItemId, sourceId, startTs, status, remindAtTs, [workspaceId+startTs], [workspaceId+status], [workspaceId+remindAtTs]",
        podcasts:
          "id, workspaceId, status, [workspaceId+createdAt], [workspaceId+status]",
        podcastBlobs: "podcastId, createdAt",
        notes:
          "id, workspaceId, folderId, updatedAt, *tags, *wikilinks, [workspaceId+folderId], [workspaceId+updatedAt], [workspaceId+path]",
        noteFolders:
          "id, workspaceId, parentId, [workspaceId+parentId], [workspaceId+path]",
        seedFlags: "id",
      })
      .upgrade(async (tx) => {
        await tx.table("sources").toCollection().count();
      });

    // v24: Phase 9 — Master-password vault removed. Drops the `vault` table
    // (previously held the master-key PBKDF2 salt + verifier + the optional
    // recovery vault metadata) and clears every row in `apiKeys` because
    // pre-Phase-9 entries are AES-GCM ciphertexts that are no longer
    // decryptable without the deleted master key. ApiKeyRecord's TS shape
    // changes from `{provider, ciphertext, iv, recovery*?}` to
    // `{provider, plaintext, updatedAt}`. The schema string is unchanged
    // (only `provider` + `updatedAt` were ever indexed), so the
    // index-rebuild step is a no-op; the data wipe is the whole migration.
    this.version(24)
      .stores({
        vault: null,
      })
      .upgrade(async (tx) => {
        await tx.table("apiKeys").clear();
      });

    // v25: Phase 10 — Dynamic provider models cache. Single new table keyed
    // by `presetId` so a provider has at most one cached catalog row. The
    // `fetchedAt` index lets a future maintenance task purge entries older
    // than the 7-day TTL without scanning the entire table. `baseUrl` is
    // stored on the row (not indexed) so the hook can cache-invalidate when
    // the user points a preset at a different custom endpoint.
    this.version(25).stores({
      providerModelsCache: "presetId, fetchedAt",
    });

    // v26: Phase 11 — ElevenLabs removed (paid, cloud; replaced by local-first
    // Piper sidecar). Drop the stored `elevenlabs` row so it stops appearing
    // in the BYOK Settings list. Schema string is unchanged — only the data
    // wipe matters. The literal union widened in this version drops
    // "elevenlabs" but Dexie stores `provider` as free-form string so legacy
    // rows on disk just won't match the union; the delete here makes the
    // mismatch impossible to observe.
    this.version(26)
      .stores({
        apiKeys: "provider, updatedAt",
      })
      .upgrade(async (tx) => {
        try {
          await tx.table("apiKeys").delete("elevenlabs");
        } catch {
          // First-time installs have no row to delete — the get/delete
          // round-trip just returns undefined which Dexie treats as a no-op.
        }
      });

    // v27: Roadmap feature (replaces Plan). Three new tables:
    //   - `roadmaps`: header row per AI-generated DAG (one workspace can hold
    //     many; the page lists them by `createdAt` desc).
    //   - `roadmapNodes`: graph nodes, `parentId === null` for roots; cap at
    //     depth 2 (root → child → grandchild).
    //   - `roadmapEdges`: directed prerequisite arcs (`from` precedes `to`).
    // Compound `[roadmapId+parentId]` powers the inspector's "siblings of
    // this node" query; `[roadmapId+depth]` powers the empty-state check
    // ("does the roadmap have any subnodes yet?"). The `planBlocks` table
    // is intentionally left intact in v27 so the Plan code can keep
    // compiling during the bring-up of the new feature; v28 below drops
    // the table now that every Plan call site is gone.
    this.version(27).stores({
      roadmaps: "id, workspaceId, createdAt, [workspaceId+createdAt]",
      roadmapNodes:
        "id, roadmapId, parentId, [roadmapId+parentId], [roadmapId+depth]",
      roadmapEdges:
        "id, roadmapId, fromNodeId, toNodeId, [roadmapId+fromNodeId]",
    });

    // v28: Plan feature removed. The `planBlocks` table is dropped along
    // with the calendar / .ics / reminder pipeline. Roadmaps (v27)
    // supersede it — see docs/ROADMAP_FEATURE_SPEC.md. Existing rows are
    // simply discarded; the user opted into a full removal during the
    // Q&A 2026-05-25 and the spec mirrors that decision in §2 row 1.
    this.version(28).stores({
      planBlocks: null,
    });
  }
}

export const db = new TmeDb();
