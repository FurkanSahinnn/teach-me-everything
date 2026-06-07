// Client-side mirror of `/api/ai/test`. In web mode forwards to the
// proxy (same wire shape as today). In Tauri mode dispatches a direct
// upstream probe per provider — the route's logic, ported verbatim, so
// the Settings → Keys "test" button works identically across modes.

import { isTauriEnvWithOverride } from "@/lib/tauri/env";
import { tauriFetch } from "@/lib/tauri/fetch";
import { getPreset } from "@/lib/ai/providers/presets";
import type { CloudProviderId, ProviderPreset } from "@/lib/ai/providers/types";

export type TestKeyProvider =
  | CloudProviderId
  | "claude-code-oauth"
  | "firecrawl";

export type TestKeyInput = {
  provider: TestKeyProvider;
  key: string;
};

export type TestKeyResult = {
  ok: boolean;
  model?: string | null;
  usage?: {
    input_tokens?: number | undefined;
    output_tokens?: number | undefined;
  } | null;
  latencyMs?: number;
  error?: string;
  status?: number;
  // True when the test was intentionally not run (e.g. OAuth bearer, which
  // Anthropic gates behind an org-level "Direct browser access" toggle and
  // is fundamentally a CLI/SDK flow, not a direct-HTTP one). Callers should
  // render an info chip instead of a green ✓ / red ✗.
  skipped?: boolean;
  skipReason?: string;
};

export async function testApiKey(input: TestKeyInput): Promise<TestKeyResult> {
  if (!input.key || input.key.length < 8) {
    return { ok: false, error: "Anahtar boş veya çok kısa." };
  }
  // Claude Code OAuth tokens cannot be probed via direct HTTP: Anthropic
  // requires `anthropic-dangerous-direct-browser-access: true` AND the org
  // must opt-in via console settings (off by default for Claude Code subs).
  // The real chat path goes through `@anthropic-ai/claude-agent-sdk` which
  // spawns the `claude` CLI — a different auth surface that isn't gated this
  // way. Skipping here keeps the UX honest.
  if (input.provider === "claude-code-oauth") {
    return {
      ok: true,
      skipped: true,
      skipReason:
        "OAuth token doğrudan test edilemez. Kaydet, sohbette dene — chat SDK üzerinden çalışır.",
    };
  }
  if (isTauriEnvWithOverride()) {
    return testInTauri(input);
  }
  // Web: hand off to the existing route proxy (unchanged shape).
  try {
    const res = await fetch("/api/ai/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return (await res.json()) as TestKeyResult;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Ağ hatası." };
  }
}

async function testInTauri({ provider, key }: TestKeyInput): Promise<TestKeyResult> {
  if (provider === "anthropic" || provider === "claude-code-oauth") {
    return probeAnthropic(provider, key);
  }
  if (provider === "firecrawl") return probeFirecrawl(key);
  const preset = getPreset(provider);
  if (!preset) return { ok: false, error: "Bilinmeyen sağlayıcı." };
  if (preset.family === "openai-compat") {
    if (preset.id === "openrouter") return probeOpenRouter(preset, key);
    return probeOpenAICompat(preset, key);
  }
  if (preset.family === "gemini") return probeGemini(preset, key);
  return { ok: false, error: "Bu sağlayıcı henüz test edilemez." };
}

async function probeAnthropic(
  provider: "anthropic" | "claude-code-oauth",
  key: string,
): Promise<TestKeyResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (provider === "anthropic") {
    headers["x-api-key"] = key;
  } else {
    // Unreachable in practice — `testApiKey` short-circuits OAuth before
    // dispatching to `testInTauri`. Kept defensively so the switch is total.
    headers["authorization"] = `Bearer ${key}`;
    headers["anthropic-beta"] = "oauth-2025-04-20";
  }
  return runProbe("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 16,
      messages: [{ role: "user", content: "ping" }],
    }),
  });
}

async function probeOpenAICompat(
  preset: ProviderPreset,
  key: string,
): Promise<TestKeyResult> {
  const model = preset.defaultModels.chat;
  if (!model) return { ok: false, error: "Default chat modeli yok." };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (preset.auth.kind === "bearer") {
    headers["authorization"] = `Bearer ${key}`;
  } else {
    headers[preset.auth.headerName] = key;
  }
  const tokenLimitKey =
    preset.id === "openai" ? "max_completion_tokens" : "max_tokens";
  return runProbe(`${preset.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      [tokenLimitKey]: 8,
      messages: [{ role: "user", content: "ping" }],
      stream: false,
    }),
  });
}

async function probeGemini(preset: ProviderPreset, key: string): Promise<TestKeyResult> {
  const model = preset.defaultModels.chat;
  if (!model) return { ok: false, error: "Default chat modeli yok." };
  const headerName = preset.auth.kind === "header" ? preset.auth.headerName : "x-goog-api-key";
  return runProbe(
    `${preset.baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", [headerName]: key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        generationConfig: { maxOutputTokens: 8 },
      }),
    },
    model,
  );
}

async function probeOpenRouter(preset: ProviderPreset, key: string): Promise<TestKeyResult> {
  return runProbe(
    `${preset.baseUrl}/auth/key`,
    {
      method: "GET",
      headers: { authorization: `Bearer ${key}` },
    },
    "OpenRouter key",
  );
}

async function probeFirecrawl(key: string): Promise<TestKeyResult> {
  return runProbe(
    "https://api.firecrawl.dev/v2/team/activity?limit=1",
    {
      method: "GET",
      headers: { authorization: `Bearer ${key}` },
    },
    "Firecrawl API",
  );
}

async function runProbe(
  url: string,
  init: RequestInit,
  fallbackModel?: string,
): Promise<TestKeyResult> {
  const startedAt = Date.now();
  let res: Response;
  try {
    res = await tauriFetch(url, init);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Ağ hatası." };
  }
  const latencyMs = Date.now() - startedAt;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const errMsg =
      (data as { error?: { message?: string } | string } | null)?.error &&
      typeof (data as { error?: { message?: string } }).error === "object"
        ? (data as { error?: { message?: string } }).error?.message
        : typeof (data as { error?: string } | null)?.error === "string"
          ? (data as { error?: string }).error
          : undefined;
    return {
      ok: false,
      error: errMsg ?? `HTTP ${res.status}`,
      status: res.status,
      latencyMs,
    };
  }
  // Success — try to surface the model + usage fields the various
  // providers return. Shape varies (Anthropic uses `model`/`usage`,
  // OpenAI uses `model`/`usage.{prompt,completion}_tokens`, Gemini uses
  // `usageMetadata`, OpenRouter `/auth/key` returns `{data:{label}}`).
  const d = data as
    | {
        model?: string;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          prompt_tokens?: number;
          completion_tokens?: number;
        };
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        data?: { label?: string };
      }
    | null;
  const modelOut =
    d?.model ?? d?.data?.label ?? fallbackModel ?? null;
  const usage = d?.usage
    ? {
        input_tokens: d.usage.input_tokens ?? d.usage.prompt_tokens,
        output_tokens: d.usage.output_tokens ?? d.usage.completion_tokens,
      }
    : d?.usageMetadata
      ? {
          input_tokens: d.usageMetadata.promptTokenCount,
          output_tokens: d.usageMetadata.candidatesTokenCount,
        }
      : null;
  return { ok: true, model: modelOut, usage, latencyMs };
}
