// Phase 5.5.B.4 — Perplexity Sonar adapter.
//
// Sonar models ARE searchers — there is no tool block. Instead the request
// body carries extra params and the response envelope adds two top-level
// arrays: `citations` (URL strings) and `search_results` (rich metadata).
//
// Request shape (spread into the chat completions body):
//   {
//     model: "sonar",
//     messages: [...],
//     search_mode: "low" | "medium" | "high",
//     search_domain_filter: ["example.com", "-spammy.com"],
//     search_recency_filter: "month" | "week" | "day" | "hour",
//     web_search_options: { search_context_size: "medium" }
//   }
// Domain filter unifies allow/block lists — block entries get a `-` prefix.

import type {
  WebSearchAdapter,
  WebSearchParseResult,
} from "@/lib/ai/web-search/adapter";
import type {
  WebCitation,
  WebSearchCapability,
  WebSearchOptions,
} from "@/lib/ai/web-search/types";

export type PerplexitySearchMode = "low" | "medium" | "high";
export type PerplexityRecency = "month" | "week" | "day" | "hour";

export interface PerplexityRequestParams {
  search_mode: PerplexitySearchMode;
  web_search_options: { search_context_size: PerplexitySearchMode };
  search_recency_filter?: PerplexityRecency;
  search_domain_filter?: string[];
}

function recencyDaysToFilter(
  days: number | undefined,
): PerplexityRecency | undefined {
  if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) {
    return undefined;
  }
  if (days <= 1) return "hour";
  if (days <= 7) return "day";
  if (days <= 31) return "week";
  return "month";
}

function buildDomainFilter(opts: WebSearchOptions): string[] | undefined {
  const out: string[] = [];
  if (Array.isArray(opts.allowedDomains)) {
    for (const d of opts.allowedDomains) {
      if (typeof d !== "string") continue;
      const t = d.trim();
      if (t) out.push(t);
    }
  }
  if (Array.isArray(opts.blockedDomains)) {
    for (const d of opts.blockedDomains) {
      if (typeof d !== "string") continue;
      const t = d.trim();
      if (t) out.push(`-${t}`);
    }
  }
  return out.length > 0 ? out : undefined;
}

export function buildPerplexityRequestParams(
  opts: WebSearchOptions,
): PerplexityRequestParams {
  const mode: PerplexitySearchMode = opts.searchMode === "deep" ? "high" : "medium";
  const params: PerplexityRequestParams = {
    search_mode: mode,
    web_search_options: { search_context_size: mode },
  };
  const recency = recencyDaysToFilter(opts.recencyDays);
  if (recency) params.search_recency_filter = recency;
  const filter = buildDomainFilter(opts);
  if (filter) params.search_domain_filter = filter;
  return params;
}

interface PerplexitySearchResult {
  url?: string;
  title?: string;
  date?: string;
  snippet?: string;
}

interface PerplexityResponseEnvelope {
  citations?: string[];
  search_results?: PerplexitySearchResult[];
}

export function parsePerplexityWebSearchEvent(
  event: unknown,
): WebSearchParseResult | null {
  if (typeof event !== "object" || event === null) return null;
  const e = event as PerplexityResponseEnvelope;

  const richResults = Array.isArray(e.search_results) ? e.search_results : [];
  const plainUrls = Array.isArray(e.citations) ? e.citations : [];

  const byUrl = new Map<string, WebCitation>();
  for (const r of richResults) {
    if (!r || typeof r.url !== "string" || !r.url) continue;
    const title = typeof r.title === "string" && r.title ? r.title : r.url;
    const published =
      typeof r.date === "string" && r.date ? r.date : undefined;
    byUrl.set(r.url, {
      result: {
        url: r.url,
        title,
        snippet: typeof r.snippet === "string" ? r.snippet : "",
        provider: "perplexity",
        ...(published ? { publishedAt: published } : {}),
      },
      messageBlockIndex: 0,
    });
  }
  for (const url of plainUrls) {
    if (typeof url !== "string" || !url) continue;
    if (byUrl.has(url)) continue;
    byUrl.set(url, {
      result: { url, title: url, snippet: "", provider: "perplexity" },
      messageBlockIndex: 0,
    });
  }

  if (byUrl.size === 0) return null;
  const citations = [...byUrl.values()];
  return { citations, usage: { calls: 1, results: citations.length } };
}

export const PERPLEXITY_WEB_SEARCH_CAPABILITY: WebSearchCapability = {
  paramsSupported: ["searchMode", "allowedDomains", "blockedDomains", "recencyDays"],
};

export const PERPLEXITY_WEB_SEARCH_ADAPTER: WebSearchAdapter = {
  providerId: "perplexity",
  capability: PERPLEXITY_WEB_SEARCH_CAPABILITY,
  buildToolBlock: buildPerplexityRequestParams,
  parseStreamEvent: parsePerplexityWebSearchEvent,
};
