// HuggingFace Inference embedding adapter. Web mode routes through
// `/api/ai/embed`; Tauri mode hits the HF Inference Router directly via
// `embedFetch` (the model id is embedded into the URL path by the
// shared embed-upstream builder).

import { embedFetch } from "@/lib/ai/upstream/embed-fetch";
import {
  ProviderError,
  type EmbedProvider,
  type EmbedRequest,
  type EmbedResult,
} from "./types";

export const DEFAULT_HF_MODEL = "BAAI/bge-m3";

const DIM_BY_MODEL: Record<string, number> = {
  "BAAI/bge-m3": 1024,
  "intfloat/multilingual-e5-large": 1024,
};

// HF Inference API rate-limits aggressively on the free tier; smaller batches
// reduce 429s vs OpenAI's 96.
const BATCH_SIZE = 32;
const RETRY_DELAYS_MS = [200, 800, 3200];

type EmbedBatchInput = {
  apiKey: string;
  model: string;
  input: string[];
  signal: AbortSignal | undefined;
};

export class HuggingFaceEmbedProvider implements EmbedProvider {
  readonly id = "huggingface" as const;

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const model = req.model || DEFAULT_HF_MODEL;
    const dim = this.dimFor(model);

    if (!req.apiKey) {
      throw new ProviderError(401, "missing_key", "API anahtarı gerekli.");
    }
    if (req.inputs.length === 0) {
      return { vectors: [], model, dim };
    }

    const out: Float32Array[] = new Array(req.inputs.length);

    for (let start = 0; start < req.inputs.length; start += BATCH_SIZE) {
      const slice = req.inputs.slice(start, start + BATCH_SIZE);
      const vectors = await embedWithRetry({
        apiKey: req.apiKey,
        model,
        input: slice,
        signal: req.signal,
      });
      if (vectors.length !== slice.length) {
        throw new ProviderError(
          502,
          "shape",
          `Embedding shape mismatch: got ${vectors.length}, expected ${slice.length}`,
        );
      }
      for (let i = 0; i < vectors.length; i += 1) {
        out[start + i] = vectors[i] as Float32Array;
      }
    }

    return { vectors: out, model, dim };
  }

  dimFor(model: string): number {
    return DIM_BY_MODEL[model] ?? 1024;
  }
}

async function embedWithRetry(req: EmbedBatchInput): Promise<Float32Array[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await embedBatch(req);
    } catch (err) {
      lastErr = err;
      if (req.signal?.aborted) throw err;
      const code = err instanceof ProviderError ? err.status : 0;
      const retryable = code === 429 || (code >= 500 && code < 600) || code === 0;
      if (!retryable || attempt === RETRY_DELAYS_MS.length) throw err;
      const delay = RETRY_DELAYS_MS[attempt] ?? 1000;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("embed_unknown");
}

async function embedBatch(req: EmbedBatchInput): Promise<Float32Array[]> {
  let response: Response;
  try {
    response = await embedFetch(
      {
        provider: "huggingface",
        model: req.model,
        inputs: req.input,
        options: { wait_for_model: true },
      },
      req.apiKey,
      { signal: req.signal },
    );
  } catch (err) {
    throw new ProviderError(
      0,
      "network",
      err instanceof Error ? err.message : "Network failure",
    );
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    let code = "upstream_error";
    try {
      const errBody = (await response.json()) as {
        code?: string;
        error?: string;
      };
      if (errBody.code) code = errBody.code;
      if (errBody.error) message = errBody.error;
    } catch {
      /* ignore */
    }
    throw new ProviderError(response.status, code, message);
  }

  const json = (await response.json()) as unknown;
  // HF feature-extraction returns a top-level array, not {data: [...]}. With a
  // single input some pipelines flatten to number[]; normalize to number[][].
  // Defensive: HF can return {error: "Model loading"} with HTTP 200, or null —
  // collapse non-array bodies to [] so the outer count check converts them
  // into a clean shape error instead of a runtime crash.
  const raw: unknown[] = Array.isArray(json) ? json : [];
  const rows: number[][] =
    raw.length > 0 && !Array.isArray(raw[0])
      ? [raw as number[]]
      : (raw as number[][]);
  return rows.map((arr) => new Float32Array(arr ?? []));
}
