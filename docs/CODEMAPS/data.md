<!-- Generated: 2026-08-03 | Files scanned: 612 | Token estimate: ~950 -->

# Data Layer

**Dexie v29 / IndexedDB, database name `tme`.** No PostgreSQL, no server DB, no ORM. Schema: [src/lib/db/schema.ts](src/lib/db/schema.ts). Row types: [src/lib/db/types.ts](src/lib/db/types.ts) + per-feature `types.ts`.

## Tables (26)

| Table | PK | Key indexes |
|---|---|---|
| `apiKeys` | provider | updatedAt — web dev only; Tauri uses OS keychain |
| `workspaces` | id | updatedAt, archivedAt |
| `sources` | id | workspaceId, ingestStatus, embeddingStatus, contentHash, **noteId**, [workspaceId+createdAt/updatedAt] |
| `chunks` | id | sourceId, workspaceId, [sourceId+index] — holds `embedding` Float32Array + dim/provider/model |
| `sourceBlobs` | sourceId | createdAt — original binary (1:1 with sources) |
| `highlights` | id | sourceId, chunkId, [sourceId+createdAt] |
| `decks` | id | workspaceId |
| `flashcards` | id | dueAt, [workspaceId+dueAt], [deckId+dueAt] |
| `reviewLogs` | id | flashcardId, reviewedAt |
| `chatThreads` | id | pinned, [workspaceId+updatedAt], [sourceId+updatedAt] |
| `chatMessages` | id | threadId, createdAt, [threadId+createdAt] |
| `quizSessions` | id | [workspaceId+startedAt] — items/answers inline |
| `concepts` | id | labelNorm, [workspaceId+labelNorm] |
| `conceptEdges` | id | [workspaceId+fromId], [workspaceId+toId] |
| `curricula` | id | status, [workspaceId+updatedAt] |
| `curriculumItems` | id | parentId, [curriculumId+order], [workspaceId+status] |
| `lessonNotes` | id | [curriculumItemId+createdAt] |
| `studyJournalEntries` | id | lessonNoteId, [workspaceId+createdAt] |
| `podcasts` | id | [workspaceId+createdAt], [workspaceId+status] |
| `podcastBlobs` | podcastId | createdAt — audio binary |
| `notes` | id | folderId, `*tags`, `*wikilinks` (multiEntry), [workspaceId+path] |
| `noteFolders` | id | parentId, [workspaceId+parentId], [workspaceId+path] |
| `providerModelsCache` | presetId | fetchedAt — 7-day TTL model catalogs |
| `roadmaps` | id | [workspaceId+createdAt] |
| `roadmapNodes` | id | [roadmapId+parentId], [roadmapId+depth] — depth cap 2 |
| `roadmapEdges` | id | [roadmapId+fromNodeId] — directed prerequisite arcs |
| `articleAnalyses` | id | [workspaceId+createdAt], [sourceId+createdAt] — payload as JSON blob |
| `seedFlags` | id | idempotent demo-seed markers |

## Relationships

```
workspace ──┬─ sources ──┬─ chunks (embeddings)
            │            ├─ sourceBlobs (1:1 binary)
            │            ├─ highlights
            │            └─ articleAnalyses
            ├─ decks ─── flashcards ─── reviewLogs
            ├─ chatThreads ─── chatMessages
            ├─ quizSessions
            ├─ concepts ─── conceptEdges (from/to)
            ├─ curricula ─── curriculumItems ─── lessonNotes ─── journalEntries
            ├─ roadmaps ──┬─ roadmapNodes (self-nested, depth ≤ 2)
            │             └─ roadmapEdges (node → node)
            ├─ notes ─── noteFolders (hierarchical)   notes ↔ sources via sources.noteId
            └─ podcasts ─── podcastBlobs (1:1 binary)
```

Cascade deletes are explicit in the repo layer (e.g. `deleteSource()` clears chunks + blob + highlights) — IndexedDB has no FK enforcement.

## Migration History

| v | Change |
|---|---|
| 1–6 | apiKeys/vault bring-up; `ApiKeyProvider` union widened (cloud → local presets) |
| 7 | backfill `chunks.embedding{Dim,Provider,Model}` |
| 8 | `chatMessages.createdAt` top-level index (cost chip live query) |
| 9–10 | `reviewLogs.durationMs`, `flashcards.generatedFrom` type-extensions |
| 11 | + `quizSessions` |
| 12 | + `concepts`, `conceptEdges` |
| 13 | split `sources.embeddingStatus` from `ingestStatus`, backfilled from chunk vectors |
| 14 | + guided-study tables (curricula, items, lessonNotes, journal) |
| 15 | + `sourceBlobs` |
| 16 | + `planBlocks` |
| 17 | + `podcasts`, `podcastBlobs` |
| 18 | planBlocks status/remindAt indexes, backfill `status:"scheduled"` |
| 19–21 | `chatMessages.web*` fields; union widened (diffbot/brightdata, brave) |
| 22 | + `notes`, `noteFolders` |
| 23 | + `sources.noteId` index (Notes-as-Source) |
| **24** | **Phase 9** — drop `vault` table, clear `apiKeys` (ciphertexts undecryptable) |
| 25 | + `providerModelsCache` |
| 26 | delete `elevenlabs` key row |
| 27 | + `roadmaps`, `roadmapNodes`, `roadmapEdges` |
| 28 | **drop `planBlocks`** (Plan feature removed) |
| **29** | + `articleAnalyses` (Article Analysis) |

## Repos — `src/lib/db/`

`workspaces` · `sources` · `chunks` · `highlights` · `flashcards` · `chats` · `study` · `quiz-sessions` · `concepts` · `podcasts` · `notes` · `note-folders` · `roadmaps` · `article-analyses` · `source-blobs` · `api-keys-repo` · `provider-models-repo` · `fts` (full-text) · `hooks` (55 live-query hooks) · `seed`.

## Backup / Restore — `src/lib/backup/`

Current format **BackupV10** (`export.ts` / `import.ts`). Legacy V2–V9 round-trip on import; `planBlocks` discarded from V6–V8 payloads, absent tables restored as `[]`.
**Excluded from backup:** binary blobs (`sourceBlobs`, `podcastBlobs`), the filesystem vault, and API keys.
**Included:** notes, noteFolders, podcasts metadata, roadmaps, articleAnalyses.

## Prefs Store

`src/stores/prefs.ts` — **v24**, Zustand persisted to localStorage. Migrations backfill new keys (v24 added the 3 `analysis*` model bindings). Test coverage: `prefs-migration`, `prefs.cost-migration`, `prefs.research-migration`, `prefs.web-search-migration`, `prefs.daily-notes-migration`, `prefs-vault`.
