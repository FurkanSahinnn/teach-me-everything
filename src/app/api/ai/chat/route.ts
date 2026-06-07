import { getPreset } from "@/lib/ai/providers/presets";
import type { CloudProviderId } from "@/lib/ai/providers/types";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const ANTHROPIC_VERSION = "2023-06-01";

type ProxyBody = {
  provider?: unknown;
  model?: unknown;
  system?: unknown;
  messages?: unknown;
  max_tokens?: unknown;
  tools?: unknown;
  tool_choice?: unknown;
  // For Anthropic: "oauth" → Authorization: Bearer + anthropic-beta header;
  // anything else (or missing) → x-api-key header. Stripped before forwarding.
  authKind?: unknown;
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

  if (typeof body.model !== "string") {
    return jsonError(400, "invalid_shape", "model alanı eksik.");
  }
  const model = body.model;

  const providerId = (typeof body.provider === "string" ? body.provider : "anthropic") as CloudProviderId;
  const preset = getPreset(providerId);
  if (!preset && providerId !== "anthropic") {
    return jsonError(404, "unknown_provider", `Bilinmeyen sağlayıcı: ${providerId}`);
  }
  const family = preset?.family ?? "anthropic";

  const { provider: _provider, authKind: _authKind, ...forwardBody } = body;

  let url: string;
  const headers: Record<string, string> = { "content-type": "application/json" };
  let upstreamBodyObj: Record<string, unknown>;

  if (family === "anthropic") {
    const baseUrl = preset?.baseUrl ?? "https://api.anthropic.com";
    url = `${baseUrl}/v1/messages`;
    headers["anthropic-version"] = ANTHROPIC_VERSION;
    // Auth header shape diverges per credential kind. OAuth tokens (from
    // `claude setup-token`) authenticate via `Authorization: Bearer …` and
    // require the OAuth beta flag; classic API keys use the `x-api-key`
    // header directly.
    if (body.authKind === "oauth") {
      headers["authorization"] = `Bearer ${key}`;
      headers["anthropic-beta"] = "oauth-2025-04-20";
    } else {
      headers["x-api-key"] = key;
    }
    if (!Array.isArray(body.system) || !Array.isArray(body.messages)) {
      return jsonError(400, "invalid_shape", "system/messages eksik.");
    }
    upstreamBodyObj = {
      model,
      max_tokens: typeof body.max_tokens === "number" ? body.max_tokens : 1024,
      stream: true,
      system: body.system,
      messages: body.messages,
      ...(Array.isArray(body.tools) && body.tools.length > 0 ? { tools: body.tools } : {}),
      ...(body.tool_choice && typeof body.tool_choice === "object" ? { tool_choice: body.tool_choice } : {}),
    };
  } else if (family === "openai-compat" && preset) {
    url = `${preset.baseUrl}/chat/completions`;
    if (preset.auth.kind === "bearer") {
      headers["authorization"] = `Bearer ${key}`;
    } else {
      headers[preset.auth.headerName] = key;
    }
    upstreamBodyObj = forwardBody as Record<string, unknown>;
  } else if (family === "gemini" && preset) {
    url = `${preset.baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    if (preset.auth.kind === "header") {
      headers[preset.auth.headerName] = key;
    } else {
      headers["authorization"] = `Bearer ${key}`;
    }
    const { model: _m, ...geminiBody } = forwardBody;
    upstreamBodyObj = geminiBody as Record<string, unknown>;
  } else {
    return jsonError(501, "unsupported_family", `Sağlayıcı ailesi desteklenmiyor: ${family}`);
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(upstreamBodyObj),
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
    try {
      const errBody = (await upstream.clone().json()) as {
        error?: { message?: string };
      };
      if (errBody?.error?.message) message = errBody.error.message;
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
