import type { ContentLangMode } from "@/lib/ai/content-language";
import type { WebCitation } from "@/lib/ai/web-search/types";

export type SourceType =
  | "pdf"
  | "docx"
  | "epub"
  | "md"
  | "txt"
  | "rtf"
  | "image"
  | "youtube"
  | "arxiv"
  | "doi"
  | "url"
  // Phase 6.9 — Notes-as-Source. A user-authored markdown note (Phase 6
  // vault) that opted into the embedding pipeline via the "Embed as source"
  // editor toolbar button. Distinct from `"md"` (external markdown file
  // imported as a source) because note-sources stay live: the linked
  // `NoteRecord` remains editable in the CM6 vault, and re-syncs trigger
  // chunk-level content-hash diffs rather than a full re-ingest.
  | "note";

export type IngestStatus =
  | "pending"
  | "parsing"
  | "chunking"
  | "ready"
  | "error";

export type EmbeddingStatus =
  | "missing"
  | "queued"
  | "embedding"
  | "ready"
  | "skipped"
  | "error";

export type Rating = "again" | "hard" | "good" | "easy";

export type WorkspaceRecord = {
  id: string;
  name: string;
  nameEn?: string | undefined;
  color: string;
  initials: string;
  goal?: string | undefined;
  goalEn?: string | undefined;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
};

export type SourceRecord = {
  id: string;
  workspaceId: string;
  type: SourceType;
  title: string;
  titleEn?: string | undefined;
  author?: string | undefined;
  url?: string | undefined;
  contentHash?: string | undefined;
  byteSize?: number | undefined;
  pageCount?: number | undefined;
  ingestStatus: IngestStatus;
  errorMessage?: string | undefined;
  embeddingStatus?: EmbeddingStatus | undefined;
  embeddingError?: string | undefined;
  embeddingProvider?: string | undefined;
  embeddingModel?: string | undefined;
  meta?: Record<string, unknown> | undefined;
  // Phase 6.9 — Notes-as-Source. Populated only when `type === "note"`;
  // FK to `notes.id` (no cascade index — deleteNote() resolves the linked
  // source via `getNoteSourceByNoteId` and calls deleteSource() directly).
  noteId?: string | undefined;
  // sha256 of the linked note's content at the last successful embed.
  // Drives the toolbar button's `synced` vs `dirty` state machine: if the
  // current note hash matches, button shows ✓ Embedded; otherwise ⚠ Sync.
  lastEmbeddedContentHash?: string | undefined;
  // Wall-clock ms timestamp of the last successful embed. Surfaces in the
  // "Last synced X ago" tooltip and lets E2E tests assert progress.
  lastEmbeddedAt?: number | undefined;
  createdAt: number;
  updatedAt: number;
};

export type SourceBlobRecord = {
  sourceId: string;
  blob: Blob;
  contentType: string;
  byteSize: number;
  createdAt: number;
};

export type ChunkRecord = {
  id: string;
  sourceId: string;
  workspaceId: string;
  index: number;
  text: string;
  tokenCount: number;
  page?: number | undefined;
  section?: string | undefined;
  headings?: string[] | undefined;
  embeddingModel?: string | undefined;
  embeddingDim?: number | undefined;
  embeddingProvider?: string | undefined;
  embedding?: Float32Array | undefined;
  createdAt: number;
};

export type HighlightRecord = {
  id: string;
  sourceId: string;
  workspaceId: string;
  chunkId?: string | undefined;
  text: string;
  userNote?: string | undefined;
  color: string;
  spanStart: number;
  spanEnd: number;
  createdAt: number;
  updatedAt: number;
};

export type DeckRecord = {
  id: string;
  workspaceId: string;
  name: string;
  nameEn?: string | undefined;
  color: string;
  // Content-language provenance for AI-generated decks (Phase: content
  // language). `"both"` means the deck's cards carry parallel `*En` fields and
  // the cards view should surface the local TR/EN view toggle. Optional +
  // non-indexed → no schema bump, no migration.
  langMode?: ContentLangMode | undefined;
  createdAt: number;
  updatedAt: number;
};

export type FlashcardRecord = {
  id: string;
  workspaceId: string;
  deckId?: string | undefined;
  sourceId?: string | undefined;
  chunkId?: string | undefined;
  question: string;
  questionEn?: string | undefined;
  answer: string;
  answerEn?: string | undefined;
  tags: string[];
  citations?:
    | { sourceId?: string; section?: string; quote?: string }[]
    | undefined;

  ease: number;
  interval: number;
  repetitions: number;
  dueAt: number;
  lastReviewedAt: number | null;
  lastRating: Rating | null;
  reviewCount: number;
  successCount: number;
  againCount: number;
  leech: boolean;
  // Lifetime count of "again" ratings — canonical leech-detection signal
  // (>= 8 → leech). Schema v4 backfills existing rows to 0; new rows write
  // it on every applyReview. Distinct from `againCount` only by name; kept
  // explicit so the leech threshold is self-documenting.
  lapses?: number | undefined;

  // Provenance for AI-generated cards. `kind: "chat"` came from the inline
  // "Karta çevir" action on a chat message; `"batch"` came from
  // GenerateBatchModal over a chunk selection; `"manual"` rows leave this
  // field undefined (Schema v10 type-only — no index, no migration body).
  generatedFrom?:
    | {
        kind: "chat" | "batch";
        chunkIds?: string[];
        threadId?: string;
        model?: string;
        generatedAt: number;
      }
    | undefined;

  // Content-language provenance (Phase: content language). `"both"` means the
  // card carries parallel `*En` fields and the cards view should offer the
  // local TR/EN toggle. Optional + non-indexed → no schema bump, no migration.
  langMode?: ContentLangMode | undefined;

  createdAt: number;
  updatedAt: number;
};

export type ReviewLogRecord = {
  id: string;
  flashcardId: string;
  workspaceId: string;
  rating: Rating;
  intervalBefore: number;
  intervalAfter: number;
  easeBefore: number;
  easeAfter: number;
  reviewedAt: number;
  // Wall-clock milliseconds the user spent on this card (reveal → rate).
  // Optional because pre-Phase-4 logs do not record it; downstream callers
  // (`useDashboardStats` study minutes) coalesce missing rows to 0.
  durationMs?: number | undefined;
};

export type ChatThreadRecord = {
  id: string;
  workspaceId: string;
  sourceId?: string | undefined;
  title: string;
  titleEn?: string | undefined;
  pinned: boolean;
  renamedAt?: number | undefined;
  // Workspace Chat — discriminator separating the cross-source workspace chat
  // (`sourceId === undefined`) from the single-source reader chat. Optional +
  // non-indexed → no Dexie migration; legacy rows leave it undefined and the
  // workspace-thread list filters to `scope === "workspace"`, while the reader
  // chat's existing `listThreadsBySource` query is unaffected. New writes set
  // `"source"` when a sourceId is present and `"workspace"` otherwise.
  scope?: "workspace" | "source" | undefined;
  // Workspace Chat — the active context chips for this thread (e.g.
  // ["sources", "notes"]). Persisted per thread so reopening a workspace chat
  // restores the user's grounding toggles. Optional + non-indexed.
  contextScopes?: string[] | undefined;
  // Workspace Chat — when the user narrows retrieval to specific sources, the
  // chosen source ids. Empty/absent means ALL workspace sources (the default,
  // backward-compatible). A non-empty array restricts RAG to just those
  // sources. Optional + non-indexed, like `contextScopes`; no Dexie migration.
  selectedSourceIds?: string[] | undefined;
  createdAt: number;
  updatedAt: number;
};

export type ChatRole = "user" | "assistant" | "tool";

export type ChatMessageRecord = {
  id: string;
  threadId: string;
  workspaceId: string;
  role: ChatRole;
  content: string;
  contentEn?: string | undefined;
  citations?:
    | {
        sourceId?: string;
        chunkId?: string;
        section?: string;
        quote?: string;
      }[]
    | undefined;
  toolName?: string | undefined;
  toolArgs?: Record<string, unknown> | undefined;
  toolUseId?: string | undefined;
  toolStatus?: "pending" | "ok" | "error" | undefined;
  tokensIn?: number | undefined;
  tokensOut?: number | undefined;
  cacheReadTokens?: number | undefined;
  cacheCreationTokens?: number | undefined;
  model?: string | undefined;
  stopReason?: string | undefined;
  interrupted?: boolean | undefined;
  // Phase 5.5 — set to true when the assistant turn used a native LLM web
  // search tool (Claude `web_search_20260209`, OpenAI Responses `web_search`,
  // Gemini `google_search`, Perplexity Sonar, Grok, Mistral Agents, or the
  // OpenRouter `:online` plugin). Stored separately from the citations array
  // so a message with zero results still reports "search ran but found
  // nothing" to the reader UI.
  webSearchUsed?: boolean | undefined;
  webCitations?: WebCitation[] | undefined;
  createdAt: number;
};

export type SeedFlagRecord = {
  id: "dev-seed";
  appliedAt: number;
  version: number;
};

// Wikilink reference parsed out of note content. `target` is the literal
// label written between the brackets ("My Note", "source:abc", "concept:xyz"),
// kept verbatim so a missing target can be rendered with the user's exact
// wording and recreated on click. `kind` is derived from the prefix; unknown
// prefixes fall back to "note" (the default namespace).
export type WikilinkKind = "note" | "source" | "concept";

export type WikilinkRef = {
  target: string;
  kind: WikilinkKind;
  alias?: string | undefined;
};

// Workspace-bound markdown note (Phase 6). Content is plain markdown — no
// provider-specific format — so Phase 7 (Tauri) can dump each note to a
// real `.md` file on disk via `note.path`. `tags` and `wikilinks` are
// denormalised at write time so the multiEntry indexes on the table can
// answer backlink + tag-panel queries in O(matches) without a full scan.
export type NoteRecord = {
  id: string;
  workspaceId: string;
  // Zero-or-one folder. `null` (or undefined) means the note lives at the
  // vault root. Stored as `null` rather than missing so the compound
  // `[workspaceId+folderId]` index has a stable bucket for root notes.
  folderId: string | null;
  title: string;
  content: string;
  // Denormalised inline `#tag` parse — multiEntry indexed. Lowercased on
  // write so the tag panel can dedupe `#Kimya` and `#kimya`.
  tags: string[];
  // Denormalised `[[...]]` refs — multiEntry indexed on the target string
  // so backlinks query (`notes.where('wikilinks').equals(target)`) is cheap.
  // Stored as the bracket target (`"My Note"`, `"source:abc"`) verbatim.
  wikilinks: string[];
  // Full breadcrumb path string — folder path + slugified title. Phase 7
  // turns this into a filesystem path; Phase 6 only uses it for display
  // and stable identity across rename-sweep. Indexed via `[workspaceId+path]`.
  path: string;
  // Phase 6.9 — Notes-as-Source. When true, autosaves trigger a debounced
  // re-embed against the linked note-source (if one exists). Default off;
  // users opt in per-note via the toolbar dropdown next to the embed button.
  // Stored optional + read with `?? false` so v22 rows treat it as absent.
  autoEmbedOnSave?: boolean | undefined;
  createdAt: number;
  updatedAt: number;
};

// Hierarchical folder node. `parentId === null` means the folder lives at
// the vault root. `path` mirrors the breadcrumb (e.g. "Daily" or
// "Reading/2026"); the repo recomputes it on every move/rename so the
// `[workspaceId+path]` index stays consistent without callers tracking it.
export type NoteFolderRecord = {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  path: string;
  createdAt: number;
};
