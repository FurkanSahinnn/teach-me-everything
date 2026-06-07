import { NextResponse } from "next/server";
import { getPreset } from "@/lib/ai/providers/presets";
import type { CloudProviderId, ProviderPreset } from "@/lib/ai/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TestRequest = {
  provider: CloudProviderId | "claude-code-oauth" | "firecrawl";
  key: string;
};

type TestResult = {
  ok: boolean;
  model?: string | null;
  usage?: { input_tokens?: number | undefined; output_tokens?: number | undefined } | null;
  latencyMs?: number;
  error?: string;
  status?: number;
};

function bad(status: number, message: string): Response {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request): Promise<Response> {
  let body: TestRequest;
  try {
    body = (await req.json()) as TestRequest;
  } catch {
    return bad(400, "Geçersiz istek gövdesi.");
  }

  const { provider, key } = body;
  if (!key || typeof key !== "string" || key.length < 8) {
    return bad(400, "Anahtar boş veya çok kısa.");
  }

  if (provider === "anthropic" || provider === "claude-code-oauth") {
    return await testAnthropic(provider, key);
  }
  if (provider === "firecrawl") {
    return await testFirecrawl(key);
  }

  const preset = getPreset(provider);
  if (!preset) {
    return NextResponse.json({ ok: false, error: "Bilinmeyen sağlayıcı." }, { status: 400 });
  }

  if (preset.family === "openai-compat") {
    // OpenRouter rotates its `:free` model slots, so a chat/completions probe
    // against `defaultModels.chat` can 404 even when the key is perfectly
    // valid. The dedicated `/auth/key` endpoint validates the key without any
    // model dependency and does not consume credits.
    if (preset.id === "openrouter") {
      return await testOpenRouter(preset, key);
    }
    return await testOpenAICompat(preset, key);
  }
  if (preset.family === "gemini") {
    return await testGemini(preset, key);
  }
  return bad(501, "Bu sağlayıcı henüz test edilemez.");
}

async function testAnthropic(
  provider: "anthropic" | "claude-code-oauth",
  key: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (provider === "anthropic") {
    headers["x-api-key"] = key;
  } else {
    headers["authorization"] = `Bearer ${key}`;
    headers["anthropic-beta"] = "oauth-2025-04-20";
  }

  const startedAt = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 16,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : "Ağ hatası.",
    } satisfies TestResult);
  }

  const latencyMs = Date.now() - startedAt;
  let data: unknown = null;
  try {
    data = await upstream.json();
  } catch {
    /* ignore */
  }
  if (!upstream.ok) {
    const errMsg =
      (data as { error?: { message?: string } } | null)?.error?.message ??
      `HTTP ${upstream.status}`;
    return NextResponse.json({
      ok: false,
      error: errMsg,
      status: upstream.status,
      latencyMs,
    } satisfies TestResult);
  }
  const success = data as { model?: string; usage?: { input_tokens?: number; output_tokens?: number } } | null;
  return NextResponse.json({
    ok: true,
    model: success?.model ?? null,
    usage: success?.usage ?? null,
    latencyMs,
  } satisfies TestResult);
}

async function testOpenAICompat(preset: ProviderPreset, key: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (preset.auth.kind === "bearer") {
    headers["authorization"] = `Bearer ${key}`;
  } else {
    headers[preset.auth.headerName] = key;
  }

  const model = preset.defaultModels.chat;
  if (!model) {
    return NextResponse.json({ ok: false, error: "Default chat modeli yok." } satisfies TestResult);
  }

  const startedAt = Date.now();
  let upstream: Response;
  try {
    const tokenLimitKey =
      preset.id === "openai" ? "max_completion_tokens" : "max_tokens";
    upstream = await fetch(`${preset.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        [tokenLimitKey]: 8,
        messages: [{ role: "user", content: "ping" }],
        stream: false,
      }),
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : "Ağ hatası.",
    } satisfies TestResult);
  }
  const latencyMs = Date.now() - startedAt;

  let data: unknown = null;
  try {
    data = await upstream.json();
  } catch {
    /* ignore */
  }

  if (!upstream.ok) {
    const errMsg =
      (data as { error?: { message?: string } } | null)?.error?.message ??
      `HTTP ${upstream.status}`;
    return NextResponse.json({
      ok: false,
      error: errMsg,
      status: upstream.status,
      latencyMs,
    } satisfies TestResult);
  }

  const success = data as {
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  } | null;
  return NextResponse.json({
    ok: true,
    model: success?.model ?? model,
    usage: success?.usage
      ? {
          input_tokens: success.usage.prompt_tokens,
          output_tokens: success.usage.completion_tokens,
        }
      : null,
    latencyMs,
  } satisfies TestResult);
}

async function testGemini(preset: ProviderPreset, key: string): Promise<Response> {
  const model = preset.defaultModels.chat;
  if (!model) {
    return NextResponse.json({ ok: false, error: "Default chat modeli yok." } satisfies TestResult);
  }
  const headerName = preset.auth.kind === "header" ? preset.auth.headerName : "x-goog-api-key";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    [headerName]: key,
  };

  const startedAt = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(
      `${preset.baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "ping" }] }],
          generationConfig: { maxOutputTokens: 8 },
        }),
      },
    );
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : "Ağ hatası.",
    } satisfies TestResult);
  }
  const latencyMs = Date.now() - startedAt;

  let data: unknown = null;
  try {
    data = await upstream.json();
  } catch {
    /* ignore */
  }

  if (!upstream.ok) {
    const errMsg =
      (data as { error?: { message?: string } } | null)?.error?.message ??
      `HTTP ${upstream.status}`;
    return NextResponse.json({
      ok: false,
      error: errMsg,
      status: upstream.status,
      latencyMs,
    } satisfies TestResult);
  }

  const success = data as {
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  } | null;
  return NextResponse.json({
    ok: true,
    model,
    usage: success?.usageMetadata
      ? {
          input_tokens: success.usageMetadata.promptTokenCount,
          output_tokens: success.usageMetadata.candidatesTokenCount,
        }
      : null,
    latencyMs,
  } satisfies TestResult);
}

async function testOpenRouter(preset: ProviderPreset, key: string): Promise<Response> {
  const startedAt = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(`${preset.baseUrl}/auth/key`, {
      method: "GET",
      headers: { authorization: `Bearer ${key}` },
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : "Ağ hatası.",
    } satisfies TestResult);
  }
  const latencyMs = Date.now() - startedAt;

  let data: unknown = null;
  try {
    data = await upstream.json();
  } catch {
    /* ignore */
  }

  if (!upstream.ok) {
    const errMsg =
      (data as { error?: { message?: string } } | null)?.error?.message ??
      `HTTP ${upstream.status}`;
    return NextResponse.json({
      ok: false,
      error: errMsg,
      status: upstream.status,
      latencyMs,
    } satisfies TestResult);
  }

  // /auth/key returns { data: { label, usage, limit, is_free_tier, … } }.
  // We surface the label so the UI can show e.g. "OpenRouter · sk-or-…-xyz".
  const success = data as { data?: { label?: string } } | null;
  return NextResponse.json({
    ok: true,
    model: success?.data?.label ?? "OpenRouter key",
    usage: null,
    latencyMs,
  } satisfies TestResult);
}

async function testFirecrawl(key: string): Promise<Response> {
  const startedAt = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch("https://api.firecrawl.dev/v2/team/activity?limit=1", {
      method: "GET",
      headers: {
        authorization: `Bearer ${key}`,
      },
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : "Ağ hatası.",
    } satisfies TestResult);
  }
  const latencyMs = Date.now() - startedAt;

  let data: unknown = null;
  try {
    data = await upstream.json();
  } catch {
    /* ignore */
  }

  if (!upstream.ok) {
    const errMsg =
      (data as { error?: string | { message?: string }; message?: string } | null)
        ?.message ??
      (typeof (data as { error?: unknown } | null)?.error === "string"
        ? ((data as { error?: string } | null)?.error ?? "")
        : (data as { error?: { message?: string } } | null)?.error?.message) ??
      `HTTP ${upstream.status}`;
    return NextResponse.json({
      ok: false,
      error: errMsg,
      status: upstream.status,
      latencyMs,
    } satisfies TestResult);
  }

  return NextResponse.json({
    ok: true,
    model: "Firecrawl API",
    usage: null,
    latencyMs,
  } satisfies TestResult);
}
