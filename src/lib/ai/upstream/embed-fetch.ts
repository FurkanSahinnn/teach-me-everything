// Shared embed-fetch routing for the 6 cloud embed adapters. Branches
// `isTauriEnv()` once so each adapter stays free of plumbing — the
// adapter just calls `embedFetch(proxyBody, apiKey, {signal})` and
// receives a `Response` with the upstream JSON payload (same shape the
// proxy would have streamed back). Local providers still bypass this
// entirely via direct localhost calls in `embed-openai-compat.ts`.

import { isTauriEnvWithOverride } from "@/lib/tauri/env";
import { tauriFetch } from "@/lib/tauri/fetch";
import { buildEmbedUpstream, type EmbedProxyBody } from "./embed-request";

export type EmbedFetchOpts = {
  signal?: AbortSignal | undefined;
};

export async function embedFetch(
  proxyBody: EmbedProxyBody,
  apiKey: string,
  opts: EmbedFetchOpts = {},
): Promise<Response> {
  if (isTauriEnvWithOverride()) {
    const built = buildEmbedUpstream(proxyBody, apiKey);
    if (!built.ok) {
      // Mirror the proxy's JSON-error shape so adapters' error-decoding
      // paths work identically across modes.
      return new Response(
        JSON.stringify({ ok: false, code: built.error.code, error: built.error.message }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    const init: RequestInit = {
      method: "POST",
      headers: built.request.headers,
      body: built.request.body,
    };
    if (opts.signal) init.signal = opts.signal;
    return tauriFetch(built.request.url, init);
  }
  const init: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(proxyBody),
  };
  if (opts.signal) init.signal = opts.signal;
  return fetch("/api/ai/embed", init);
}
