// Phase 5.5.G — Search provider registry (singleton cache + per-id construction).
//
// Mirrors the chat/embed/research registry shape so adding a new search
// backend only needs (a) a SearchProviderId literal, (b) an adapter class,
// (c) a switch case here. Unknown ids return `null` so a stale priority-list
// entry persisted from a newer build degrades to "skipped" rather than
// throwing — important because the dispatcher walks user-ordered entries.

import { BraveUnifiedSearchProvider } from "./brave-unified";
import { CHAT_LLM_SEARCH_CATALOG, ChatLlmSearchProvider } from "./chat-llm-search";
import { ExaSearchProvider } from "./exa";
import { TavilySearchProvider } from "./tavily";
import type { SearchProviderId, UnifiedSearchProvider } from "./types";

const cache = new Map<SearchProviderId, UnifiedSearchProvider>();

function construct(id: SearchProviderId): UnifiedSearchProvider | null {
  switch (id) {
    case "brave":
      return new BraveUnifiedSearchProvider();
    case "exa-search":
      return new ExaSearchProvider();
    case "tavily-search":
      return new TavilySearchProvider();
    case "anthropic-search":
    case "openai-search":
    case "gemini-search":
    case "perplexity-search":
    case "xai-search":
    case "mistral-search":
    case "glm-search":
    case "openrouter-search": {
      const config = CHAT_LLM_SEARCH_CATALOG[id];
      if (!config) return null;
      return new ChatLlmSearchProvider(config);
    }
    default: {
      // Exhaustiveness — TS will yell here if a new id is added without a case.
      const _never: never = id;
      void _never;
      return null;
    }
  }
}

/** Return the singleton search provider for an id, or `null` if unknown / not yet wired. */
export function getSearchProvider(
  id: SearchProviderId | string,
): UnifiedSearchProvider | null {
  // Treat plain string as candidate — accept SearchProviderId-typed values
  // AND forward-compat strings from stored prefs. Anything that doesn't
  // resolve falls through to `null`.
  const candidate = id as SearchProviderId;
  let p = cache.get(candidate);
  if (p) return p;
  const built = construct(candidate);
  if (built) cache.set(candidate, built);
  return built;
}

/** Test seam — wipes the singleton cache so each test sees fresh state. */
export function _clearSearchRegistryCache(): void {
  cache.clear();
}
