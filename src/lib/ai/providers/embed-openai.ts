// OpenAI embedding adapter. In web mode it goes through the
// `/api/ai/embed` Edge proxy (BYOK key forwarded server-side). In Tauri
// mode `embedFetch` routes the same proxyBody directly to OpenAI via
// `@tauri-apps/plugin-http` — the key never lands in our DB or logs in
// either mode.

import { embedFetch } from "@/lib/ai/upstream/embed-fetch";
import {
  ProviderError,
  type EmbedProvider,
  type EmbedRequest,
  type EmbedResult,
} from "./types";

export const DEFAULT_EMBED_MODEL = "text-embedding-3-small";

const DIM_BY_MODEL: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
};

const BATCH_SIZE = 96;
const RETRY_DELAYS_MS = [200, 800, 3200];

type EmbedBatchInput = {
  apiKey: string;
  model: string;
  input: string[];
  signal: AbortSignal | undefined;
};

export class OpenAIEmbedProvider implements EmbedProvider {
  readonly id = "openai" as const;

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const model = req.model || DEFAULT_EMBED_MODEL;
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
    return DIM_BY_MODEL[model] ?? 1536;
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
      { provider: "openai", model: req.model, input: req.input },
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
      // OpenAI (and the proxy that forwards it) return `error` as EITHER a
      // plain string OR a nested object `{ message, type, code }`. The old
      // code assigned the object straight to `message`, which stringified to
      // "[object Object]" and buried the real reason (bad key, quota, etc.).
      const errBody = (await response.json()) as {
        code?: string;
        error?:
          | string
          | { message?: string; code?: string; type?: string }
          | undefined;
      };
      if (errBody.code) code = errBody.code;
      const e = errBody.error;
      if (typeof e === "string") {
        message = e;
      } else if (e && typeof e === "object") {
        if (typeof e.message === "string" && e.message) message = e.message;
        if (typeof e.code === "string" && e.code) code = e.code;
        else if (typeof e.type === "string" && e.type) code = e.type;
      }
    } catch {
      /* ignore */
    }
    throw new ProviderError(response.status, code, message);
  }

  const json = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const data = json.data ?? [];
  return data.map((row) => {
    const arr = row.embedding ?? [];
    return new Float32Array(arr);
  });
}
