// Cohere embedding adapter. Mirrors OpenAI adapter pattern but uses
// Cohere's distinct request shape (texts, input_type, embedding_types)
// and response shape (embeddings.float[]). Web mode routes through
// `/api/ai/embed`; Tauri mode hits Cohere directly via `embedFetch`.

import { embedFetch } from "@/lib/ai/upstream/embed-fetch";
import {
  ProviderError,
  type EmbedProvider,
  type EmbedRequest,
  type EmbedResult,
} from "./types";

export const DEFAULT_COHERE_MODEL = "embed-multilingual-v3.0";

const DIM_BY_MODEL: Record<string, number> = {
  "embed-multilingual-v3.0": 1024,
};

const BATCH_SIZE = 96;
const RETRY_DELAYS_MS = [200, 800, 3200];

type EmbedBatchInput = {
  apiKey: string;
  model: string;
  input: string[];
  signal: AbortSignal | undefined;
};

export class CohereEmbedProvider implements EmbedProvider {
  readonly id = "cohere" as const;

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const model = req.model || DEFAULT_COHERE_MODEL;
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
        provider: "cohere",
        model: req.model,
        // Cohere expects `texts` (not `input`); v3 models require explicit
        // input_type + embedding_types.
        texts: req.input,
        input_type: "search_document",
        embedding_types: ["float"],
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

  const json = (await response.json()) as {
    embeddings?: { float?: number[][] };
  };
  // Missing embeddings.float surfaces as an empty result; the outer count
  // check in embed() converts it into a non-retryable shape error. Throwing
  // here would re-enter the retry loop and re-consume the already-read body.
  const floatRows = json.embeddings?.float ?? [];
  return floatRows.map((arr) => new Float32Array(arr ?? []));
}
