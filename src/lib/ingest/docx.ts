// Main-thread API for DOCX ingest. Mirrors `parsePdf` exactly: spawns one Web
// Worker per parse job, terminates on completion/cancel, and exposes a
// {promise, cancel} handle. DOCX has no native page model, so `page` stays
// undefined on chunks and the chunker drives sectioning by detected headings.

import { chunkPages, type ChunkerOutput } from "./chunker";
import { htmlToPages } from "./docx-html";

export type DocxParsePhase = "parsing" | "chunking";

export type DocxParseProgress = {
  phase: DocxParsePhase;
  pct: number;
};

export type DocxParsedSource = {
  meta: { pageCount: number; byteSize: number; contentHash: string };
  chunks: ChunkerOutput;
};

export type DocxParseHandle = {
  promise: Promise<DocxParsedSource>;
  cancel: () => void;
};

let jobCounter = 0;
function newJobId(): string {
  jobCounter += 1;
  return `docxj_${Date.now().toString(36)}_${jobCounter}`;
}

export function parseDocx(
  file: File,
  options?: { onProgress?: (p: DocxParseProgress) => void },
): DocxParseHandle {
  const id = newJobId();
  let worker: Worker | null = null;
  let cancelled = false;
  let rejectFn: ((err: Error) => void) | null = null;

  const promise = (async (): Promise<DocxParsedSource> => {
    const buffer = await file.arrayBuffer();
    if (cancelled) throw new Error("cancelled");

    worker = new Worker(new URL("./docx-worker.ts", import.meta.url), {
      type: "module",
    });

    return new Promise<DocxParsedSource>((resolve, reject) => {
      rejectFn = reject;
      const w = worker;
      if (!w) {
        reject(new Error("worker_not_initialized"));
        return;
      }

      const cleanup = (): void => {
        w.removeEventListener("message", handleMessage);
        w.removeEventListener("error", handleError);
        w.terminate();
        worker = null;
      };

      const handleMessage = (e: MessageEvent): void => {
        const msg = e.data as
          | { kind: "progress"; id: string; phase: DocxParsePhase; pct: number }
          | {
              kind: "done";
              id: string;
              meta: DocxParsedSource["meta"];
              chunks: ChunkerOutput;
            }
          | { kind: "error"; id: string; message: string };
        if (!msg || msg.id !== id) return;
        if (msg.kind === "progress") {
          options?.onProgress?.({ phase: msg.phase, pct: msg.pct });
          return;
        }
        if (msg.kind === "done") {
          resolve({ meta: msg.meta, chunks: msg.chunks });
          cleanup();
          return;
        }
        if (msg.kind === "error") {
          reject(new Error(msg.message));
          cleanup();
        }
      };

      const handleError = (e: ErrorEvent): void => {
        reject(new Error(e.message || "docx_worker_error"));
        cleanup();
      };

      w.addEventListener("message", handleMessage);
      w.addEventListener("error", handleError);
      w.postMessage(
        { kind: "parse", id, buffer, byteSize: file.size },
        [buffer],
      );
    });
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      if (worker) {
        worker.terminate();
        worker = null;
      }
      rejectFn?.(new Error("cancelled"));
    },
  };
}

// Re-export the pure transform so tests can drive it directly under jsdom
// without instantiating a real Web Worker.
export { htmlToPages, chunkPages };
