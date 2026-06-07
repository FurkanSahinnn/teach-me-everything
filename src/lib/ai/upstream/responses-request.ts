// Pure builder for the OpenAI Responses API chat upstream call.
// Mirrors `/api/ai/chat-responses/route.ts` — the proxy forwards the
// client body verbatim to `https://api.openai.com/v1/responses` with the
// user's bearer token. In Tauri mode the client builds the same call
// directly. The body shape (input / instructions / max_output_tokens /
// tools[{type:"web_search"}]) is constructed by the provider client; the
// builder only injects auth headers + URL.

export type ResponsesProxyBody = {
  model?: string;
  input?: unknown;
  instructions?: unknown;
  max_output_tokens?: number;
  tools?: unknown;
  [key: string]: unknown;
};

export type ResponsesUpstreamRequest = {
  url: string;
  headers: Record<string, string>;
  body: string;
};

export type ResponsesUpstreamError = {
  code: "invalid_shape" | "missing_key";
  message: string;
};

export type ResponsesUpstreamResult =
  | { ok: true; request: ResponsesUpstreamRequest }
  | { ok: false; error: ResponsesUpstreamError };

export function buildResponsesUpstream(
  body: ResponsesProxyBody,
  apiKey: string,
): ResponsesUpstreamResult {
  if (!apiKey || apiKey.length === 0) {
    return { ok: false, error: { code: "missing_key", message: "API anahtarı gerekli." } };
  }
  if (typeof body.model !== "string" || body.model.length === 0) {
    return { ok: false, error: { code: "invalid_shape", message: "model alanı eksik." } };
  }
  if (!Array.isArray(body.input) && typeof body.input !== "string") {
    return { ok: false, error: { code: "invalid_shape", message: "input alanı eksik." } };
  }
  return {
    ok: true,
    request: {
      url: "https://api.openai.com/v1/responses",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
  };
}
