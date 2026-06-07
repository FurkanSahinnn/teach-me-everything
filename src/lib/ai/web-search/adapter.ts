// Phase 5.5.B — Web-search adapter interface + dispatcher.
//
// Each provider that supports native web search ships a small adapter that
// (1) builds the request-fragment enabling the feature and (2) parses the
// streamed or one-shot response back into provider-neutral `WebCitation`s.
// The chat handler stays provider-agnostic; it just calls
// `getWebSearchAdapter(chatOption.presetId)` and feeds events through.
//
// Adapter parsers MUST be defensive — unknown shapes return `null` rather
// than throwing, so a hostile or malformed upstream event can never crash
// the streaming pipeline. Citation arrays may be empty; usage may be
// undefined; both are handled by callers.

import type { ProviderId } from "@/lib/ai/providers/types";
import type {
  WebCitation,
  WebSearchCapability,
  WebSearchOptions,
  WebSearchUsage,
} from "@/lib/ai/web-search/types";

import { CLAUDE_WEB_SEARCH_ADAPTER } from "@/lib/ai/providers/web-search/claude";
import { GEMINI_WEB_SEARCH_ADAPTER } from "@/lib/ai/providers/web-search/gemini";
import { GLM_WEB_SEARCH_ADAPTER } from "@/lib/ai/providers/web-search/glm";
import { MISTRAL_WEB_SEARCH_ADAPTER } from "@/lib/ai/providers/web-search/mistral";
import { OPENAI_RESPONSES_WEB_SEARCH_ADAPTER } from "@/lib/ai/providers/web-search/openai-responses";
import { OPENROUTER_WEB_SEARCH_ADAPTER } from "@/lib/ai/providers/web-search/openrouter";
import { PERPLEXITY_WEB_SEARCH_ADAPTER } from "@/lib/ai/providers/web-search/perplexity";
import { XAI_WEB_SEARCH_ADAPTER } from "@/lib/ai/providers/web-search/xai";

export interface WebSearchParseResult {
  citations: WebCitation[];
  usage?: WebSearchUsage | undefined;
}

export interface WebSearchAdapter {
  /** Matches `ChatOption.presetId` so the chat handler can route by preset. */
  readonly providerId: ProviderId;
  /** Surface for the UI capability badge + cost preview. */
  readonly capability: WebSearchCapability;
  /**
   * Build the provider-specific request fragment that enables web search.
   *
   * Tool-block providers (Claude, OpenAI, Gemini, Grok, GLM) return the tool
   * entry to splice into `tools: [...]`. Connector/agent providers (Mistral)
   * return the connector descriptor. Param-only providers (Perplexity) return
   * a flat options object the caller spreads into the request body. Plugin
   * providers (OpenRouter) return a plugin entry for `plugins: [...]`.
   *
   * The chat handler is responsible for placing the result in the right slot
   * for each provider family; this layer only owns the *shape*.
   */
  buildToolBlock(opts: WebSearchOptions): unknown;
  /**
   * Inspect a single streaming event (or a complete non-streamed response
   * envelope for providers that don't stream citations). Returns a parse
   * result with zero-or-more citations and optional usage tick, or `null`
   * when the event isn't search-related.
   */
  parseStreamEvent(event: unknown): WebSearchParseResult | null;
}

const ADAPTERS = {
  anthropic: CLAUDE_WEB_SEARCH_ADAPTER,
  // 5.5.H: web_search is only valid on the Responses endpoint. The plain
  // `openai` (Chat Completions) provider rejects the tool envelope with
  // HTTP 400, so it intentionally has no entry here — callers that route
  // chat through Chat Completions don't get a web-search toggle.
  "openai-responses": OPENAI_RESPONSES_WEB_SEARCH_ADAPTER,
  "google-gemini": GEMINI_WEB_SEARCH_ADAPTER,
  perplexity: PERPLEXITY_WEB_SEARCH_ADAPTER,
  xai: XAI_WEB_SEARCH_ADAPTER,
  mistral: MISTRAL_WEB_SEARCH_ADAPTER,
  glm: GLM_WEB_SEARCH_ADAPTER,
  openrouter: OPENROUTER_WEB_SEARCH_ADAPTER,
} as const satisfies Partial<Record<ProviderId, WebSearchAdapter>>;

export type WebSearchProviderId = keyof typeof ADAPTERS;

/** Returns the adapter for a provider preset, or null if not supported. */
export function getWebSearchAdapter(presetId: ProviderId): WebSearchAdapter | null {
  if (typeof presetId !== "string") return null;
  if (presetId.startsWith("custom:")) return null;
  const adapter = (ADAPTERS as Record<string, WebSearchAdapter | undefined>)[presetId];
  return adapter ?? null;
}

/** Enumerate every supported web-search adapter. Test + Settings UI use this. */
export function listWebSearchAdapters(): WebSearchAdapter[] {
  return Object.values(ADAPTERS);
}

/** True iff the provider has a registered web-search adapter. */
export function supportsWebSearch(presetId: ProviderId): boolean {
  return getWebSearchAdapter(presetId) !== null;
}
