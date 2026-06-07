// Google Gemini embedding adapter. Web mode goes through `/api/ai/embed`
// (which rewrites the auth to `x-goog-api-key`); Tauri mode hits Gemini's
// batchEmbedContents endpoint directly via `embedFetch`. Mirror of
// OpenAIEmbedProvider so retry/shape semantics stay identical.

import { embedFetch } from "@/lib/ai/upstream/embed-fetch";
import {
  ProviderError,
  type EmbedProvider,
  type EmbedRequest,
  type EmbedResult,
} from "./types";

export const DEFAULT_GEMINI_EMBED_MODEL = "gemini-embedding-2";

const DIM_BY_MODEL: Record<string, number> = {
  "gemini-embedding-2": 3072,
  "gemini-embedding-001": 3072,
  // Retired, but kept so legacy chunks report the right dim.
  "text-embedding-004": 768,
};

const BATCH_SIZE = 96;
const RETRY_DELAYS_MS = [200, 800, 3200];

type EmbedBatchInput = {
  apiKey: string;
  model: string;
  input: string[];
  signal: AbortSignal | undefined;
};

export class GeminiEmbedProvider implements EmbedProvider {
  readonly id = "google-gemini" as const;

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const model = req.model || DEFAULT_GEMINI_EMBED_MODEL;
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
    return DIM_BY_MODEL[model] ?? 768;
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
        provider: "google-gemini",
        model: req.model,
        // Gemini batchEmbedContents wire shape: each request repeats the
        // model path under "models/" and wraps text in content.parts[].text.
        requests: req.input.map((text) => ({
          model: `models/${req.model}`,
          content: { parts: [{ text }] },
        })),
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
      // Gemini returns `error` as a nested object `{ code, message, status }`
      // (and the proxy may pass it through). The old code assigned the object
      // straight to `message`, surfacing "[object Object]" instead of the real
      // reason (rate limit / quota / bad key).
      const errBody = (await response.json()) as {
        code?: string;
        error?:
          | string
          | { message?: string; code?: number | string; status?: string }
          | undefined;
      };
      if (errBody.code) code = errBody.code;
      const e = errBody.error;
      if (typeof e === "string") {
        message = e;
      } else if (e && typeof e === "object") {
        if (typeof e.message === "string" && e.message) message = e.message;
        if (typeof e.status === "string" && e.status) code = e.status;
      }
    } catch {
      /* ignore */
    }
    throw new ProviderError(response.status, code, message);
  }

  const json = (await response.json()) as {
    embeddings?: Array<{ values?: number[] }>;
  };
  const data = json.embeddings ?? [];
  return data.map((row) => {
    const arr = row.values ?? [];
    return new Float32Array(arr);
  });
}
