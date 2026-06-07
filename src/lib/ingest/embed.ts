// Main-thread embedding pipeline with per-provider batch sizing and a
// fixed-size concurrency pool.
//
// History: originally ran in a Web Worker (`./embed-worker.ts`) but Tauri's
// `@tauri-apps/plugin-http` reaches into `window.__TAURI_INTERNALS__` for IPC
// and Worker contexts have no `window` — every embed in Tauri mode crashed
// with "ReferenceError: window is not defined" before the first batch
// finished. Embedding is network-bound (1 fetch per batch, negligible CPU),
// so the move to main-thread is free: `await` yields to the event loop
// between batches the same way the worker hand-off used to.
//
// Optimisation layer (added 2026-05-19):
//   1) **Per-provider batch size.** OpenAI accepts up to 2048 inputs per
//      request; Gemini caps at 100; Cohere at 96. The previous flat-64
//      batched a 200-chunk PDF as 4 sequential fetches when one or two
//      would have done the same work.
//   2) **Concurrency pool.** A fixed 3-way pool fires batches in parallel
//      so total wall-clock collapses from sum-of-latencies to
//      max-of-latencies. Embed APIs rate-limit at 3000+ RPM — three
//      in-flight requests is well below any threshold.
//   3) **Monotonic progress.** Progress counter increments per completed
//      batch (not per starting offset) so out-of-order completions still
//      report a monotonically-rising `done`.

import { getEmbedProvider } from "@/lib/ai/providers/registry";
import type { ProviderId } from "@/lib/ai/providers/types";

export type EmbedProgress = { done: number; total: number };

export type EmbedJobResult = {
  model: string;
  providerId: ProviderId;
  // dim is included so the caller can pass setChunkEmbedding's 3.3.D opts
  // ({ dim, provider }) directly without re-measuring vectors.
  dim: number;
  embeddings: Array<{ id: string; vector: Float32Array }>;
};

export type EmbedJobHandle = {
  promise: Promise<EmbedJobResult>;
  cancel: () => void;
};

export type EmbedJobInput = {
  apiKey: string;
  providerId: ProviderId;
  model: string;
  chunks: Array<{ id: string; text: string }>;
  onProgress?: (p: EmbedProgress) => void;
};

// 64 is the safe lower bound across providers (Cohere/Jina/HF cap there).
// Per-provider overrides take advantage of larger documented limits without
// pushing into per-call rate-limit territory.
const DEFAULT_BATCH = 64;
const BATCH_BY_PROVIDER: Partial<Record<ProviderId, number>> = {
  openai: 256, // docs allow 2048 but 256 keeps single-request latency sane
  "google-gemini": 100, // batchEmbedContents max is exactly 100
  cohere: 96,
  jina: 128,
  voyage: 128,
  mistral: 128,
};

// Three in-flight batches is well under every provider's RPM ceiling and
// keeps memory pressure (one in-flight vector array per worker) trivial.
const CONCURRENCY = 3;

function getBatchSize(providerId: ProviderId): number {
  return BATCH_BY_PROVIDER[providerId] ?? DEFAULT_BATCH;
}

export function embedSourceChunks(input: EmbedJobInput): EmbedJobHandle {
  const state = { cancelled: false };
  let rejectFn: ((err: Error) => void) | null = null;

  const promise = new Promise<EmbedJobResult>((resolve, reject) => {
    rejectFn = reject;
    void runEmbed(input, state).then(
      (result) => {
        if (state.cancelled) return;
        resolve(result);
      },
      (err: unknown) => {
        if (state.cancelled) return;
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });

  return {
    promise,
    cancel: () => {
      state.cancelled = true;
      rejectFn?.(new Error("cancelled"));
    },
  };
}

type Batch = {
  // Stable index into `input.chunks` so out-of-order completions still
  // write vectors back at the right slot in `output`.
  startIndex: number;
  chunks: Array<{ id: string; text: string }>;
};

async function runEmbed(
  input: EmbedJobInput,
  state: { cancelled: boolean },
): Promise<EmbedJobResult> {
  const { apiKey, providerId, model, chunks, onProgress } = input;
  const total = chunks.length;

  if (total === 0) {
    return { model, providerId, dim: 0, embeddings: [] };
  }

  const embedder = getEmbedProvider(providerId);
  const batchSize = getBatchSize(providerId);

  const batches: Batch[] = [];
  for (let i = 0; i < total; i += batchSize) {
    batches.push({ startIndex: i, chunks: chunks.slice(i, i + batchSize) });
  }

  // Pre-allocated, position-stable output. Parallel workers fill their own
  // slots so we never need a lock or post-sort step.
  const output: Array<{ id: string; vector: Float32Array } | undefined> =
    new Array(total);
  let dim = 0;
  let done = 0;

  // Shared error slot — first worker to fail flags it; the others observe
  // and exit before issuing another fetch. Mirrors the "first error wins"
  // semantics of Promise.all without leaving zombie in-flight requests
  // unconsumed.
  const sharedError: { error: Error | null } = { error: null };

  let nextBatchIdx = 0;

  async function worker(): Promise<void> {
    while (true) {
      if (state.cancelled || sharedError.error) return;
      const myIdx = nextBatchIdx;
      if (myIdx >= batches.length) return;
      nextBatchIdx = myIdx + 1;
      const batch = batches[myIdx];
      if (!batch) return;

      let result;
      try {
        result = await embedder.embed({
          apiKey,
          model,
          inputs: batch.chunks.map((c) => c.text),
        });
      } catch (err) {
        if (!sharedError.error) {
          sharedError.error =
            err instanceof Error ? err : new Error(String(err));
        }
        return;
      }

      if (state.cancelled || sharedError.error) return;

      for (let i = 0; i < batch.chunks.length; i += 1) {
        const chunk = batch.chunks[i];
        const vec = result.vectors[i];
        if (chunk && vec) {
          output[batch.startIndex + i] = { id: chunk.id, vector: vec };
          if (dim === 0) dim = vec.length;
        }
      }
      done += batch.chunks.length;
      onProgress?.({ done: Math.min(done, total), total });
    }
  }

  // Pool size capped at min(CONCURRENCY, batches.length) so tiny jobs
  // (e.g. a single short note) don't spin up idle workers.
  const poolSize = Math.min(CONCURRENCY, batches.length);
  const workers: Array<Promise<void>> = [];
  for (let w = 0; w < poolSize; w += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);

  if (sharedError.error) throw sharedError.error;
  if (state.cancelled) throw new Error("cancelled");

  // Filter undefined entries — possible if a worker bailed mid-batch on
  // cancellation between vector-write and the loop continuation. Doesn't
  // happen on success paths but cheap to guard.
  const embeddings = output.filter(
    (v): v is { id: string; vector: Float32Array } => v !== undefined,
  );
  return { model, providerId, dim, embeddings };
}
