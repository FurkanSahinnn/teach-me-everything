// Phase 5.5.G — Exa Search adapter (URL-list mode, distinct from `/contents`).
//
// Exa offers two endpoints:
//   - POST https://api.exa.ai/search   — neural search → URL list (this file)
//   - POST https://api.exa.ai/contents — URL content extraction (already
//     wired as `ExaResearchProvider` in src/lib/research/providers/exa.ts)
//
// The two are separate concerns: the Settings priority list uses `exa-search`
// for the modal, while the AddUrlModal's webProvider chip uses `exa` for
// content extraction. Both ride on the same API key (`apiKeys.exa`).
//
// Docs: https://docs.exa.ai/reference/search

import { smartFetch } from "@/lib/tauri/fetch";
import { BraveSearchError } from "./brave";
import type {
  SearchInput,
  SearchProviderId,
  SearchResultItem,
  UnifiedSearchProvider,
} from "./types";

const ENDPOINT = "https://api.exa.ai/search";
const MAX_COUNT = 25;
const DEFAULT_COUNT = 10;

type ExaSearchItem = {
  id?: string;
  url?: string;
  title?: string;
  author?: string;
  publishedDate?: string;
  text?: string;
  image?: string;
  favicon?: string;
  score?: number;
};

type ExaSearchResponseBody = {
  results?: ExaSearchItem[];
  autopromptString?: string;
};

function clampCount(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_COUNT;
  if (raw < 1) return 1;
  if (raw > MAX_COUNT) return MAX_COUNT;
  return Math.floor(raw);
}

export class ExaSearchProvider implements UnifiedSearchProvider {
  readonly id: SearchProviderId = "exa-search";
  readonly label = "Exa Search";
  readonly kind = "pure" as const;
  // Exa's neural search is $0.005/query on standard tier; "auto" / "fast"
  // search modes occasionally fall below this. Conservative estimate.
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
        "Exa Search requires an API key",
      );
    }

    let res: Response;
    try {
      const requestInit: RequestInit = {
        method: "POST",
        headers: {
          "x-api-key": input.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          numResults: clampCount(input.count),
          // `neural` is Exa's flagship; falls back to keyword when neural
          // can't find enough hits. Cheaper than `auto` which queries both.
          type: "neural",
          contents: { text: false },
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
        `Exa Search returned ${res.status}: ${body.slice(0, 200)}`,
      );
    }

    const data = (await res.json()) as ExaSearchResponseBody;
    const items = Array.isArray(data.results) ? data.results : [];

    return items
      .filter(
        (r): r is ExaSearchItem & { url: string } =>
          typeof r.url === "string" && r.url.length > 0,
      )
      .map((r) => {
        const item: SearchResultItem = {
          url: r.url,
          title: typeof r.title === "string" && r.title ? r.title : r.url,
          // Exa's search response doesn't carry a snippet unless `contents`
          // is requested. Surface a stable empty string so the modal renders
          // the row without per-item conditionals.
          description: "",
        };
        if (r.publishedDate) item.age = r.publishedDate;
        if (r.favicon) item.faviconUrl = r.favicon;
        return item;
      });
  }
}
