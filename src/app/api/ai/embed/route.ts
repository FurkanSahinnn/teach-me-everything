// Edge proxy for embedding providers. Forwards the user's BYOK key from
// `Authorization: Bearer <key>` to the upstream provider's auth header.
// The key is read from the request and used inline only — never logged,
// never echoed, never persisted.
//
// Family branching, not provider branching, because the same upstream shape
// (OpenAI-compat) serves multiple providers (mistral now, deepseek/together
// later) without a route edit. Auth header swap + URL build are the only
// deltas we control; body shape is already correct because the adapter built
// it. Local provider ids (ollama / lm-studio / llama-cpp) are rejected here
// — they bypass the proxy in adapter code via isLocalUrl().

export const runtime = "edge";
export const dynamic = "force-dynamic";

type EmbedFamilyKey =
  | "openai"
  | "voyage"
  | "google-gemini"
  | "cohere"
  | "jina"
  | "huggingface"
  | "mistral"
  | "openrouter";

type ParsedBody = Record<string, unknown>;

type FamilyAdapter = {
  resolveUrl: (body: ParsedBody) => string | { error: string };
  authHeader: (key: string) => Record<string, string>;
  forwardBody: (body: ParsedBody) => unknown;
};

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

function strip(body: ParsedBody, ...keys: string[]): ParsedBody {
  const out: ParsedBody = {};
  const drop = new Set(keys);
  for (const k of Object.keys(body)) {
    if (!drop.has(k)) out[k] = body[k];
  }
  return out;
}

const FAMILY_ADAPTERS: Record<EmbedFamilyKey, FamilyAdapter> = {
  openai: {
    resolveUrl: () => "https://api.openai.com/v1/embeddings",
    authHeader: (k) => ({ authorization: `Bearer ${k}` }),
    forwardBody: (b) => strip(b, "provider"),
  },
  voyage: {
    resolveUrl: () => "https://api.voyageai.com/v1/embeddings",
    authHeader: (k) => ({ authorization: `Bearer ${k}` }),
    forwardBody: (b) => strip(b, "provider"),
  },
  "google-gemini": {
    // Endpoint embeds the model id; the body's top-level `model` is only
    // used for URL construction — strip before forwarding so Gemini's
    // batchEmbedContents schema validator doesn't reject the extra key.
    resolveUrl: (b) =>
      typeof b.model === "string" && b.model.length > 0
        ? `https://generativelanguage.googleapis.com/v1beta/models/${b.model}:batchEmbedContents`
        : { error: "google-gemini requires body.model for endpoint construction" },
    authHeader: (k) => ({ "x-goog-api-key": k }),
    forwardBody: (b) => strip(b, "provider", "model"),
  },
  cohere: {
    resolveUrl: () => "https://api.cohere.com/v2/embed",
    authHeader: (k) => ({ authorization: `Bearer ${k}` }),
    forwardBody: (b) => strip(b, "provider"),
  },
  jina: {
    resolveUrl: () => "https://api.jina.ai/v1/embeddings",
    authHeader: (k) => ({ authorization: `Bearer ${k}` }),
    forwardBody: (b) => strip(b, "provider"),
  },
  huggingface: {
    // HF feature-extraction endpoint embeds the model id under the
    // hf-inference router; body ships `inputs` + `options`, so model must
    // be stripped post-URL build.
    resolveUrl: (b) =>
      typeof b.model === "string" && b.model.length > 0
        ? `https://router.huggingface.co/hf-inference/models/${b.model}/pipeline/feature-extraction`
        : { error: "huggingface requires body.model for endpoint construction" },
    authHeader: (k) => ({ authorization: `Bearer ${k}` }),
    forwardBody: (b) => strip(b, "provider", "model"),
  },
  mistral: {
    resolveUrl: () => "https://api.mistral.ai/v1/embeddings",
    authHeader: (k) => ({ authorization: `Bearer ${k}` }),
    forwardBody: (b) => strip(b, "provider"),
  },
  openrouter: {
    resolveUrl: () => "https://openrouter.ai/api/v1/embeddings",
    authHeader: (k) => ({ authorization: `Bearer ${k}` }),
    forwardBody: (b) => strip(b, "provider"),
  },
};

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ ok: false, code, error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  const key = match?.[1]?.trim();
  if (!key) {
    return jsonError(401, "missing_key", "API anahtarı gerekli.");
  }

  let body: ParsedBody;
  try {
    body = (await req.json()) as ParsedBody;
  } catch {
    return jsonError(400, "invalid_body", "Geçersiz JSON gövdesi.");
  }

  const provider = typeof body.provider === "string" ? body.provider : "openai";

  if (LOCAL_PROVIDERS.has(provider)) {
    return jsonError(
      400,
      "proxy_local_forbidden",
      `Local provider "${provider}" must bypass the proxy and call localhost directly.`,
    );
  }
  if (provider.startsWith("custom:")) {
    return jsonError(
      400,
      "custom_endpoint_forbidden",
      "Custom endpoints stay client-direct; the proxy is preset-only.",
    );
  }

  const family = PROVIDER_TO_FAMILY[provider];
  if (!family) {
    return jsonError(400, "provider_not_allowed", `Provider not allowed: ${provider}`);
  }

  const adapter = FAMILY_ADAPTERS[family];
  const urlResult = adapter.resolveUrl(body);
  if (typeof urlResult !== "string") {
    return jsonError(400, "invalid_shape", urlResult.error);
  }

  let upstream: Response;
  try {
    upstream = await fetch(urlResult, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...adapter.authHeader(key),
      },
      body: JSON.stringify(adapter.forwardBody(body)),
    });
  } catch (err) {
    return jsonError(
      502,
      "network",
      err instanceof Error ? err.message : "Network failure",
    );
  }

  if (!upstream.ok) {
    let message = `HTTP ${upstream.status}`;
    let code = "upstream_error";
    if (upstream.status === 401) code = "unauthorized";
    else if (upstream.status === 429) code = "rate_limited";
    try {
      const errBody = (await upstream.clone().json()) as {
        error?: { message?: string } | string;
      };
      if (typeof errBody.error === "string") message = errBody.error;
      else if (errBody.error?.message) message = errBody.error.message;
    } catch {
      /* ignore */
    }
    return jsonError(upstream.status || 502, code, message);
  }

  // Stream-through the JSON response. Don't read the body server-side — that
  // would buffer the (potentially large) embedding payload through our edge.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
