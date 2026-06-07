// Phase 5.5.H — OpenAI Responses API proxy.
//
// OpenAI's native `web_search` server tool only exists on `/v1/responses`;
// the existing `/api/ai/chat` proxy is wired to Chat Completions. Rather
// than overloading that proxy with a branch, we run a dedicated route so
// the request body shape, error mapping, and SSE forwarding stay focused
// on Responses-specific semantics.
//
// The proxy is intentionally a thin forward: validate auth + body shape,
// strip nothing, attach Bearer auth, pipe the SSE stream straight back to
// the client. Body translation lives in `OpenAIResponsesChatProvider` on
// the client side so this endpoint never has to know about prefs/models.

export const runtime = "edge";
export const dynamic = "force-dynamic";

type ProxyBody = {
  model?: unknown;
  input?: unknown;
  instructions?: unknown;
  tools?: unknown;
  max_output_tokens?: unknown;
  stream?: unknown;
  [key: string]: unknown;
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
  if (!key) return jsonError(401, "missing_key", "API anahtarı gerekli.");

  let body: ProxyBody;
  try {
    body = (await req.json()) as ProxyBody;
  } catch {
    return jsonError(400, "invalid_body", "Geçersiz JSON gövdesi.");
  }

  if (typeof body.model !== "string" || body.model.length === 0) {
    return jsonError(400, "invalid_shape", "model alanı eksik.");
  }
  if (!Array.isArray(body.input) && typeof body.input !== "string") {
    return jsonError(400, "invalid_shape", "input alanı eksik.");
  }

  let upstream: Response;
  try {
    upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err: unknown) {
    return new Response(
      JSON.stringify({
        ok: false,
        code: "network",
        error: err instanceof Error ? err.message : "Network failure",
      }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }

  if (!upstream.ok || !upstream.body) {
    let message = `HTTP ${upstream.status}`;
    let code = "upstream_error";
    if (upstream.status === 401) code = "unauthorized";
    else if (upstream.status === 429) code = "rate_limited";
    else if (upstream.status === 400) code = "bad_request";
    try {
      const errBody = (await upstream.clone().json()) as {
        error?: { message?: string; code?: string };
      };
      if (errBody?.error?.message) message = errBody.error.message;
      if (errBody?.error?.code) code = errBody.error.code;
    } catch {
      /* ignore */
    }
    return jsonError(upstream.status || 502, code, message);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
