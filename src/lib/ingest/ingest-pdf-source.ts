import {
  createSource,
  setEmbeddingStatus,
  setIngestStatus,
  updateSource,
} from "@/lib/db/sources";
import { bulkAddChunks } from "@/lib/db/chunks";
import { saveSourceBlob } from "@/lib/db/source-blobs";
import { parsePdf, type ParseHandle, type ParsePhase } from "@/lib/ingest/pdf";

// Minimal "drop a PDF, get a ready source" ingest used by the Article Analysis
// generate modal. It deliberately does the parse → chunk → persist half of the
// full SourceUploader pipeline but SKIPS embedding: whole-document analysis
// reads chunks via listChunksBySource (not RAG/topKChunks), so vectors aren't
// needed to analyze. The source is left embeddingStatus:"missing" so the user
// can still embed it later (Settings → Embedding) to enable reader/chat RAG.
// Constraining the entry point to a user-dropped PDF avoids the "analyze a
// non-article source" footgun of picking from the mixed Sources list.

export type IngestPdfProgress = {
  phase: ParsePhase;
  pct: number;
};

export type IngestPdfResult = {
  sourceId: string;
  title: string;
};

export type IngestPdfHandle = {
  promise: Promise<IngestPdfResult>;
  cancel: () => void;
};

export class IngestPdfError extends Error {
  constructor(
    public code: "no_text" | "cancelled" | "parse_failed",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "IngestPdfError";
  }
}

/**
 * Parse + chunk a dropped PDF into a fresh, ready-to-analyze workspace source.
 * Resolves with the new source id + a display title (the file name sans
 * extension). Cancellable mid-parse; on cancel/failure the half-built source
 * is stamped ingestStatus:"error" so it never lingers as a stuck "parsing" row.
 */
export function ingestPdfForAnalysis(
  file: File,
  workspaceId: string,
  onProgress?: (p: IngestPdfProgress) => void,
): IngestPdfHandle {
  let parseHandle: ParseHandle | null = null;
  let cancelled = false;

  const title = file.name.replace(/\.[^.]+$/, "");

  const promise = (async (): Promise<IngestPdfResult> => {
    const source = await createSource({
      workspaceId,
      type: "pdf",
      title,
      byteSize: file.size,
      ingestStatus: "parsing",
    });
    const sid = source.id;

    try {
      let lastPhase: ParsePhase | null = null;
      parseHandle = parsePdf(file, {
        onProgress: (p) => {
          if (cancelled) return;
          onProgress?.({ phase: p.phase, pct: p.pct });
          if (p.phase !== lastPhase) {
            lastPhase = p.phase;
            void setIngestStatus(sid, p.phase);
          }
        },
      });
      const parsed = await parseHandle.promise;
      if (cancelled) throw new IngestPdfError("cancelled");

      if (parsed.chunks.length === 0) {
        throw new IngestPdfError(
          "no_text",
          "The PDF produced no extractable text (likely a scanned image).",
        );
      }

      await bulkAddChunks(
        parsed.chunks.map((c) => ({
          sourceId: sid,
          workspaceId,
          index: c.index,
          text: c.text,
          tokenCount: c.tokenCount,
          page: c.page,
          section: c.section,
          headings: c.headings,
        })),
      );

      await updateSource(sid, {
        pageCount: parsed.meta.pageCount,
        contentHash: parsed.meta.contentHash,
        byteSize: parsed.meta.byteSize,
      });

      // Best-effort: keep the original bytes so the reader can render the PDF
      // visually too. A quota/private-mode failure just hides the "Original
      // PDF" toggle; the chunked analysis works regardless.
      try {
        await saveSourceBlob(sid, file);
      } catch {
        // ignore
      }

      await setIngestStatus(sid, "ready");
      await setEmbeddingStatus(sid, "missing");

      return { sourceId: sid, title };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await setIngestStatus(sid, "error", msg);
      } catch {
        // best-effort; surface the original error to the caller regardless
      }
      if (err instanceof IngestPdfError) throw err;
      throw new IngestPdfError("parse_failed", msg);
    }
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      parseHandle?.cancel();
    },
  };
}
