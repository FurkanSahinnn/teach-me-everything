# Data codemap

All user data is local. Structured data is IndexedDB through Dexie 4 (database name `tme`, class `TmeDb`, singleton `db` in `src/lib/db/schema.ts`). Preferences are Zustand persisted to `localStorage`. API keys live in the OS keychain on desktop. No server database exists. Related: [architecture](architecture.md), [backend](backend.md).

## Dexie schema (`src/lib/db/schema.ts`)

Highest `this.version(n)` block in the file: **30**. Earlier blocks are kept (never deleted) so upgrades chain; tables dropped along the way are set to `null` (`vault` in v24 and `planBlocks` in v28 no longer exist). The class declares 29 live tables. Row types: `src/lib/db/types.ts` plus per-feature `types.ts` (`lib/concepts`, `lib/quiz`, `lib/study`, `lib/podcast`, `lib/roadmap`, `lib/article-analysis`, `lib/cross-analysis`).

| Table | Purpose | Key indexes (latest definition) |
|---|---|---|
| `apiKeys` | Web-dev plaintext API keys | PK `provider`; `updatedAt` |
| `workspaces` | Workspaces | `updatedAt`, `archivedAt` |
| `sources` | Imported documents, notes-as-source | `workspaceId`, `ingestStatus`, `embeddingStatus`, `contentHash`, `noteId`, `[workspaceId+createdAt]`, `[workspaceId+updatedAt]` |
| `chunks` | Text chunks and Float32 embeddings | `sourceId`, `workspaceId`, `[sourceId+index]` |
| `highlights` | Reader highlights | `sourceId`, `chunkId`, `[sourceId+createdAt]` |
| `decks`, `flashcards`, `reviewLogs` | SRS cards and reviews | flashcards: `deckId`, `sourceId`, `dueAt`, `[workspaceId+dueAt]`, `[deckId+dueAt]`; reviewLogs: `flashcardId`, `reviewedAt` |
| `chatThreads`, `chatMessages` | Chat history | threads: `sourceId`, `pinned`, `[workspaceId+updatedAt]`, `[sourceId+updatedAt]`; messages: `threadId`, `[threadId+createdAt]` |
| `quizSessions` | Quiz runs | `sourceId`, `[workspaceId+startedAt]` |
| `concepts`, `conceptEdges` | Mind-map graph | concepts: `labelNorm`, `[workspaceId+labelNorm]`; edges: `fromId`, `toId`, `[workspaceId+fromId]`, `[workspaceId+toId]` |
| `curricula`, `curriculumItems`, `lessonNotes`, `studyJournalEntries` | Guided study | items: `curriculumId`, `parentId`, `[curriculumId+order]`; lessonNotes: `curriculumItemId`; journal: `lessonNoteId`, `sourceId` |
| `sourceBlobs` | Original file bytes | PK `sourceId`; `createdAt` |
| `podcasts`, `podcastBlobs` | Podcast metadata and audio | podcasts: `status`, `[workspaceId+createdAt]`, `[workspaceId+status]`; blobs: PK `podcastId` |
| `notes`, `noteFolders` | Markdown notes and folder tree | notes: `folderId`, `updatedAt`, multiEntry `*tags` and `*wikilinks`, `[workspaceId+folderId]`, `[workspaceId+path]` |
| `providerModelsCache` | Cached live model lists | PK `presetId`; `fetchedAt` |
| `roadmaps`, `roadmapNodes`, `roadmapEdges` | Prerequisite DAG | nodes: `roadmapId`, `parentId`, `[roadmapId+depth]`; edges: `fromNodeId`, `toNodeId` |
| `articleAnalyses` | Multi-stage analysis payload | `sourceId`, `[workspaceId+createdAt]`, `[sourceId+createdAt]` |
| `crossAnalyses` | Cross-paper comparisons | multiEntry `*analysisIds`, `[workspaceId+createdAt]` |
| `seedFlags` | One-time seed markers | PK `id` |

Workspace-scoped tables also index `workspaceId`. To change the schema, add a new `this.version(n)` block (additive where possible) and update backup (below) if the table should be exported.

## Repos and hooks (`src/lib/db/`)

- Repos: `workspaces.ts`, `sources.ts`, `chunks.ts`, `highlights.ts`, `flashcards.ts` (decks and reviews too), `chats.ts`, `quiz-sessions.ts`, `concepts.ts` (edges too), `study.ts` (curricula, items, lesson notes, journal), `podcasts.ts` (blobs too), `notes.ts`, `note-folders.ts`, `roadmaps.ts`, `article-analyses.ts`, `cross-analyses.ts`, `source-blobs.ts`, `provider-models-repo.ts`, `api-keys-repo.ts`. `index.ts` re-exports `db` and a subset of repos.
- `hooks.ts`: Dexie live-query hooks (57 exported `use*` functions). `fts.ts`: `searchAll`. `seed.ts`: `seedDevData`, `isDevSeeded`, `clearAllAppData`.
- Workspace deletion cascades across tables inside a transaction in `workspaces.ts`.

## API keys (`src/lib/db/api-keys-repo.ts`)

`setApiKey`, `getApiKey`, `hasApiKey`, `deleteApiKey`, `listStoredProviders` choose a backend per call: `keychain` when `isKeychainAvailable()` (`src/lib/crypto/keychain.ts`, Rust `keychain_*` commands), otherwise `dexie` (`apiKeys` table, plaintext, dev web only). `_setCredentialBackendForTests` pins the backend. The master-password vault no longer exists; `src/stores/vault.ts` is a constant "unlocked" stub for legacy call sites.

## Preferences (`src/stores/prefs.ts`)

- Zustand `persist` to `localStorage` key `tme:prefs`; `PREFS_VERSION = 25` (same file). The whole state is persisted (no `partialize`).
- State groups: appearance (`theme`, `themeFollowsSystem`, `density`, `locale`, `readerWidth`); AI (`preferredAnthropicAuth`, `strictAnthropicAuth`, `aiResponseLocale`, `customEndpoints`, `agentCli` (paths, `claudeHome`/`codexHome`, proxy `env`), `disabledProviders` (hidden from model pickers), `modelBindings` with `DEFAULT_MODEL_BINDINGS`); `webSearchPrefs`, `searchProviders`; `srs`, `costPrefs`, `curriculumGeneration`; `notesUi`; `vault` (`VaultPrefs`: folder path, setup flag, autoSync, conflict policy); `ttsProvider`, `podcastFeatureEnabled`, `autoCheckUpdates`.
- Migration: exported `migratePrefs(persisted, version)` applies cumulative `if (version < N)` steps. A strict `isValidModelBindings` check resets the whole `modelBindings` object when a required key is missing, so new binding keys must be patched in place inside the migration. Tests: `src/stores/prefs*.test.ts`.

## Backup (`src/lib/backup/`)

- `BACKUP_SCHEMA_VERSION = 11` in `export.ts`. `exportBackup()` returns a JSON blob (default filename extension `.tmebak`) with a SHA-256 `integrity` field.
- `import.ts` accepts a contiguous range from `OLDEST_SUPPORTED_BACKUP_VERSION` (2) to `BACKUP_SCHEMA_VERSION`, normalizes older payloads, and backfills arrays missing from older v11 files (roadmaps, analyses).
- Included: workspaces, sources, chunks (embeddings as base64), highlights, decks, flashcards, reviewLogs, chatThreads, chatMessages, quizSessions, concepts, conceptEdges, curricula, curriculumItems, lessonNotes, studyJournalEntries, podcasts, notes, noteFolders, roadmaps, roadmapNodes, roadmapEdges, articleAnalyses, crossAnalyses.
- Excluded: `apiKeys` (never exported), `sourceBlobs`, `podcastBlobs`, `providerModelsCache`, `seedFlags`, prefs in `localStorage`, and vault files on disk.
- A newly exported table needs a new `BackupV<n>` shape, a version bump and import tests.

## Source blobs and storage

`source-blobs.ts` (`saveSourceBlob`, `getSourceBlob`, `hasSourceBlob`, `deleteSourceBlob`) keeps original files for the reader. `src/lib/storage/`: `quota.ts` (`useStorageQuota`, `getQuotaWarningLevel`, `pruneEmbeddings`) and `file-handle.ts` (`pickFile`, `downloadBlob`).

## Vault (`src/lib/vault/`, Tauri only)

Two-way sync between a workspace's notes and a folder of `.md` files; unrelated to the removed master-password vault. `watcher.ts` (fs watch), `reconcile.ts` and `reconcile-dispatch.ts` (apply file events to `notes` / `noteFolders`), `serialize.ts`, `note-path.ts`, `paths.ts` (note to file mapping), `export.ts` (`exportVault`), `atomic-write.ts`, `fs-adapter.ts` (plugin-fs / plugin-dialog wrapper), `lock.ts` and `process-lock.ts` (locks), `watcher-suppression.ts` (ignore own writes), `rename-detect.ts`, `cascade.ts`, `conflict-policy.ts` (`CONFLICT_POLICIES`), `cloud-detect.ts`. Settings live in `usePrefs().vault`; UI in `src/components/vault/` and `src/components/settings/VaultSection.tsx`.
