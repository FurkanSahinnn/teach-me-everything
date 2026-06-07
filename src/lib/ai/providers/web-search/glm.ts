// Phase 5.5.B.7 — GLM (Zhipu / bigmodel.cn) web_search adapter.
//
// GLM exposes web search through a custom tool entry on its OpenAI-compat
// surface. Tool body:
//   {
//     type: "web_search",
//     web_search: {
//       enable: true,
//       search_result: true,
//       search_engine: "search_pro" | "search_std"
//     }
//   }
// Results appear at top-level `web_search: [{ link, title, content, ... }]`
// on the response envelope (not inside `choices[*]`).
//
// RISK note (`memory/project_phase55_plan.md` § 5.5.B.7): bigmodel.cn docs
// are Chinese-first and the schema has shifted across releases. The adapter
// is implemented best-effort; if a future API tweak breaks it the dispatcher
// can drop GLM by removing the entry from ADAPTERS.

import type {
  WebSearchAdapter,
  WebSearchParseResult,
} from "@/lib/ai/web-search/adapter";
import type {
  WebCitation,
  WebSearchCapability,
  WebSearchOptions,
} from "@/lib/ai/web-search/types";

export type GlmSearchEngine = "search_pro" | "search_std";

export interface GlmWebSearchTool {
  type: "web_search";
  web_search: {
    enable: true;
    search_result: true;
    search_engine: GlmSearchEngine;
  };
}

export function buildGlmWebSearchTool(
  opts: WebSearchOptions,
): GlmWebSearchTool {
  const engine: GlmSearchEngine =
    opts.searchMode === "deep" ? "search_pro" : "search_std";
  return {
    type: "web_search",
    web_search: { enable: true, search_result: true, search_engine: engine },
  };
}

interface GlmReference {
  link?: string;
  title?: string;
  content?: string;
  publish_date?: string;
  media?: string;
}

interface GlmResponseEnvelope {
  web_search?: GlmReference[];
}

export function parseGlmWebSearchEvent(
  event: unknown,
): WebSearchParseResult | null {
  if (typeof event !== "object" || event === null) return null;
  const e = event as GlmResponseEnvelope;
  const refs = Array.isArray(e.web_search) ? e.web_search : null;
  if (!refs || refs.length === 0) return null;
  const out: WebCitation[] = [];
  for (const r of refs) {
    if (!r || typeof r.link !== "string" || !r.link) continue;
    const title = typeof r.title === "string" && r.title ? r.title : r.link;
    const snippet = typeof r.content === "string" ? r.content : "";
    const published =
      typeof r.publish_date === "string" && r.publish_date
        ? r.publish_date
        : undefined;
    out.push({
      result: {
        url: r.link,
        title,
        snippet,
        provider: "glm",
        ...(published ? { publishedAt: published } : {}),
      },
      messageBlockIndex: 0,
    });
  }
  if (out.length === 0) return null;
  return { citations: out, usage: { calls: 1, results: out.length } };
}

export const GLM_WEB_SEARCH_CAPABILITY: WebSearchCapability = {
  paramsSupported: ["searchMode"],
  pricePerCall: 0.0035,
};

export const GLM_WEB_SEARCH_ADAPTER: WebSearchAdapter = {
  providerId: "glm",
  capability: GLM_WEB_SEARCH_CAPABILITY,
  buildToolBlock: buildGlmWebSearchTool,
  parseStreamEvent: parseGlmWebSearchEvent,
};
