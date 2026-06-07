// Tavily research provider (BYOK — free tier available).
// API: POST https://api.tavily.com/extract
// Optimized for research workflows; returns clean raw content per URL.
// Docs: https://docs.tavily.com/docs/rest-api/api-reference/endpoint/extract

import { smartFetch } from "@/lib/tauri/fetch";
import {
  ResearchError,
  type ResearchProvider,
  type ResearchProviderId,
  type ResearchRequest,
  type ResearchResult,
} from "./types";

const ID: ResearchProviderId = "tavily";
const ENDPOINT = "https://api.tavily.com/extract";

type TavilyResultItem = {
  url?: string;
  raw_content?: string;
  title?: string;
};

type TavilyResponse = {
  results?: TavilyResultItem[];
  failed_results?: { url?: string; error?: string }[];
};

export class TavilyResearchProvider implements ResearchProvider {
  readonly id = ID;
  readonly capabilities = {
    jsRender: true,
    search: true,
    local: false,
    freeTier: true,
  } as const;

  async fetchContent(req: ResearchRequest): Promise<ResearchResult> {
    if (!req.apiKey) {
      throw new ResearchError(401, "missing_key", "Tavily requires an API key");
    }
    let res: Response;
    try {
      res = await smartFetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls: [req.url],
          api_key: req.apiKey,
          extract_depth: "advanced",
        }),
        ...(req.signal ? { signal: req.signal } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ResearchError(0, "fetch_failed", msg);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ResearchError(
        res.status,
        "upstream_error",
        `Tavily returned ${res.status}: ${body.slice(0, 200)}`,
      );
    }
    const data = (await res.json()) as TavilyResponse;
    const first = data.results?.[0];
    if (!first || typeof first.raw_content !== "string" || first.raw_content.length === 0) {
      const failure = data.failed_results?.[0]?.error;
      throw new ResearchError(
        422,
        "empty_content",
        failure ?? "Tavily returned no content",
      );
    }
    const markdown = first.raw_content.replace(/\r\n/g, "\n").trim();
    return {
      markdown,
      url: first.url ?? req.url,
      title: first.title ?? req.url,
      byteSize: new Blob([markdown]).size,
      providerId: ID,
      meta: { extractor: "tavily" },
    };
  }
}
