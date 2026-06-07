// Phase 5.5.G — Unified search provider interface + ID registry.
//
// "Konu ara → Kaynak ekle" modal feeds a query through the user's preferred
// priority chain. The chain mixes:
//   - Pure search APIs (Brave / Exa / Tavily) that return a URL list directly.
//   - Chat-LLM wrappers (Anthropic / OpenAI / Gemini / Perplexity / xAI /
//     Mistral / GLM / OpenRouter) that ride on the 5.5.B web-search adapter
//     machinery: a chat call is dispatched with the provider's native web
//     search tool, and citations are parsed into the same URL-list shape.
//
// Why a separate `*-search` ID namespace from the chat provider IDs: the
// same Anthropic key is used for chat AND chat-based search, but the user
// has different priority preferences for each. Keeping the IDs distinct lets
// the Settings drag-reorder list be independent of the chat model picker.

import type { ApiKeyProvider } from "@/lib/db/schema";

/** Stable identifier for a search backend. */
export type SearchProviderId =
  // Pure search APIs (single-purpose: query → URL list)
  | "brave"
  | "exa-search"
  | "tavily-search"
  // Chat-LLM wrappers (chat + web search tool, citations parsed as URL list)
  | "anthropic-search"
  | "openai-search"
  | "gemini-search"
  | "perplexity-search"
  | "xai-search"
  | "mistral-search"
  | "glm-search"
  | "openrouter-search";

export type SearchProviderKind = "pure" | "chat";

/**
 * Canonical search result shape produced by every backend. Chat-LLM wrappers
 * normalise their adapter's WebCitation output into this shape so the
 * SearchSourcesModal stays oblivious to the backend it's rendering.
 */
export type SearchResultItem = {
  url: string;
  title: string;
  description: string;
  age?: string | undefined;
  faviconUrl?: string | undefined;
};

export type SearchAuthKind = "api-key" | "oauth";

export type SearchInput = {
  query: string;
  /** 1–20 results. Clamped per backend. */
  count?: number | undefined;
  /** Decrypted API key for the backend's auth provider. */
  apiKey: string;
  /**
   * For chat-LLM wrappers (Anthropic specifically), which credential kind
   * the `apiKey` represents. `"oauth"` switches the chat provider to the
   * Bearer-token header path; `"api-key"` (default) uses x-api-key.
   * Ignored by pure search providers.
   */
  authKind?: SearchAuthKind | undefined;
  signal?: AbortSignal | undefined;
};

/**
 * Common interface every search backend implements. The dispatcher calls
 * `.search(input)` and treats failures (throws / rejections) as "try the
 * next provider in the priority chain".
 */
export interface UnifiedSearchProvider {
  readonly id: SearchProviderId;
  /** Human-friendly label rendered in Settings + modal "Arama: X" footer. */
  readonly label: string;
  readonly kind: SearchProviderKind;
  /** Approximate USD cost per query — surfaced in Settings as a hint. */
  readonly costPerCallUsd?: number | undefined;
  /** Free-tier note (e.g. "2k/month") — also surfaced in Settings. */
  readonly freeTierNote?: string | undefined;
  search(input: SearchInput): Promise<SearchResultItem[]>;
}

/**
 * Pref entry: ordered priority list of search backends. The dispatcher walks
 * this array top-down. Disabled entries are skipped. The ID is widened to
 * plain string at the persistence layer for forward compat (a future preset
 * addition stored from a newer build won't lose the user's order on
 * downgrade).
 */
export type SearchProviderEntry = {
  id: SearchProviderId | string;
  enabled: boolean;
  /**
   * Optional per-provider config. Currently only `openrouter-search` reads
   * `modelId` — lets the user pick which OpenRouter model carries the
   * `:online` plugin. Forward-compatible: older builds ignore the field.
   */
  config?: SearchProviderEntryConfig;
};

export type SearchProviderEntryConfig = {
  /** OpenRouter model slug (e.g. "z-ai/glm-4.6", "openai/gpt-4o-mini"). */
  modelId?: string;
};

/**
 * Credential option for a search provider — the apiKeys row to read AND the
 * authKind that goes with it. Chat-LLM wrappers can have multiple options
 * (e.g. Anthropic supports both api-key and Claude Code OAuth), tried in
 * priority order.
 */
export type SearchCredentialOption = {
  keyProvider: ApiKeyProvider;
  authKind: SearchAuthKind;
};

/**
 * Resolve which `apiKeys` row(s) store the secret for a given search provider.
 * Returns an ordered list of candidates — the dispatcher walks them top-down
 * and uses the first slot that has a stored key.
 *
 * Pure search providers (Brave / Exa / Tavily) return a single-entry array.
 * Anthropic returns two entries because users can authenticate via either
 * a plain API key (`sk-ant-...`) or the Claude Code OAuth token. Either is a
 * valid credential for the same underlying Anthropic API.
 *
 * Returns an empty array for unknown IDs so the dispatcher can skip silently.
 */
export function getKeyProvidersForSearch(
  id: SearchProviderId | string,
): SearchCredentialOption[] {
  switch (id) {
    case "brave":
      return [{ keyProvider: "brave", authKind: "api-key" }];
    case "exa-search":
      return [{ keyProvider: "exa", authKind: "api-key" }];
    case "tavily-search":
      return [{ keyProvider: "tavily", authKind: "api-key" }];
    case "anthropic-search":
      // Both credential paths are first-class: api-key uses the native
      // `web_search` server tool; OAuth (Claude Code subprocess) may or
      // may not invoke the server tool but still returns a fully formed
      // assistant message with URL citations as text — both shapes are
      // parsed by the chat-LLM search wrapper.
      return [
        { keyProvider: "anthropic", authKind: "api-key" },
        { keyProvider: "claude-code-oauth", authKind: "oauth" },
      ];
    case "openai-search":
      return [{ keyProvider: "openai", authKind: "api-key" }];
    case "gemini-search":
      return [{ keyProvider: "google-gemini", authKind: "api-key" }];
    case "perplexity-search":
      return [{ keyProvider: "perplexity", authKind: "api-key" }];
    case "xai-search":
      return [{ keyProvider: "xai", authKind: "api-key" }];
    case "mistral-search":
      return [{ keyProvider: "mistral", authKind: "api-key" }];
    case "glm-search":
      return [{ keyProvider: "glm", authKind: "api-key" }];
    case "openrouter-search":
      return [{ keyProvider: "openrouter", authKind: "api-key" }];
    default:
      return [];
  }
}

/**
 * Legacy single-slot helper — kept for backward compat with call sites that
 * only care about presence checks. Returns the FIRST credential slot (api-key
 * preferred). Callers that need the full multi-slot list should use
 * `getKeyProvidersForSearch` directly.
 */
export function getKeyProviderForSearch(
  id: SearchProviderId | string,
): ApiKeyProvider | null {
  const options = getKeyProvidersForSearch(id);
  return options[0]?.keyProvider ?? null;
}

/** All search provider IDs in canonical order — used by the Settings picker. */
export const ALL_SEARCH_PROVIDER_IDS: readonly SearchProviderId[] = [
  "brave",
  "exa-search",
  "tavily-search",
  "anthropic-search",
  "openai-search",
  "gemini-search",
  "perplexity-search",
  "xai-search",
  "mistral-search",
  "glm-search",
  "openrouter-search",
] as const;

/** Default priority chain seed — preserves pre-5.5.G "Brave-only" behaviour. */
export const DEFAULT_SEARCH_PROVIDERS: SearchProviderEntry[] = [
  { id: "brave", enabled: true },
];

/**
 * Defensive validator: returns true if the value is a SearchProviderEntry[]
 * with the right shape (id string, enabled boolean) for every entry.
 */
export function isValidSearchProviders(
  value: unknown,
): value is SearchProviderEntry[] {
  if (!Array.isArray(value)) return false;
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return false;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string" || e.id.length === 0) return false;
    if (typeof e.enabled !== "boolean") return false;
    if (e.config !== undefined) {
      if (typeof e.config !== "object" || e.config === null) return false;
      const cfg = e.config as Record<string, unknown>;
      if (cfg.modelId !== undefined && typeof cfg.modelId !== "string") {
        return false;
      }
    }
  }
  return true;
}
