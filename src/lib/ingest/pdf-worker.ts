/// <reference lib="webworker" />

// Web Worker: parses PDF (pdfjs-dist legacy build) + chunks. Keeps the app's main
// thread responsive even on large books. We use the legacy build so pdfjs's own
// worker mechanism is collapsed into this thread (no nested worker spawning),
// which sidesteps Turbopack worker-of-worker resolution issues.

import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
// Side-effect import. pdfjs-dist v5 dropped the older "empty workerSrc =
// fake-worker" shortcut: when the parser is invoked it now dynamically
// imports the worker module to set up its internal MessagePort. In a
// bundler context the dynamic import only resolves if the worker file has
// also been included in the same chunk, which a static `import "..."`
// guarantees. Without this line getDocument throws
// "No GlobalWorkerOptions.workerSrc specified." inside our Web Worker.
import "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { chunkPages, type ChunkerOutput, type ChunkerPage } from "./chunker";

declare const self: DedicatedWorkerGlobalScope;

type Incoming = {
  kind: "parse";
  id: string;
  buffer: ArrayBuffer;
  byteSize: number;
};

type Outgoing =
  | {
      kind: "progress";
      id: string;
      phase: "parsing" | "chunking";
      pct: number;
      page?: number;
    }
  | {
      kind: "done";
      id: string;
      meta: { pageCount: number; byteSize: number; contentHash: string };
      chunks: ChunkerOutput;
    }
  | { kind: "error"; id: string; message: string };

self.addEventListener("message", (e: MessageEvent<Incoming>) => {
  const msg = e.data;
  if (!msg || msg.kind !== "parse") return;
  void runParse(msg);
});

async function runParse(msg: Incoming): Promise<void> {
  const { id, buffer, byteSize } = msg;
  try {
    post({ kind: "progress", id, phase: "parsing", pct: 2 });

    // Hash the original bytes for de-dupe / content-addressed lookup.
    // Clone buffer because pdfjs takes ownership of `data`.
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      buffer.slice(0),
    );
    const contentHash = bufferToHex(hashBuffer);

    const loadingTask = pdfjsLib.getDocument({ data: buffer });
    const doc = await loadingTask.promise;
    const pageCount = doc.numPages;
    const pages: ChunkerPage[] = [];

    for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
      const page = await doc.getPage(pageNum);
      const tc = await page.getTextContent();
      const items = tc.items as Array<{
        str?: string;
        transform?: number[];
        height?: number;
        hasEOL?: boolean;
      }>;

      const lines = groupItemsToLines(items);
      const fontSizes = lines
        .map((l) => l.maxFontSize)
        .filter((v) => v > 0);
      const median = fontSizes.length ? medianOf(fontSizes) : 12;
      const headingThreshold = median * 1.18;

      const textParts: string[] = [];
      const headings: string[] = [];
      for (const line of lines) {
        const text = line.text.trim();
        if (!text) continue;
        textParts.push(text);
        if (
          line.maxFontSize >= headingThreshold &&
          text.length <= 100 &&
          text.length >= 3
        ) {
          headings.push(text);
        }
      }

      pages.push({ page: pageNum, text: textParts.join("\n"), headings });
      page.cleanup();

      const pct = 5 + Math.floor((pageNum / pageCount) * 70);
      post({ kind: "progress", id, phase: "parsing", pct, page: pageNum });
    }

    post({ kind: "progress", id, phase: "chunking", pct: 80 });
    const chunks = chunkPages({ pages });
    post({ kind: "progress", id, phase: "chunking", pct: 96 });

    post({
      kind: "done",
      id,
      meta: { pageCount, byteSize, contentHash },
      chunks,
    });
  } catch (err) {
    post({
      kind: "error",
      id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function post(msg: Outgoing): void {
  self.postMessage(msg);
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const hex: string[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    hex[i] = (bytes[i] as number).toString(16).padStart(2, "0");
  }
  return hex.join("");
}

function medianOf(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 0) {
    const a = sorted[mid - 1] ?? 0;
    const b = sorted[mid] ?? 0;
    return (a + b) / 2;
  }
  return sorted[mid] ?? 0;
}

type LineGroup = { y: number; text: string; maxFontSize: number };

function groupItemsToLines(
  items: Array<{
    str?: string;
    transform?: number[];
    height?: number;
    hasEOL?: boolean;
  }>,
): LineGroup[] {
  const lines: LineGroup[] = [];
  let current: LineGroup | null = null;
  const tolerance = 2;

  for (const it of items) {
    const str = it.str ?? "";
    const y = it.transform?.[5] ?? 0;
    const fontSize = Math.abs(it.transform?.[0] ?? it.height ?? 12);

    if (str === "") {
      if (it.hasEOL && current) {
        lines.push(current);
        current = null;
      }
      continue;
    }

    if (current && Math.abs(current.y - y) <= tolerance) {
      current.text += str;
      if (fontSize > current.maxFontSize) current.maxFontSize = fontSize;
    } else {
      if (current) lines.push(current);
      current = { y, text: str, maxFontSize: fontSize };
    }

    if (it.hasEOL && current) {
      lines.push(current);
      current = null;
    }
  }
  if (current) lines.push(current);
  return lines;
}
