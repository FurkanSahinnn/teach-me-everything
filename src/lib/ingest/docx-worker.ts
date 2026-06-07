/// <reference lib="webworker" />

// Web Worker: parses DOCX (mammoth browser bundle) into HTML, hands the HTML
// to the pure `htmlToPages` transform, then chunks. DOCX is page-less so
// `page` carries our synthetic h1-grouped section index instead.
//
// Mammoth's pre-built browser bundle (`mammoth/mammoth.browser.min.js`)
// bundles all of mammoth's deps for use in workers / browsers. We import the
// minified bundle to keep the worker chunk small. The UMD attaches the API
// either at the namespace root or via `default` depending on bundler interop —
// we probe both.

import mammoth from "mammoth/mammoth.browser.min.js";
import { chunkPages, type ChunkerOutput } from "./chunker";
import { htmlToPages } from "./docx-html";

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

type MammothLike = {
  convertToHtml: (
    input: { arrayBuffer: ArrayBuffer },
  ) => Promise<{ value: string; messages: unknown[] }>;
};

async function runParse(msg: Incoming): Promise<void> {
  const { id, buffer, byteSize } = msg;
  try {
    post({ kind: "progress", id, phase: "parsing", pct: 2 });

    // Hash bytes before mammoth claims the buffer.
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer.slice(0));
    const contentHash = bufferToHex(hashBuffer);

    post({ kind: "progress", id, phase: "parsing", pct: 10 });

    const m = mammoth as unknown as { default?: MammothLike } & MammothLike;
    const lib: MammothLike = m.default ?? m;
    const result = await lib.convertToHtml({ arrayBuffer: buffer });
    const html = result.value || "";

    post({ kind: "progress", id, phase: "parsing", pct: 60 });

    const pages = htmlToPages(html);

    post({ kind: "progress", id, phase: "chunking", pct: 80 });
    const chunks = chunkPages({ pages });
    post({ kind: "progress", id, phase: "chunking", pct: 96 });

    post({
      kind: "done",
      id,
      meta: {
        pageCount: pages.length, // logical "pages" = top-level h1 section count
        byteSize,
        contentHash,
      },
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
