// Pure builder for the `/api/ai/embed` upstream request. Mirrors the
// family-adapter logic in `src/app/api/ai/embed/route.ts` so the Tauri
// client can call providers directly. Local providers (ollama / lm-studio
// / llama-cpp) and custom: endpoints are rejected here for parity with
// the proxy — adapter code already bypasses the proxy for those via
// `isLocalUrl()`.

export type EmbedFamilyKey =
  | "openai"
  | "voyage"
  | "google-gemini"
  | "cohere"
  | "jina"
  | "huggingface"
  | "mistral"
  | "openrouter";

export type EmbedProxyBody = {
  provider?: string;
  model?: string;
  [key: string]: unknown;
};

export type EmbedUpstreamRequest = {
  url: string;
  headers: Record<string, string>;
  body: string;
};

export type EmbedUpstreamError = {
  code:
    | "missing_key"
    | "invalid_shape"
    | "proxy_local_forbidden"
    | "custom_endpoint_forbidden"
    | "provider_not_allowed";
  message: string;
};

export type EmbedUpstreamResult =
  | { ok: true; request: EmbedUpstreamRequest }
  | { ok: false; error: EmbedUpstreamError };

const PROVIDER_TO_FAMILY: Record<string, EmbedFamilyKey> = {
  openai: "openai",
  voyage: "voyage",
  "google-gemini": "google-gemini",
  cohere: "cohere",
  jina: "jina",
  huggingface: "huggingface",
  mistral: "mistral",
  openrouter: "openrouter",
};

const LOCAL_PROVIDERS = new Set(["ollama", "lm-studio", "llama-cpp"]);

function strip(body: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const drop = new Set(keys);
  for (const k of Object.keys(body)) {
    if (!drop.has(k)) out[k] = body[k];
  }
  return out;
}

type FamilyAdapter = {
  resolveUrl: (body: EmbedProxyBody) => string | { error: string };
  authHeader: (key: string) => Record<string, string>;
  forwardBody: (body: EmbedProxyBody) => Record<string, unknown>;
};

const FAMILY_ADAPTERS: Record<EmbedFamilyKey, FamilyAdapter> = {
  openai: {
    resolveUrl: () => "https://api.openai.com/v1/embeddings",
    authHeader: (k) => ({ authorization: `Bearer ${k}` }),
    forwardBody: (b) => strip(b, ["provider"]),
  },
  voyage: {
    resolveUrl: () => "https://api.voyageai.com/v1/embeddings",
    authHeader: (k) => ({ authorization: `Bearer ${k}` }),
    forwardBody: (b) => strip(b, ["provider"]),
  },
  "google-gemini": {
    resolveUrl: (b) =>
      typeof b.model === "string" && b.model.length > 0
        ? `https://generativelanguage.googleapis.com/v1beta/models/${b.model}:batchEmbedContents`
        : { error: "google-gemini requires body.model for endpoint construction" },
    authHeader: (k) => ({ "x-goog-api-key": k }),
    forwardBody: (b) => strip(b, ["provider", "model"]),
  },
  cohere: {
    resolveUrl: () => "https://api.cohere.com/v2/embed",
    authHeader: (k) => ({ authorization: `Bearer ${k}` }),
    forwardBody: (b) => strip(b, ["provider"]),
  },
  jina: {
    resolveUrl: () => "https://api.jina.ai/v1/embeddings",
    authHeader: (k) => ({ authorization: `Bearer ${k}` }),
    forwardBody: (b) => strip(b, ["provider"]),
  },
  huggingface: {
    resolveUrl: (b) =>
      typeof b.model === "string" && b.model.length > 0
        ? `https://router.huggingface.co/hf-inference/models/${b.model}/pipeline/feature-extraction`
        : { error: "huggingface requires body.model for endpoint construction" },
    authHeader: (k) => ({ authorization: `Bearer ${k}` }),
    forwardBody: (b) => strip(b, ["provider", "model"]),
  },
  mistral: {
    resolveUrl: () => "https://api.mistral.ai/v1/embeddings",
    authHeader: (k) => ({ authorization: `Bearer ${k}` }),
    forwardBody: (b) => strip(b, ["provider"]),
  },
  openrouter: {
    // OpenAI-compatible embeddings endpoint; body ships `{ model, input }`.
    resolveUrl: () => "https://openrouter.ai/api/v1/embeddings",
    authHeader: (k) => ({ authorization: `Bearer ${k}` }),
    forwardBody: (b) => strip(b, ["provider"]),
  },
};

export function buildEmbedUpstream(
  body: EmbedProxyBody,
  apiKey: string,
): EmbedUpstreamResult {
  if (!apiKey || apiKey.length === 0) {
    return { ok: false, error: { code: "missing_key", message: "API anahtarı gerekli." } };
  }
  const provider = typeof body.provider === "string" ? body.provider : "openai";

  if (LOCAL_PROVIDERS.has(provider)) {
    return {
      ok: false,
      error: {
        code: "proxy_local_forbidden",
        message: `Local provider "${provider}" must bypass the proxy and call localhost directly.`,
      },
    };
  }
  if (provider.startsWith("custom:")) {
    return {
      ok: false,
      error: {
        code: "custom_endpoint_forbidden",
        message: "Custom endpoints stay client-direct; the proxy is preset-only.",
      },
    };
  }

  const family = PROVIDER_TO_FAMILY[provider];
  if (!family) {
    return {
      ok: false,
      error: { code: "provider_not_allowed", message: `Provider not allowed: ${provider}` },
    };
  }

  const adapter = FAMILY_ADAPTERS[family];
  const urlResult = adapter.resolveUrl(body);
  if (typeof urlResult !== "string") {
    return { ok: false, error: { code: "invalid_shape", message: urlResult.error } };
  }
  return {
    ok: true,
    request: {
      url: urlResult,
      headers: {
        "content-type": "application/json",
        ...adapter.authHeader(apiKey),
      },
      body: JSON.stringify(adapter.forwardBody(body)),
    },
  };
}
