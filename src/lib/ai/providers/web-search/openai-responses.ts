// Phase 5.5.B.2 — OpenAI Responses API web_search adapter.
//
// OpenAI's `/v1/responses` endpoint accepts a `web_search` built-in tool.
// Streaming events of interest:
//   { type: "response.output_item.added", item: { type: "web_search_call", ... } }
//   { type: "response.output_item.done",  item: { type: "web_search_call", results: [...] } }
//   { type: "response.output_text.annotation.added", annotation: { type: "url_citation", ... } }
// Some response shapes carry citation results inline on the call item; others
// surface them as `url_citation` annotations attached to the text output. We
// parse both — adapters MUST be tolerant of either path because OpenAI has
// rolled the schema multiple times.
//
// `search_context_size` controls retrieval depth and price (low/medium/high).
// We map `searchMode: "deep"` → "high"; everything else → "medium".

import type {
  WebSearchAdapter,
  WebSearchParseResult,
} from "@/lib/ai/web-search/adapter";
import type {
  WebCitation,
  WebSearchCapability,
  WebSearchOptions,
} from "@/lib/ai/web-search/types";

export type OpenAIWebSearchContextSize = "low" | "medium" | "high";

export interface OpenAIWebSearchTool {
  type: "web_search";
  search_context_size: OpenAIWebSearchContextSize;
}

export function buildOpenAIWebSearchTool(
  opts: WebSearchOptions,
): OpenAIWebSearchTool {
  const size: OpenAIWebSearchContextSize =
    opts.searchMode === "deep" ? "high" : "medium";
  return {
    type: "web_search",
    search_context_size: size,
  };
}

interface OpenAICallResult {
  url?: string;
  title?: string;
  snippet?: string;
  published_date?: string;
}

interface OpenAIAnnotation {
  type?: string;
  url?: string;
  title?: string;
  start_index?: number;
  end_index?: number;
}

interface OpenAIStreamEvent {
  type?: string;
  output_index?: number;
  item?: {
    type?: string;
    results?: OpenAICallResult[];
  };
  annotation?: OpenAIAnnotation;
}

export function parseOpenAIResponsesWebSearchEvent(
  event: unknown,
): WebSearchParseResult | null {
  if (typeof event !== "object" || event === null) return null;
  const e = event as OpenAIStreamEvent;
  const blockIndex = typeof e.output_index === "number" ? e.output_index : 0;

  if (
    (e.type === "response.output_item.done" ||
      e.type === "response.output_item.added") &&
    e.item?.type === "web_search_call"
  ) {
    const results = e.item.results;
    if (!Array.isArray(results) || results.length === 0) return null;
    const out: WebCitation[] = [];
    for (const r of results) {
      if (!r || typeof r.url !== "string" || !r.url) continue;
      const published =
        typeof r.published_date === "string" && r.published_date
          ? r.published_date
          : undefined;
      out.push({
        result: {
          url: r.url,
          title: typeof r.title === "string" && r.title ? r.title : r.url,
          snippet: typeof r.snippet === "string" ? r.snippet : "",
          provider: "openai",
          ...(published ? { publishedAt: published } : {}),
        },
        messageBlockIndex: blockIndex,
      });
    }
    if (out.length === 0) return null;
    return { citations: out, usage: { results: out.length } };
  }

  if (
    e.type === "response.output_text.annotation.added" &&
    e.annotation?.type === "url_citation"
  ) {
    const a = e.annotation;
    if (typeof a.url !== "string" || !a.url) return null;
    const span: WebCitation["charSpan"] | undefined =
      typeof a.start_index === "number" && typeof a.end_index === "number"
        ? [a.start_index, a.end_index]
        : undefined;
    const citation: WebCitation = {
      result: {
        url: a.url,
        title: typeof a.title === "string" && a.title ? a.title : a.url,
        snippet: "",
        provider: "openai",
      },
      messageBlockIndex: blockIndex,
      ...(span ? { charSpan: span } : {}),
    };
    return { citations: [citation] };
  }

  return null;
}

export const OPENAI_RESPONSES_WEB_SEARCH_CAPABILITY: WebSearchCapability = {
  paramsSupported: ["searchMode"],
  pricePerCall: 0.035,
};

export const OPENAI_RESPONSES_WEB_SEARCH_ADAPTER: WebSearchAdapter = {
  // 5.5.H: re-targeted to the dedicated `openai-responses` provider so the
  // built-in `web_search` tool envelope is routed to `/v1/responses` (Chat
  // Completions rejects this tool with HTTP 400).
  providerId: "openai-responses",
  capability: OPENAI_RESPONSES_WEB_SEARCH_CAPABILITY,
  buildToolBlock: buildOpenAIWebSearchTool,
  parseStreamEvent: parseOpenAIResponsesWebSearchEvent,
};
