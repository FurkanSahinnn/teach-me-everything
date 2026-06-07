// Jina Reader research provider (free tier + BYOK premium).
// API: GET https://r.jina.ai/{url} — returns ready-to-use Markdown.
// Optional Bearer header unlocks higher rate limits + premium features.
// Docs: https://jina.ai/reader/

import { smartFetch } from "@/lib/tauri/fetch";
import {
  ResearchError,
  type ResearchProvider,
  type ResearchProviderId,
  type ResearchRequest,
  type ResearchResult,
} from "./types";

const ID: ResearchProviderId = "jina-reader";
const ORIGIN = "https://r.jina.ai";

export class JinaReaderResearchProvider implements ResearchProvider {
  readonly id = ID;
  readonly capabilities = {
    jsRender: true,
    search: false,
    local: false,
    freeTier: true,
  } as const;

  async fetchContent(req: ResearchRequest): Promise<ResearchResult> {
    // r.jina.ai accepts the upstream URL as-is appended to the origin; it
    // tolerates both encoded and raw forms but URLs with a `?` query are
    // safer when not re-encoded.
    const endpoint = `${ORIGIN}/${req.url}`;
    const headers: Record<string, string> = {
      Accept: "text/markdown, text/plain",
      // Asking explicitly for Markdown short-circuits the content negotiation
      // even if the upstream sends back text/plain.
      "X-Return-Format": "markdown",
    };
    if (req.apiKey) headers.Authorization = `Bearer ${req.apiKey}`;

    let res: Response;
    try {
      res = await smartFetch(endpoint, {
        method: "GET",
        headers,
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
        `Jina Reader returned ${res.status}: ${body.slice(0, 200)}`,
      );
    }
    const markdown = (await res.text()).trim();
    if (markdown.length === 0) {
      throw new ResearchError(422, "empty_content", "Jina Reader returned empty content");
    }
    // Jina Reader prepends a `Title:` / `URL:` block before the body. Parse
    // it cheaply for nicer SourceRecord.title — fall back to the URL if
    // pattern doesn't match (format isn't guaranteed across versions).
    const titleMatch = /^Title:\s*(.+)$/m.exec(markdown);
    const title = titleMatch && titleMatch[1] ? titleMatch[1].trim() : req.url;
    return {
      markdown,
      url: req.url,
      title,
      byteSize: new Blob([markdown]).size,
      providerId: ID,
      meta: { extractor: "jina-reader" },
    };
  }
}
