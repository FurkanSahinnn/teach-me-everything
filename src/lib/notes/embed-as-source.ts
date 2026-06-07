/**
 * Phase 6.9.2 — Embed a user-authored note as a RAG source.
 *
 * Public entry point for the editor toolbar's "Embed as source" button:
 * given a noteId and an `EmbedderHandle`, this orchestrator
 *
 *   1. resolves (or creates) the linked SourceRecord,
 *   2. short-circuits when the note hash matches the source's last
 *      embedded hash (no-op re-runs cost nothing),
 *   3. chunks the markdown via the existing PDF/DOCX chunker (the chunker
 *      is content-agnostic — pages[] with a single page works fine for
 *      markdown),
 *   4. reuses embeddings from chunks whose text is unchanged
 *      (content-hash-cache by text-equality, since a chunk's identity is
 *      its body — see Phase 6.9 skill `content-hash-cache-pattern`),
 *   5. embeds only the new/changed chunks via the injected provider,
 *   6. atomically replaces the source's chunk rows + writes
 *      `lastEmbeddedContentHash` so the toolbar button flips to ✓ Embedded.
 *
 * Embedder is injected (not pulled from the `getEmbedProvider` registry)
 * so tests can mock without touching the network and so the toolbar
 * button can apply any per-workspace model-binding without this module
 * depending on `prefs` or `useApiKeyManager`.
 *
 * Returned metrics drive the success-toast ("Embedded — N chunks, $0.02")
 * and the auto-sync cost guard (6.9.5).
 */

import type { ChunkRecord } from "@/lib/db/types";
import { chunkPages } from "@/lib/ingest/chunker";
import { db } from "@/lib/db/schema";
import { getNote } from "@/lib/db/notes";
import {
  createNoteSource,
  getNoteSourceByNoteId,
  markNoteSourceSynced,
} from "@/lib/db/sources";
import { newId } from "@/lib/utils/id";
import { computeNoteHash, estimateTokenCount } from "./source-sync";

/**
 * Provider-agnostic embedder interface. The toolbar button wires this to a
 * concrete `EmbedProvider` from the AI registry; tests pass a stub.
 *
 * Notes:
 *   • `embed(inputs)` must preserve order — `vectors[i]` is the embedding
 *     for `inputs[i]`. Throws if the provider returns a different length.
 *   • `pricePerMillionTokensUsd` is optional; when absent the result's
 *     `costUsd` is reported as 0 (used for free-tier providers like
 *     Ollama / Jina free tier).
 */
export type EmbedderHandle = {
  embed(inputs: string[]): Promise<Float32Array[]>;
  providerId: string;
  model: string;
  pricePerMillionTokensUsd?: number;
};

export type EmbedNoteResult = {
  sourceId: string;
  /** Total chunks the note now has (reused + freshly embedded). */
  chunkCount: number;
  /** How many chunks needed a fresh embed call (post cache reuse). */
  embedsRun: number;
  /** Approximate token count for the freshly-embedded chunks only. */
  tokensUsed: number;
  /** Approximate USD cost of the fresh embed pass. 0 when the provider is
   *  free-tier or when nothing was re-embedded. */
  costUsd: number;
  /** True when the note hash matched the source's stored hash and nothing
   *  was re-chunked or re-embedded. */
  reused: boolean;
};

export async function embedNoteAsSource(
  noteId: string,
  embedder: EmbedderHandle,
): Promise<EmbedNoteResult> {
  const note = await getNote(noteId);
  if (!note) {
    throw new Error(`embedNoteAsSource: note ${noteId} not found`);
  }

  // 1. Resolve-or-create the linked source.
  let source = await getNoteSourceByNoteId(noteId);
  if (!source) {
    source = await createNoteSource({
      noteId: note.id,
      workspaceId: note.workspaceId,
    });
  }
  const sourceId = source.id;

  // 2. Hash-based fast path. If nothing changed since the last embed,
  // skip the chunker + provider call entirely.
  const fullHash = await computeNoteHash(note.content);
  if (source.lastEmbeddedContentHash === fullHash) {
    const chunkCount = await db.chunks
      .where("sourceId")
      .equals(sourceId)
      .count();
    return {
      sourceId,
      chunkCount,
      embedsRun: 0,
      tokensUsed: 0,
      costUsd: 0,
      reused: true,
    };
  }

  // 3. Chunk the markdown. The PDF/DOCX chunker is text-agnostic; a single
  // "page" with the full note content is the simplest possible adapter.
  // Phase 7 (filesystem .md export) will keep this contract — markdown
  // pages are conceptually one big page until paging becomes meaningful.
  const chunked = chunkPages({
    pages: [{ page: 1, text: note.content }],
  });

  // Defensive: a fully-empty note produces no chunks. Mark the source as
  // synced against the (empty) hash so the button still reads "synced"
  // and the next sync compares to this baseline rather than re-running.
  if (chunked.length === 0) {
    await db.transaction("rw", db.chunks, db.sources, async () => {
      await db.chunks.where("sourceId").equals(sourceId).delete();
      await markNoteSourceSynced(sourceId, fullHash);
    });
    return {
      sourceId,
      chunkCount: 0,
      embedsRun: 0,
      tokensUsed: 0,
      costUsd: 0,
      reused: false,
    };
  }

  // 4. Per-chunk content-hash cache. Key on the chunk *text*: two chunks
  // with identical body produce identical embeddings (provider + model
  // permitting), so we can carry forward the existing vector without
  // calling the provider. Mismatched chunks (new text, edited body) fall
  // through to the embed pass.
  const existingChunks = await db.chunks
    .where("sourceId")
    .equals(sourceId)
    .toArray();
  const cache = new Map<string, Float32Array>();
  for (const c of existingChunks) {
    if (c.embedding) cache.set(c.text, c.embedding);
  }

  const toEmbed: Array<{ index: number; text: string }> = [];
  const embeddingsByIndex = new Map<number, Float32Array>();
  for (const c of chunked) {
    const cached = cache.get(c.text);
    if (cached) {
      embeddingsByIndex.set(c.index, cached);
    } else {
      toEmbed.push({ index: c.index, text: c.text });
    }
  }

  // 5. Embed the misses. Provider may batch internally — we hand it the
  // full slice and rely on the `EmbedderHandle.embed` contract to keep
  // ordering. Tokens approximated via char/4 (see estimateTokenCount).
  let tokensUsed = 0;
  if (toEmbed.length > 0) {
    const inputs = toEmbed.map((c) => c.text);
    const vectors = await embedder.embed(inputs);
    if (vectors.length !== toEmbed.length) {
      throw new Error(
        `embedNoteAsSource: provider returned ${vectors.length} vectors for ${toEmbed.length} inputs`,
      );
    }
    for (let i = 0; i < toEmbed.length; i += 1) {
      const entry = toEmbed[i]!;
      const vec = vectors[i]!;
      embeddingsByIndex.set(entry.index, vec);
      tokensUsed += estimateTokenCount(entry.text);
    }
  }

  // 6. Atomic chunk swap + source bookkeeping. We rewrite the chunk set
  // wholesale rather than incrementally diff: rows are cheap, and a full
  // replace guarantees stale chunks from a longer prior version can't
  // linger when the note shrinks.
  const now = Date.now();
  const newChunks: ChunkRecord[] = chunked.map((c) => {
    const embedding = embeddingsByIndex.get(c.index);
    const record: ChunkRecord = {
      id: newId("chunk"),
      sourceId,
      workspaceId: note.workspaceId,
      index: c.index,
      text: c.text,
      tokenCount: c.tokenCount,
      page: c.page,
      section: c.section,
      headings: c.headings,
      embedding,
      embeddingProvider: embedder.providerId,
      embeddingModel: embedder.model,
      embeddingDim: embedding?.length,
      createdAt: now,
    };
    return record;
  });

  await db.transaction("rw", db.chunks, db.sources, async () => {
    await db.chunks.where("sourceId").equals(sourceId).delete();
    await db.chunks.bulkAdd(newChunks);
    await markNoteSourceSynced(sourceId, fullHash);
  });

  const costUsd =
    embedder.pricePerMillionTokensUsd && embedder.pricePerMillionTokensUsd > 0
      ? (tokensUsed / 1_000_000) * embedder.pricePerMillionTokensUsd
      : 0;

  return {
    sourceId,
    chunkCount: newChunks.length,
    embedsRun: toEmbed.length,
    tokensUsed,
    costUsd,
    reused: false,
  };
}
