// Phase 5.5.G — Tavily Search adapter (URL-list mode, distinct from `/extract`).
//
// Tavily offers two endpoints in the same REST surface:
//   - POST https://api.tavily.com/search  — query → URL list w/ snippets
//   - POST https://api.tavily.com/extract — URL content extraction (wired
//     as `TavilyResearchProvider` in src/lib/research/providers/tavily.ts)
//
// Both endpoints accept the API key in the JSON body (`api_key`), unlike
// most providers that use a header. Mirroring that quirk here keeps the
// adapter aligned with Tavily's expected request shape.
//
// Docs: https://docs.tavily.com/docs/rest-api/api-reference/endpoint/search

import { smartFetch } from "@/lib/tauri/fetch";
import { BraveSearchError } from "./brave";
import type {
  SearchInput,
  SearchProviderId,
  SearchResultItem,
  UnifiedSearchProvider,
} from "./types";

const ENDPOINT = "https://api.tavily.com/search";
const MAX_COUNT = 20;
const DEFAULT_COUNT = 10;

type TavilySearchItem = {
  url?: string;
  title?: string;
  content?: string;
  raw_content?: string | null;
  published_date?: string;
  score?: number;
};

type TavilySearchResponseBody = {
  query?: string;
  results?: TavilySearchItem[];
  answer?: string;
};

function clampCount(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_COUNT;
  if (raw < 1) return 1;
  if (raw > MAX_COUNT) return MAX_COUNT;
  return Math.floor(raw);
}

export class TavilySearchProvider implements UnifiedSearchProvider {
  readonly id: SearchProviderId = "tavily-search";
  readonly label = "Tavily Search";
  readonly kind = "pure" as const;
  // Tavily basic search ~$0.005/query on Standard tier; advanced is ~$0.01.
  // We use basic by default to keep the cost surface predictable.
  readonly costPerCallUsd = 0.005;
  readonly freeTierNote = "1,000 sorgu/ay ücretsiz";

  async search(input: SearchInput): Promise<SearchResultItem[]> {
    const query = input.query.trim();
    if (query.length === 0) {
      throw new BraveSearchError(
        400,
        "empty_query",
        "Search query must not be empty",
      );
    }
    if (!input.apiKey) {
      throw new BraveSearchError(
        401,
        "missing_key",
        "Tavily Search requires an API key",
      );
    }

    let res: Response;
    try {
      const requestInit: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: input.apiKey,
          query,
          max_results: clampCount(input.count),
          // "basic" is cheaper + faster; users can graduate to "advanced"
          // via a future Settings toggle (out of 5.5.G.B scope).
          search_depth: "basic",
          include_answer: false,
          include_raw_content: false,
        }),
      };
      if (input.signal) requestInit.signal = input.signal;
      res = await smartFetch(ENDPOINT, requestInit);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BraveSearchError(0, "fetch_failed", msg);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new BraveSearchError(
        res.status,
        "upstream_error",
        `Tavily Search returned ${res.status}: ${body.slice(0, 200)}`,
      );
    }

    const data = (await res.json()) as TavilySearchResponseBody;
    const items = Array.isArray(data.results) ? data.results : [];

    return items
      .filter(
        (r): r is TavilySearchItem & { url: string } =>
          typeof r.url === "string" && r.url.length > 0,
      )
      .map((r) => {
        const item: SearchResultItem = {
          url: r.url,
          title: typeof r.title === "string" && r.title ? r.title : r.url,
          description:
            typeof r.content === "string" && r.content ? r.content : "",
        };
        if (r.published_date) item.age = r.published_date;
        return item;
      });
  }
}
