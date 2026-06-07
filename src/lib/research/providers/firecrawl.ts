// Firecrawl research provider (BYOK).
// API: POST https://api.firecrawl.dev/v1/scrape
// Returns server-rendered Markdown for the URL with optional JS render.
// Docs: https://docs.firecrawl.dev/api-reference/endpoint/scrape

import { smartFetch } from "@/lib/tauri/fetch";
import {
  ResearchError,
  type ResearchProvider,
  type ResearchProviderId,
  type ResearchRequest,
  type ResearchResult,
} from "./types";

const ID: ResearchProviderId = "firecrawl";
const ENDPOINT = "https://api.firecrawl.dev/v1/scrape";

type FirecrawlResponse = {
  success?: boolean;
  data?: {
    markdown?: string;
    html?: string;
    metadata?: {
      title?: string;
      author?: string;
      description?: string;
      sourceURL?: string;
      ogUrl?: string;
    };
  };
  error?: string;
};

export class FirecrawlResearchProvider implements ResearchProvider {
  readonly id = ID;
  readonly capabilities = {
    jsRender: true,
    search: false,
    local: false,
    freeTier: false,
  } as const;

  async fetchContent(req: ResearchRequest): Promise<ResearchResult> {
    if (!req.apiKey) {
      throw new ResearchError(401, "missing_key", "Firecrawl requires an API key");
    }
    let res: Response;
    try {
      res = await smartFetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${req.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: req.url,
          formats: ["markdown"],
          onlyMainContent: true,
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
        `Firecrawl returned ${res.status}: ${body.slice(0, 200)}`,
      );
    }
    const data = (await res.json()) as FirecrawlResponse;
    if (!data.success || !data.data?.markdown) {
      throw new ResearchError(
        422,
        "empty_content",
        data.error ?? "Firecrawl returned no markdown content",
      );
    }
    const markdown = data.data.markdown.trim();
    const meta = data.data.metadata ?? {};
    const title = meta.title ?? meta.description ?? req.url;
    return {
      markdown,
      url: meta.sourceURL ?? meta.ogUrl ?? req.url,
      title,
      author: meta.author,
      byteSize: new Blob([markdown]).size,
      providerId: ID,
      meta: { extractor: "firecrawl" },
    };
  }
}
