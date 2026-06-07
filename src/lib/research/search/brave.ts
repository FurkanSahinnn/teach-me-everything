// Brave Search Web API client (BYOK).
// API: GET https://api.search.brave.com/res/v1/web/search?q=<query>&count=<n>
// Auth: `X-Subscription-Token: <key>` header
//
// This module is the "Konu ara → Kaynak ekle" modal's data source (5.5.E).
// Brave returns a list of URLs + titles + descriptions for a query; the
// modal then hands the selected URLs to `ingestResearchUrl` (the existing
// 7-provider research pipeline) for content extraction. Brave itself is not
// a research extractor — that's why it lives outside `RESEARCH_PRESETS`.
//
// Docs: https://api.search.brave.com/app/documentation/web-search/get-started

import { smartFetch } from "@/lib/tauri/fetch";
import { ProviderError } from "@/lib/ai/providers/types";

const ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

export type BraveFreshness = "pd" | "pw" | "pm" | "py";
export type BraveSafesearch = "strict" | "moderate" | "off";

export type BraveSearchOptions = {
  query: string;
  /** 1–20. Defaults to 10. Brave clamps server-side too, but we guard. */
  count?: number;
  /** pd=24h, pw=week, pm=month, py=year. Omit for no recency filter. */
  freshness?: BraveFreshness;
  /** strict / moderate / off. Default: moderate (Brave's default). */
  safesearch?: BraveSafesearch;
  signal?: AbortSignal;
};

export type BraveSearchResult = {
  url: string;
  title: string;
  description: string;
  /** Free-form age string from Brave (e.g. "2 days ago"). */
  age?: string | undefined;
  /** Optional favicon URL Brave returns inline for some results. */
  faviconUrl?: string | undefined;
};

export class BraveSearchError extends ProviderError {
  constructor(status: number, code: string, message: string) {
    super(status, code, message);
    this.name = "BraveSearchError";
  }
}

type BraveApiResult = {
  url?: string;
  title?: string;
  description?: string;
  age?: string;
  meta_url?: { favicon?: string };
  profile?: { img?: string };
};

type BraveApiResponse = {
  web?: { results?: BraveApiResult[] };
  error?: { code?: string; detail?: string };
  message?: string;
};

export class BraveSearchProvider {
  async search(
    opts: BraveSearchOptions,
    apiKey: string,
  ): Promise<BraveSearchResult[]> {
    if (!apiKey) {
      throw new BraveSearchError(
        401,
        "missing_key",
        "Brave Search requires an API key",
      );
    }
    const query = opts.query.trim();
    if (query.length === 0) {
      throw new BraveSearchError(
        400,
        "empty_query",
        "Brave Search requires a non-empty query",
      );
    }
    const params = new URLSearchParams({ q: query });
    const count = clampCount(opts.count);
    params.set("count", String(count));
    if (opts.freshness) params.set("freshness", opts.freshness);
    if (opts.safesearch) params.set("safesearch", opts.safesearch);

    let res: Response;
    try {
      res = await smartFetch(`${ENDPOINT}?${params.toString()}`, {
        method: "GET",
        headers: {
          "X-Subscription-Token": apiKey,
          Accept: "application/json",
        },
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BraveSearchError(0, "fetch_failed", msg);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new BraveSearchError(
        res.status,
        "upstream_error",
        `Brave returned ${res.status}: ${body.slice(0, 200)}`,
      );
    }
    const data = (await res.json()) as BraveApiResponse;
    if (data.error) {
      throw new BraveSearchError(
        502,
        "upstream_error",
        data.error.detail ?? data.error.code ?? "Brave returned an error envelope",
      );
    }
    const raw = data.web?.results ?? [];
    return raw
      .filter((r): r is BraveApiResult & { url: string } => typeof r.url === "string" && r.url.length > 0)
      .map((r) => {
        const out: BraveSearchResult = {
          url: r.url,
          title: r.title ?? r.url,
          description: r.description ?? "",
        };
        if (r.age) out.age = r.age;
        const favicon = r.meta_url?.favicon ?? r.profile?.img;
        if (favicon) out.faviconUrl = favicon;
        return out;
      });
  }
}

function clampCount(input: number | undefined): number {
  if (typeof input !== "number" || !Number.isFinite(input)) return 10;
  const intCount = Math.floor(input);
  if (intCount < 1) return 1;
  if (intCount > 20) return 20;
  return intCount;
}

let singleton: BraveSearchProvider | null = null;
export function getBraveSearchProvider(): BraveSearchProvider {
  if (!singleton) singleton = new BraveSearchProvider();
  return singleton;
}
