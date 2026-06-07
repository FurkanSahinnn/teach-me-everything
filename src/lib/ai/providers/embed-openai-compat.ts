// Generic OpenAI-compatible embedding adapter. Two operating modes:
// - Cloud (Mistral, Together, etc.): POST /api/ai/embed via the Edge proxy.
// - Local (Ollama on loopback / LAN): POST directly to ${baseUrl}/embeddings,
//   bypassing the proxy so the prompt + response never leave the user's
//   machine. Detection mirrors the chat adapter — baseUrl + isLocal flag set
//   at construction time, validated by isLocalUrl() at the registry layer.

import { embedFetch } from "@/lib/ai/upstream/embed-fetch";
import { isLocalUrl } from "./local-bypass";
import {
  ProviderError,
  type EmbedProvider,
  type EmbedRequest,
  type EmbedResult,
  type ProviderId,
} from "./types";

const DIM_BY_MODEL: Record<string, number> = {
  "mistral-embed": 1024,
  "nomic-embed-text": 768,
  "mxbai-embed-large": 1024,
  "bge-m3": 1024,
  // OpenRouter passes OpenAI's embedding models through unchanged.
  "openai/text-embedding-3-small": 1536,
  "openai/text-embedding-3-large": 3072,
};

const BATCH_SIZE = 96;
const RETRY_DELAYS_MS = [200, 800, 3200];

export type OpenAICompatEmbedOptions = {
  providerId: ProviderId;
  baseUrl?: string;
  isLocal?: boolean;
};

type EmbedBatchInput = {
  apiKey: string;
  model: string;
  input: string[];
  signal: AbortSignal | undefined;
  providerId: ProviderId;
  baseUrl: string | undefined;
  isLocal: boolean;
};

export class OpenAICompatEmbedProvider implements EmbedProvider {
  readonly id: ProviderId;
  private readonly baseUrl: string | undefined;
  private readonly isLocal: boolean;

  constructor(opts: OpenAICompatEmbedOptions) {
    this.id = opts.providerId;
    this.baseUrl = opts.baseUrl;
    // Defense in depth: even if the caller asserts isLocal=true, refuse to
    // bypass the proxy unless the baseUrl actually parses as loopback/LAN.
    this.isLocal = !!opts.isLocal && !!opts.baseUrl && isLocalUrl(opts.baseUrl);
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const model = req.model;
    const dim = this.dimFor(model);

    // Local providers (Ollama) accept empty keys; cloud providers require one.
    if (!req.apiKey && !this.isLocal) {
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
        providerId: this.id,
        baseUrl: this.baseUrl,
        isLocal: this.isLocal,
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
    if (req.isLocal && req.baseUrl) {
      // Local mode (Ollama/LAN): direct call, never touches the proxy, sends
      // the canonical OpenAI embeddings shape (no `provider` discriminator).
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (req.apiKey) headers.authorization = `Bearer ${req.apiKey}`;
      response = await fetch(`${req.baseUrl}/embeddings`, {
        method: "POST",
        ...(req.signal ? { signal: req.signal } : {}),
        headers,
        body: JSON.stringify({ model: req.model, input: req.input }),
      });
    } else {
      // Cloud mode (Mistral / OpenRouter / …): embedFetch routes through the
      // Edge proxy on web and DIRECTLY to the upstream on Tauri (where the
      // `/api/*` proxy doesn't exist). The previous hard-coded
      // fetch("/api/ai/embed") 404'd in the desktop build.
      response = await embedFetch(
        { provider: req.providerId, model: req.model, input: req.input },
        req.apiKey,
        req.signal ? { signal: req.signal } : {},
      );
    }
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
      // `error` can be a plain string OR a nested object `{ message, code }`
      // (OpenAI/OpenRouter shape). Assigning the object straight to `message`
      // would surface "[object Object]".
      const errBody = (await response.json()) as {
        code?: string;
        error?: string | { message?: string; code?: string } | undefined;
      };
      if (errBody.code) code = errBody.code;
      const e = errBody.error;
      if (typeof e === "string") {
        message = e;
      } else if (e && typeof e === "object") {
        if (typeof e.message === "string" && e.message) message = e.message;
        if (typeof e.code === "string" && e.code) code = e.code;
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
  return data.map((row) => new Float32Array(row.embedding ?? []));
}
