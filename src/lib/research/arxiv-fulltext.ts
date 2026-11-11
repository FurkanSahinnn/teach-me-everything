import { bulkAddChunks, listChunksBySource } from "@/lib/db/chunks";
import { db } from "@/lib/db/schema";
import { saveSourceBlob } from "@/lib/db/source-blobs";
import type { ChunkRecord, SourceRecord } from "@/lib/db/types";
import { parsePdf } from "@/lib/ingest/pdf";
import { smartFetch } from "@/lib/tauri/fetch";

const MAX_PDF_BYTES = 40 * 1024 * 1024;

function arxivPdfUrl(source: SourceRecord): string {
  const id = source.meta?.arxivId;
  if (typeof id !== "string" || !/^[a-zA-Z0-9./-]+$/.test(id)) {
    throw new Error("The arXiv source has no valid paper ID. Add the full PDF to analyze it.");
  }
  return `https://arxiv.org/pdf/${id.split("/").map(encodeURIComponent).join("/")}`;
}

// arXiv URL imports originally contained only the Atom abstract. Upgrade that
// source on the first analysis. Keep its old chunk IDs so older citations still
// work; append the PDF pages and mark embeddings stale for a later re-embed.
export async function ensureArxivFullText(
  source: SourceRecord,
  existing: ChunkRecord[],
  signal?: AbortSignal,
): Promise<ChunkRecord[]> {
  if (source.type !== "arxiv" || source.meta?.extractor !== "arxiv-api") return existing;
  const url = arxivPdfUrl(source);
  let response: Response;
  try {
    response = await smartFetch(url, { ...(signal ? { signal } : {}) });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("Could not download the full arXiv PDF. Add the PDF file to analyze the paper in detail.", { cause: error });
  }
  if (!response.ok) throw new Error(`Could not download the arXiv PDF (${response.status}). Add the full PDF to analyze it.`);
  const announcedSize = Number(response.headers.get("content-length"));
  if (announcedSize > MAX_PDF_BYTES) throw new Error("The arXiv PDF is too large to analyze. Add a smaller PDF.");
  const blob = await response.blob();
  if (blob.size > MAX_PDF_BYTES || blob.size < 5) throw new Error("The arXiv PDF is missing or too large. Add the full PDF to analyze it.");
  const signature = new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer());
  if (signature !== "%PDF-") throw new Error("arXiv did not return a PDF. Add the full PDF to analyze it.");
  const file = new File([blob], `${String(source.meta.arxivId).replaceAll("/", "_")}.pdf`, { type: "application/pdf" });
  const handle = parsePdf(file);
  const cancel = () => handle.cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  let parsed: Awaited<typeof handle.promise>;
  try {
    parsed = await handle.promise;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
  if (signal?.aborted) throw new Error("Analysis aborted");
  if (parsed.chunks.length === 0) throw new Error("The arXiv PDF has no extractable text. Add a text-based PDF to analyze it.");

  await db.transaction("rw", db.sources, db.chunks, async () => {
    const current = await db.sources.get(source.id);
    if (current?.meta?.extractor !== "arxiv-api") return;
    const chunks = await listChunksBySource(source.id);
    const offset = Math.max(-1, ...chunks.map((chunk) => chunk.index)) + 1;
    await bulkAddChunks(parsed.chunks.map((chunk) => ({
      sourceId: source.id,
      workspaceId: source.workspaceId,
      index: offset + chunk.index,
      text: chunk.text,
      tokenCount: chunk.tokenCount,
      page: chunk.page,
      section: chunk.section,
      headings: chunk.headings,
    })));
    await db.sources.update(source.id, {
      pageCount: parsed.meta.pageCount,
      byteSize: parsed.meta.byteSize,
      contentHash: parsed.meta.contentHash,
      embeddingStatus: "missing",
      meta: { ...current.meta, extractor: "arxiv-pdf", pdfUrl: url },
      updatedAt: Date.now(),
    });
  });
  try { await saveSourceBlob(source.id, file); } catch { /* text is already indexed */ }
  return listChunksBySource(source.id);
}
