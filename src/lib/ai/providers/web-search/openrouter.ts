// Phase 5.5.B.8 — OpenRouter `:online` plugin adapter.
//
// OpenRouter ships two equivalent ways to enable web search:
//   1. Slug suffix:  `openai/gpt-4o:online`
//   2. Explicit plugin entry: `plugins: [{ id: "web", max_results?, engine? }]`
// The adapter emits the plugin entry (mode 2); the caller can ALSO call
// `withOnlineSuffix(modelId)` to flip to mode 1 — either path produces the
// same upstream behavior, so we let the chat handler pick based on per-model
// quirks.
//
// Engine is left undefined here; OpenRouter defaults to Exa, which costs
// $4 per 1000 results. Setting `engine: "firecrawl"` requires a separate
// API key on the OpenRouter side and is out of scope for 5.5.B.

import type {
  WebSearchAdapter,
  WebSearchParseResult,
} from "@/lib/ai/web-search/adapter";
import type {
  WebCitation,
  WebSearchCapability,
  WebSearchOptions,
} from "@/lib/ai/web-search/types";

export type OpenRouterWebEngine = "exa" | "parallel" | "firecrawl";

export interface OpenRouterWebPlugin {
  id: "web";
  max_results?: number;
  engine?: OpenRouterWebEngine;
}

const MAX_RESULTS_FLOOR = 1;
const MAX_RESULTS_CEILING = 10;

export function buildOpenRouterWebPlugin(
  opts: WebSearchOptions,
): OpenRouterWebPlugin {
  const plugin: OpenRouterWebPlugin = { id: "web" };
  if (typeof opts.maxUses === "number" && Number.isFinite(opts.maxUses)) {
    plugin.max_results = Math.max(
      MAX_RESULTS_FLOOR,
      Math.min(MAX_RESULTS_CEILING, Math.floor(opts.maxUses)),
    );
  }
  return plugin;
}

const ONLINE_SUFFIX = ":online";

/** Append `:online` to a model slug; idempotent on already-suffixed slugs. */
export function withOnlineSuffix(modelId: string): string {
  if (typeof modelId !== "string" || modelId.length === 0) return modelId;
  if (modelId.endsWith(ONLINE_SUFFIX)) return modelId;
  return `${modelId}${ONLINE_SUFFIX}`;
}

interface OpenRouterUrlCitationAnnotation {
  type?: string;
  url_citation?: {
    url?: string;
    title?: string;
    content?: string;
    start_index?: number;
    end_index?: number;
  };
}

interface OpenRouterChoice {
  message?: { annotations?: OpenRouterUrlCitationAnnotation[] };
  delta?: { annotations?: OpenRouterUrlCitationAnnotation[] };
}

interface OpenRouterStreamEvent {
  choices?: OpenRouterChoice[];
}

export function parseOpenRouterWebSearchEvent(
  event: unknown,
): WebSearchParseResult | null {
  if (typeof event !== "object" || event === null) return null;
  const e = event as OpenRouterStreamEvent;
  const choice = e.choices?.[0];
  if (!choice) return null;
  const annotations =
    choice.message?.annotations ?? choice.delta?.annotations ?? null;
  if (!Array.isArray(annotations) || annotations.length === 0) return null;
  const out: WebCitation[] = [];
  for (const a of annotations) {
    if (!a || a.type !== "url_citation") continue;
    const uc = a.url_citation;
    if (!uc || typeof uc.url !== "string" || !uc.url) continue;
    const span: WebCitation["charSpan"] | undefined =
      typeof uc.start_index === "number" && typeof uc.end_index === "number"
        ? [uc.start_index, uc.end_index]
        : undefined;
    out.push({
      result: {
        url: uc.url,
        title: typeof uc.title === "string" && uc.title ? uc.title : uc.url,
        snippet: typeof uc.content === "string" ? uc.content : "",
        provider: "openrouter",
      },
      messageBlockIndex: 0,
      ...(span ? { charSpan: span } : {}),
    });
  }
  if (out.length === 0) return null;
  return { citations: out, usage: { results: out.length } };
}

export const OPENROUTER_WEB_SEARCH_CAPABILITY: WebSearchCapability = {
  paramsSupported: ["maxUses"],
  pricePerResult: 0.004,
};

export const OPENROUTER_WEB_SEARCH_ADAPTER: WebSearchAdapter = {
  providerId: "openrouter",
  capability: OPENROUTER_WEB_SEARCH_CAPABILITY,
  buildToolBlock: buildOpenRouterWebPlugin,
  parseStreamEvent: parseOpenRouterWebSearchEvent,
};
