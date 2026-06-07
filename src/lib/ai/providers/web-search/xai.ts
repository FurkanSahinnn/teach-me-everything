// Phase 5.5.B.5 — xAI Grok web_search adapter.
//
// xAI exposes a `/v1/responses` endpoint mirroring OpenAI's Responses API
// shape. The tool block accepts allow/excluded domain lists, max_search_results,
// and an enable_image_understanding flag (we leave that off — image grounding
// is a separate UI concern).
//
// Streaming envelope reuses the `response.output_item.added/done` shape; we
// share the core parsing logic with the OpenAI adapter but tag citations with
// `provider: "xai"` so the peek modal renders the correct badge.

import type {
  WebSearchAdapter,
  WebSearchParseResult,
} from "@/lib/ai/web-search/adapter";
import type {
  WebCitation,
  WebSearchCapability,
  WebSearchOptions,
} from "@/lib/ai/web-search/types";

const MAX_RESULTS_FLOOR = 1;
const MAX_RESULTS_CEILING = 20;

export interface XaiWebSearchTool {
  type: "web_search";
  allowed_domains?: string[];
  excluded_domains?: string[];
  max_search_results?: number;
}

function cleanDomains(list: string[] | undefined): string[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const trimmed = list
    .map((d) => (typeof d === "string" ? d.trim() : ""))
    .filter((d) => d.length > 0);
  return trimmed.length > 0 ? trimmed : undefined;
}

export function buildXaiWebSearchTool(
  opts: WebSearchOptions,
): XaiWebSearchTool {
  const tool: XaiWebSearchTool = { type: "web_search" };
  const allowed = cleanDomains(opts.allowedDomains);
  if (allowed) tool.allowed_domains = allowed;
  const excluded = cleanDomains(opts.blockedDomains);
  if (excluded) tool.excluded_domains = excluded;
  if (typeof opts.maxUses === "number" && Number.isFinite(opts.maxUses)) {
    const clamped = Math.max(
      MAX_RESULTS_FLOOR,
      Math.min(MAX_RESULTS_CEILING, Math.floor(opts.maxUses)),
    );
    tool.max_search_results = clamped;
  }
  return tool;
}

interface XaiCallResult {
  url?: string;
  title?: string;
  snippet?: string;
  published_date?: string;
}

interface XaiStreamEvent {
  type?: string;
  output_index?: number;
  item?: { type?: string; results?: XaiCallResult[] };
}

export function parseXaiWebSearchEvent(
  event: unknown,
): WebSearchParseResult | null {
  if (typeof event !== "object" || event === null) return null;
  const e = event as XaiStreamEvent;
  if (
    e.type !== "response.output_item.done" &&
    e.type !== "response.output_item.added"
  ) {
    return null;
  }
  if (e.item?.type !== "web_search_call") return null;
  const results = e.item.results;
  if (!Array.isArray(results) || results.length === 0) return null;
  const blockIndex = typeof e.output_index === "number" ? e.output_index : 0;
  const out: WebCitation[] = [];
  for (const r of results) {
    if (!r || typeof r.url !== "string" || !r.url) continue;
    const title = typeof r.title === "string" && r.title ? r.title : r.url;
    const published =
      typeof r.published_date === "string" && r.published_date
        ? r.published_date
        : undefined;
    out.push({
      result: {
        url: r.url,
        title,
        snippet: typeof r.snippet === "string" ? r.snippet : "",
        provider: "xai",
        ...(published ? { publishedAt: published } : {}),
      },
      messageBlockIndex: blockIndex,
    });
  }
  if (out.length === 0) return null;
  return { citations: out, usage: { results: out.length } };
}

export const XAI_WEB_SEARCH_CAPABILITY: WebSearchCapability = {
  paramsSupported: ["allowedDomains", "blockedDomains", "maxUses"],
  pricePerResult: 0.025,
};

export const XAI_WEB_SEARCH_ADAPTER: WebSearchAdapter = {
  providerId: "xai",
  capability: XAI_WEB_SEARCH_CAPABILITY,
  buildToolBlock: buildXaiWebSearchTool,
  parseStreamEvent: parseXaiWebSearchEvent,
};
