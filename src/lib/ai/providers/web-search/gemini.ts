// Phase 5.5.B.3 — Gemini `google_search` adapter.
//
// Gemini 2.0+ uses the `google_search` tool (no config object). Legacy 1.5
// expects `google_search_retrieval` with a dynamic-retrieval threshold — we
// flip `supportsWebSearch` only for 2.5+ in the registry so this adapter
// never has to emit the legacy shape. If/when 1.5 is brought back, switch
// the dispatcher on `modelId` rather than mixing shapes here.
//
// Citations arrive in the FINAL response candidate as `groundingMetadata`:
//   - `groundingChunks: [{ web: { uri, title } }, ...]`        — URL + title
//   - `groundingSupports: [{ segment, groundingChunkIndices }]` — span map
// The parser builds one citation per chunk and folds spans back onto them
// when a support entry references the chunk's index.

import type {
  WebSearchAdapter,
  WebSearchParseResult,
} from "@/lib/ai/web-search/adapter";
import type {
  WebCitation,
  WebSearchCapability,
  WebSearchOptions,
} from "@/lib/ai/web-search/types";

export interface GeminiGoogleSearchTool {
  google_search: Record<string, never>;
}

export function buildGeminiGoogleSearchTool(
  _opts: WebSearchOptions,
): GeminiGoogleSearchTool {
  // google_search is a config-less server tool. WebSearchOptions knobs
  // (maxUses, domains) are not exposed by Gemini's grounding API in 2.5;
  // we surface this via `paramsSupported: []` on the capability.
  return { google_search: {} };
}

interface GeminiGroundingChunk {
  web?: { uri?: string; title?: string };
}

interface GeminiGroundingSupport {
  segment?: { startIndex?: number; endIndex?: number; text?: string };
  groundingChunkIndices?: number[];
}

interface GeminiCandidate {
  groundingMetadata?: {
    groundingChunks?: GeminiGroundingChunk[];
    groundingSupports?: GeminiGroundingSupport[];
    webSearchQueries?: string[];
  };
}

interface GeminiResponseEnvelope {
  candidates?: GeminiCandidate[];
}

export function parseGeminiWebSearchEvent(
  event: unknown,
): WebSearchParseResult | null {
  if (typeof event !== "object" || event === null) return null;
  const e = event as GeminiResponseEnvelope;
  const cand = e.candidates?.[0];
  const gm = cand?.groundingMetadata;
  if (!gm) return null;
  const chunks = Array.isArray(gm.groundingChunks) ? gm.groundingChunks : [];
  const supports = Array.isArray(gm.groundingSupports)
    ? gm.groundingSupports
    : [];

  const citations: (WebCitation | null)[] = chunks.map((c) => {
    const url = c?.web?.uri;
    if (typeof url !== "string" || !url) return null;
    const title =
      typeof c.web?.title === "string" && c.web.title ? c.web.title : url;
    return {
      result: { url, title, snippet: "", provider: "google-gemini" },
      messageBlockIndex: 0,
    };
  });

  for (const s of supports) {
    const idx = s.groundingChunkIndices?.[0];
    if (typeof idx !== "number") continue;
    const target = citations[idx];
    if (!target) continue;
    const seg = s.segment;
    if (
      seg &&
      typeof seg.startIndex === "number" &&
      typeof seg.endIndex === "number" &&
      seg.endIndex >= seg.startIndex
    ) {
      target.charSpan = [seg.startIndex, seg.endIndex];
    }
  }

  const out = citations.filter((c): c is WebCitation => c !== null);
  if (out.length === 0) return null;
  return { citations: out, usage: { calls: 1, results: out.length } };
}

export const GEMINI_WEB_SEARCH_CAPABILITY: WebSearchCapability = {
  paramsSupported: [],
  pricePerCall: 0.035,
};

export const GEMINI_WEB_SEARCH_ADAPTER: WebSearchAdapter = {
  providerId: "google-gemini",
  capability: GEMINI_WEB_SEARCH_CAPABILITY,
  buildToolBlock: buildGeminiGoogleSearchTool,
  parseStreamEvent: parseGeminiWebSearchEvent,
};
