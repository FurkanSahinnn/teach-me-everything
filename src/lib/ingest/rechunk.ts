// Re-chunk existing sources with the current chunker.
//
// Why this exists: until 2026-09 the chunker dropped every blank line and
// trimmed every line, so the markdown structure of every source ingested
// before then is gone from `chunks.text` — and cannot be recovered from it.
// The only way back is to re-derive the chunks from what the app still holds:
// the original file blob (PDF / DOCX / MD / TXT uploads), the live note
// (note-sources), or the URL (research sources, re-fetched).
//
// Embeddings do not survive a re-chunk — the rows they hung on are replaced —
// so every re-chunked source is left as `embeddingStatus: "missing"` for the
// existing Reembed flow to pick up. Highlights keep their `chunkId`; the
// reader already tolerates a dangling one (it falls back to text matching).

import { bulkAddChunks, deleteChunksBySource } from "@/lib/db/chunks";
import { getNote } from "@/lib/db/notes";
import { db } from "@/lib/db/schema";
import { getSourceBlob, hasSourceBlob } from "@/lib/db/source-blobs";
import { listSources, setEmbeddingStatus } from "@/lib/db/sources";
import type { SourceRecord } from "@/lib/db/types";
import { fetchResearchContent } from "@/lib/research/ingest";
import { classifyUrl } from "@/lib/research/url-classifier";
import { chunkPages, type ChunkerOutput } from "./chunker";
import { parseDocx } from "./docx";
import { parsePdf, parsePlainText } from "./pdf";

export type RechunkStrategy = "blob" | "note" | "refetch" | "unsupported";

export type RechunkSkipReason = "no_blob" | "no_url" | "no_note" | "type";

export type RechunkPlanItem = {
  source: SourceRecord;
  strategy: RechunkStrategy;
  reason?: RechunkSkipReason | undefined;
};

export type RechunkReport = {
  done: RechunkPlanItem[];
  skipped: RechunkPlanItem[];
  failed: Array<{ item: RechunkPlanItem; message: string }>;
};

const BLOB_TYPES = new Set<SourceRecord["type"]>(["pdf", "docx", "md", "txt"]);
const URL_TYPES = new Set<SourceRecord["type"]>(["url", "arxiv", "doi", "youtube"]);

/** Pure: which route can rebuild this source's chunks, if any. */
export function chooseRechunkStrategy(
  source: Pick<SourceRecord, "type"> & Partial<Pick<SourceRecord, "url" | "noteId">>,
  hasBlob: boolean,
): { strategy: RechunkStrategy; reason?: RechunkSkipReason } {
  if (source.type === "note") {
    return source.noteId
      ? { strategy: "note" }
      : { strategy: "unsupported", reason: "no_note" };
  }
  if (BLOB_TYPES.has(source.type)) {
    return hasBlob
      ? { strategy: "blob" }
      : { strategy: "unsupported", reason: "no_blob" };
  }
  if (URL_TYPES.has(source.type)) {
    return source.url
      ? { strategy: "refetch" }
      : { strategy: "unsupported", reason: "no_url" };
  }
  return { strategy: "unsupported", reason: "type" };
}

export async function planRechunk(workspaceId: string): Promise<RechunkPlanItem[]> {
  const sources = await listSources(workspaceId);
  const items: RechunkPlanItem[] = [];
  for (const source of sources) {
    if (source.ingestStatus !== "ready") continue;
    const hasBlob = BLOB_TYPES.has(source.type) ? await hasSourceBlob(source.id) : false;
    const choice = chooseRechunkStrategy(source, hasBlob);
    items.push({
      source,
      strategy: choice.strategy,
      ...(choice.reason ? { reason: choice.reason } : {}),
    });
  }
  return items;
}

export type RechunkRunOptions = {
  signal?: AbortSignal | undefined;
  /** BYOK key for the web research provider, when the source came through one. */
  webApiKey?: string | undefined;
  onProgress?: ((done: number, total: number, current: SourceRecord) => void) | undefined;
};

export async function runRechunk(
  workspaceId: string,
  opts: RechunkRunOptions = {},
): Promise<RechunkReport> {
  const plan = await planRechunk(workspaceId);
  const runnable = plan.filter((p) => p.strategy !== "unsupported");
  const report: RechunkReport = {
    done: [],
    skipped: plan.filter((p) => p.strategy === "unsupported"),
    failed: [],
  };

  let done = 0;
  for (const item of runnable) {
    if (opts.signal?.aborted) break;
    opts.onProgress?.(done, runnable.length, item.source);
    try {
      const chunks = await rebuildChunks(item, opts);
      await replaceChunks(item.source, chunks);
      report.done.push(item);
    } catch (err) {
      report.failed.push({
        item,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    done += 1;
    opts.onProgress?.(done, runnable.length, item.source);
  }
  return report;
}

async function rebuildChunks(
  item: RechunkPlanItem,
  opts: RechunkRunOptions,
): Promise<ChunkerOutput> {
  const { source } = item;
  switch (item.strategy) {
    case "note": {
      const note = await getNote(source.noteId ?? "");
      if (!note) throw new Error("note_missing");
      return chunkPages({
        pages: [{ page: 1, text: note.content }],
        format: "markdown",
      });
    }
    case "blob": {
      const blob = await getSourceBlob(source.id);
      if (!blob) throw new Error("blob_missing");
      const name = `${source.title || "source"}.${source.type}`;
      const file = new File([blob], name, { type: blob.type });
      if (source.type === "pdf") return (await parsePdf(file).promise).chunks;
      if (source.type === "docx") return (await parseDocx(file).promise).chunks;
      return (await parsePlainText(file)).chunks;
    }
    case "refetch": {
      const classified = classifyUrl(source.url ?? "");
      if (classified.kind === "invalid") throw new Error("url_invalid");
      const providerId = source.meta?.researchProvider;
      const fetched = await fetchResearchContent(classified, {
        ...(typeof providerId === "string"
          ? { webProvider: providerId as never }
          : {}),
        ...(opts.webApiKey !== undefined ? { apiKey: opts.webApiKey } : {}),
        ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      });
      return chunkPages({
        pages: [{ page: 1, text: fetched.result.markdown }],
        format: "markdown",
      });
    }
    case "unsupported":
      throw new Error("unsupported");
  }
}

async function replaceChunks(source: SourceRecord, chunks: ChunkerOutput): Promise<void> {
  await db.transaction("rw", db.chunks, db.sources, async () => {
    await deleteChunksBySource(source.id);
    if (chunks.length > 0) {
      await bulkAddChunks(
        chunks.map((c) => ({
          sourceId: source.id,
          workspaceId: source.workspaceId,
          index: c.index,
          text: c.text,
          tokenCount: c.tokenCount,
          page: c.page,
          section: c.section,
          headings: c.headings,
        })),
      );
    }
    // Vectors went with the old rows; the Reembed flow rebuilds them. A
    // note-source also forgets its synced hash so the next sync re-embeds
    // instead of short-circuiting on "content unchanged".
    await setEmbeddingStatus(source.id, "missing");
    if (source.type === "note") {
      await db.sources.update(source.id, {
        lastEmbeddedContentHash: undefined,
        updatedAt: Date.now(),
      });
    }
  });
}
