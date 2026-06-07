// Main-thread API for PDF/text ingest. Spawns one Web Worker per parse job and
// terminates it on completion or cancel. The worker is bundled by Turbopack via
// the standard `new URL('./pdf-worker.ts', import.meta.url)` pattern — no extra
// next.config wiring needed.

import { chunkPages, type ChunkerOutput } from "./chunker";

export type ParsePhase = "parsing" | "chunking";

export type ParseProgress = {
  phase: ParsePhase;
  pct: number;
  page?: number | undefined;
};

export type ParsedSource = {
  meta: { pageCount: number; byteSize: number; contentHash: string };
  chunks: ChunkerOutput;
};

export type ParseHandle = {
  promise: Promise<ParsedSource>;
  cancel: () => void;
};

let jobCounter = 0;
function newJobId(): string {
  jobCounter += 1;
  return `pdfj_${Date.now().toString(36)}_${jobCounter}`;
}

export function parsePdf(
  file: File,
  options?: { onProgress?: (p: ParseProgress) => void },
): ParseHandle {
  const id = newJobId();
  let worker: Worker | null = null;
  let cancelled = false;
  let rejectFn: ((err: Error) => void) | null = null;

  const promise = (async (): Promise<ParsedSource> => {
    const buffer = await file.arrayBuffer();
    if (cancelled) throw new Error("cancelled");

    worker = new Worker(new URL("./pdf-worker.ts", import.meta.url), {
      type: "module",
    });

    return new Promise<ParsedSource>((resolve, reject) => {
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
          | { kind: "progress"; id: string; phase: ParsePhase; pct: number; page?: number }
          | { kind: "done"; id: string; meta: ParsedSource["meta"]; chunks: ChunkerOutput }
          | { kind: "error"; id: string; message: string };
        if (!msg || msg.id !== id) return;
        if (msg.kind === "progress") {
          options?.onProgress?.({
            phase: msg.phase,
            pct: msg.pct,
            page: msg.page,
          });
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
        reject(new Error(e.message || "pdf_worker_error"));
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

// Plain text path for TXT/MD — fast enough to run inline. No worker overhead.
export async function parsePlainText(file: File): Promise<ParsedSource> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const contentHash = bufferToHex(hashBuffer);
  const text = await file.text();
  const chunks = chunkPages({ pages: [{ page: 1, text }] });
  return {
    meta: { pageCount: 1, byteSize: file.size, contentHash },
    chunks,
  };
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const hex: string[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    hex[i] = (bytes[i] as number).toString(16).padStart(2, "0");
  }
  return hex.join("");
}
