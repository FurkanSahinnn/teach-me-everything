// Pure builder for the `/api/ai/chat` upstream request. Mirrors the
// routing logic in `src/app/api/ai/chat/route.ts` so the same body the
// provider currently POSTs to the proxy can be re-shaped into a direct
// upstream call from the Tauri client.
//
// The proxy strips two synthetic fields before forwarding (`provider`,
// `authKind`); this builder does the same so the wire shape is identical.

import { getPreset } from "@/lib/ai/providers/presets";
import type { CloudProviderId } from "@/lib/ai/providers/types";

const ANTHROPIC_VERSION = "2023-06-01";

export type ChatProxyBody = {
  provider?: string;
  model?: string;
  authKind?: string;
  system?: unknown;
  messages?: unknown;
  max_tokens?: number;
  tools?: unknown;
  tool_choice?: unknown;
  [key: string]: unknown;
};

export type ChatUpstreamRequest = {
  url: string;
  headers: Record<string, string>;
  body: string;
};

export type ChatUpstreamError = {
  code:
    | "invalid_shape"
    | "unknown_provider"
    | "unsupported_family"
    | "missing_key";
  message: string;
};

export type ChatUpstreamResult =
  | { ok: true; request: ChatUpstreamRequest }
  | { ok: false; error: ChatUpstreamError };

function strip<T extends Record<string, unknown>>(body: T, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const drop = new Set(keys);
  for (const k of Object.keys(body)) {
    if (!drop.has(k)) out[k] = body[k];
  }
  return out;
}

export function buildChatUpstream(
  body: ChatProxyBody,
  apiKey: string,
): ChatUpstreamResult {
  if (!apiKey || apiKey.length === 0) {
    return { ok: false, error: { code: "missing_key", message: "API anahtarı gerekli." } };
  }
  if (typeof body.model !== "string" || body.model.length === 0) {
    return { ok: false, error: { code: "invalid_shape", message: "model alanı eksik." } };
  }
  const providerId = (typeof body.provider === "string" ? body.provider : "anthropic") as CloudProviderId;
  const preset = getPreset(providerId);
  if (!preset && providerId !== "anthropic") {
    return {
      ok: false,
      error: { code: "unknown_provider", message: `Bilinmeyen sağlayıcı: ${providerId}` },
    };
  }
  const family = preset?.family ?? "anthropic";
  const model = body.model;
  const forwardBody = strip(body, ["provider", "authKind"]);

  if (family === "anthropic") {
    if (!Array.isArray(body.system) || !Array.isArray(body.messages)) {
      return { ok: false, error: { code: "invalid_shape", message: "system/messages eksik." } };
    }
    const baseUrl = preset?.baseUrl ?? "https://api.anthropic.com";
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "anthropic-version": ANTHROPIC_VERSION,
    };
    if (body.authKind === "oauth") {
      headers["authorization"] = `Bearer ${apiKey}`;
      headers["anthropic-beta"] = "oauth-2025-04-20";
    } else {
      headers["x-api-key"] = apiKey;
    }
    const upstreamBody: Record<string, unknown> = {
      model,
      max_tokens: typeof body.max_tokens === "number" ? body.max_tokens : 1024,
      stream: true,
      system: body.system,
      messages: body.messages,
      ...(Array.isArray(body.tools) && body.tools.length > 0 ? { tools: body.tools } : {}),
      ...(body.tool_choice && typeof body.tool_choice === "object"
        ? { tool_choice: body.tool_choice }
        : {}),
    };
    return {
      ok: true,
      request: {
        url: `${baseUrl}/v1/messages`,
        headers,
        body: JSON.stringify(upstreamBody),
      },
    };
  }

  if (family === "openai-compat" && preset) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (preset.auth.kind === "bearer") {
      headers["authorization"] = `Bearer ${apiKey}`;
    } else {
      headers[preset.auth.headerName] = apiKey;
    }
    return {
      ok: true,
      request: {
        url: `${preset.baseUrl}/chat/completions`,
        headers,
        body: JSON.stringify(forwardBody),
      },
    };
  }

  if (family === "gemini" && preset) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (preset.auth.kind === "header") {
      headers[preset.auth.headerName] = apiKey;
    } else {
      headers["authorization"] = `Bearer ${apiKey}`;
    }
    const { model: _m, ...geminiBody } = forwardBody;
    return {
      ok: true,
      request: {
        url: `${preset.baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
        headers,
        body: JSON.stringify(geminiBody),
      },
    };
  }

  return {
    ok: false,
    error: { code: "unsupported_family", message: `Sağlayıcı ailesi desteklenmiyor: ${family}` },
  };
}
