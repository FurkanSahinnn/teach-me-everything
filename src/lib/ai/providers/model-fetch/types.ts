// Phase 10.A — Per-provider catalog fetch adapter interface.
//
// Mirrors the `web-search/adapter.ts` shape so the two registries stay
// structurally identical. Each adapter knows (1) where the provider's
// `/models` endpoint lives, (2) what auth header to send, (3) how to parse
// the response shape and (4) how to filter out non-chat / no-tool-use models
// before they hit the picker.
//
// Adapters MUST be defensive — a malformed response returns an empty model
// list rather than throwing. The hook layer treats fetch failures as "fall
// back to static preset", so the UI never goes blank.
//
// `requiresApiKey` matters because OpenRouter publishes its catalog without
// auth, while every other cloud provider does require a key. Local providers
// (ollama / lm-studio / llama.cpp) don't require a key either but they need
// the user's custom baseUrl, which the hook supplies separately.

import type { ModelDescriptor, ProviderId } from "../types";

export interface ModelFetchResult {
  /** Parsed + filtered + tier-inferred. Empty on hard fetch failure. */
  models: ModelDescriptor[];
  /** Source URL the catalog was fetched from (debug-only). */
  fetchedFrom: string;
}

export interface ModelFetchOptions {
  /** BYOK key — undefined when caller has no credential yet. */
  apiKey?: string | undefined;
  /** Override for the provider preset baseUrl (custom endpoints / local). */
  baseUrl?: string | undefined;
  /** Cancellation. */
  signal?: AbortSignal | undefined;
}

export interface ModelFetchAdapter {
  /** Matches `ProviderPreset.id` so the dispatcher can route by preset. */
  readonly providerId: ProviderId;
  /** When `true`, hook skips fetch unless caller supplied a key. */
  readonly requiresApiKey: boolean;
  /** Human-readable doc/source label for telemetry + error toasts. */
  readonly endpointLabel: string;
  /**
   * Fetch the catalog, parse the response, filter to tool-capable chat
   * models, infer tier per model. Returns empty `models` on any failure
   * (parse error, network error, non-2xx) — never throws.
   */
  fetch(opts: ModelFetchOptions): Promise<ModelFetchResult>;
}
