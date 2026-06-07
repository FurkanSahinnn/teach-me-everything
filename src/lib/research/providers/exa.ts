// Exa research provider (BYOK).
// API: POST https://api.exa.ai/contents
// Returns plain text (not Markdown) for the URL, optionally with neural search.
// Docs: https://docs.exa.ai/reference/get-contents

import { smartFetch } from "@/lib/tauri/fetch";
import {
  ResearchError,
  type ResearchProvider,
  type ResearchProviderId,
  type ResearchRequest,
  type ResearchResult,
} from "./types";

const ID: ResearchProviderId = "exa";
const ENDPOINT = "https://api.exa.ai/contents";

type ExaContentItem = {
  id?: string;
  url?: string;
  title?: string;
  author?: string;
  text?: string;
};

type ExaResponse = {
  results?: ExaContentItem[];
};

export class ExaResearchProvider implements ResearchProvider {
  readonly id = ID;
  readonly capabilities = {
    jsRender: true,
    search: true,
    local: false,
    freeTier: true,
  } as const;

  async fetchContent(req: ResearchRequest): Promise<ResearchResult> {
    if (!req.apiKey) {
      throw new ResearchError(401, "missing_key", "Exa requires an API key");
    }
    let res: Response;
    try {
      res = await smartFetch(ENDPOINT, {
        method: "POST",
        headers: {
          "x-api-key": req.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ids: [req.url],
          text: true,
          livecrawl: "auto",
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
        `Exa returned ${res.status}: ${body.slice(0, 200)}`,
      );
    }
    const data = (await res.json()) as ExaResponse;
    const first = data.results?.[0];
    if (!first || typeof first.text !== "string" || first.text.length === 0) {
      throw new ResearchError(422, "empty_content", "Exa returned no content");
    }
    // Exa returns plain text — promote to Markdown by preserving paragraph
    // breaks (double-newline) and trimming trailing whitespace. Headings are
    // lost, but the body is intact for chunking + embedding.
    const markdown = first.text.replace(/\r\n/g, "\n").trim();
    return {
      markdown,
      url: first.url ?? req.url,
      title: first.title ?? req.url,
      author: first.author,
      byteSize: new Blob([markdown]).size,
      providerId: ID,
      meta: { extractor: "exa" },
    };
  }
}
