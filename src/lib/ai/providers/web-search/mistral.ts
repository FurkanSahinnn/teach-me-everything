// Phase 5.5.B.6 — Mistral Agents API web search adapter.
//
// Mistral exposes web search via the Agents API (`/v1/agents/completions`)
// rather than the regular chat completions endpoint. Web is enabled with a
// built-in connector: `connectors: [{ type: "web_search" }]`. Citations
// arrive on the assistant message as a `references: [...]` array (and may
// also appear as `tool.execution` events during streaming).
//
// `paramsSupported` is empty — Mistral's connector accepts no client-side
// knobs (no max_results, no domain filter as of 2026). We pass the connector
// straight through so future params remain a one-field addition.

import type {
  WebSearchAdapter,
  WebSearchParseResult,
} from "@/lib/ai/web-search/adapter";
import type {
  WebCitation,
  WebSearchCapability,
  WebSearchOptions,
} from "@/lib/ai/web-search/types";

export interface MistralWebSearchConnector {
  type: "web_search";
}

export function buildMistralWebSearchConnector(
  _opts: WebSearchOptions,
): MistralWebSearchConnector {
  return { type: "web_search" };
}

interface MistralReference {
  url?: string;
  title?: string;
  description?: string;
  snippet?: string;
  date?: string;
}

interface MistralStreamEvent {
  type?: string;
  references?: MistralReference[];
  output?: { references?: MistralReference[] };
  message?: { references?: MistralReference[] };
}

export function parseMistralWebSearchEvent(
  event: unknown,
): WebSearchParseResult | null {
  if (typeof event !== "object" || event === null) return null;
  const e = event as MistralStreamEvent;
  const refs =
    (Array.isArray(e.references) && e.references) ||
    (Array.isArray(e.output?.references) && e.output?.references) ||
    (Array.isArray(e.message?.references) && e.message?.references) ||
    null;
  if (!refs || refs.length === 0) return null;
  const out: WebCitation[] = [];
  for (const r of refs) {
    if (!r || typeof r.url !== "string" || !r.url) continue;
    const title = typeof r.title === "string" && r.title ? r.title : r.url;
    const snippet =
      typeof r.snippet === "string"
        ? r.snippet
        : typeof r.description === "string"
          ? r.description
          : "";
    const published = typeof r.date === "string" && r.date ? r.date : undefined;
    out.push({
      result: {
        url: r.url,
        title,
        snippet,
        provider: "mistral",
        ...(published ? { publishedAt: published } : {}),
      },
      messageBlockIndex: 0,
    });
  }
  if (out.length === 0) return null;
  return { citations: out, usage: { calls: 1, results: out.length } };
}

export const MISTRAL_WEB_SEARCH_CAPABILITY: WebSearchCapability = {
  paramsSupported: [],
  pricePerCall: 0.03,
};

export const MISTRAL_WEB_SEARCH_ADAPTER: WebSearchAdapter = {
  providerId: "mistral",
  capability: MISTRAL_WEB_SEARCH_CAPABILITY,
  buildToolBlock: buildMistralWebSearchConnector,
  parseStreamEvent: parseMistralWebSearchEvent,
};
