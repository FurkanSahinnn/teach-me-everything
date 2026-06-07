// Thin wrapper over `@tauri-apps/plugin-http`'s fetch with a lazy import
// so the plugin's runtime is never pulled into the web bundle. The
// plugin's fetch is a near-drop-in for the Web Fetch API (it returns a
// real `Response` with a streaming body) but with no CORS and no
// connect-src CSP gate — exactly what the LLM proxy routes were doing
// server-side in dev/web mode.
//
// Use `tauriFetch` (forced) at sites that have already branched on
// `isTauriEnv()`. Use `smartFetch` only when the same URL works in both
// modes (rare for upstream LLM calls; common for static resource GETs).

import { isTauriEnvWithOverride } from "./env";

let cachedFetch: typeof fetch | null = null;

async function loadTauriFetch(): Promise<typeof fetch> {
  if (cachedFetch) return cachedFetch;
  // Dynamic import — tree-shaken out of the web bundle when the call
  // site is gated by `isTauriEnv()` at runtime.
  const mod = (await import("@tauri-apps/plugin-http")) as {
    fetch: typeof fetch;
  };
  cachedFetch = mod.fetch;
  return cachedFetch;
}

export async function tauriFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const f = await loadTauriFetch();
  return f(input, init);
}

export async function smartFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (isTauriEnvWithOverride()) {
    return tauriFetch(input, init);
  }
  return fetch(input, init);
}

// Test seam — override the cached implementation. Pass `null` to reset.
export function _setTauriFetchForTests(f: typeof fetch | null): void {
  cachedFetch = f;
}
