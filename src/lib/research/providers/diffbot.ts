// Diffbot Article API research provider (BYOK).
// API: GET https://api.diffbot.com/v3/article?token=<KEY>&url=<URL>
// Returns structured article data — title, html, text, author, date — for
// any URL. JS-heavy pages are handled server-side. We feed `html` through
// turndown for Markdown output to preserve headings, lists, and links; the
// plain `text` field is the fallback when html is unavailable.
// Docs: https://docs.diffbot.com/reference/extract-article

import TurndownService from "turndown";
import { smartFetch } from "@/lib/tauri/fetch";
import {
  ResearchError,
  type ResearchProvider,
  type ResearchProviderId,
  type ResearchRequest,
  type ResearchResult,
} from "./types";

const ID: ResearchProviderId = "diffbot";
const ENDPOINT = "https://api.diffbot.com/v3/article";

type DiffbotObject = {
  title?: string;
  text?: string;
  html?: string;
  author?: string;
  date?: string;
  pageUrl?: string;
  resolvedPageUrl?: string;
};

type DiffbotResponse = {
  objects?: DiffbotObject[];
  errorCode?: number;
  error?: string;
};

export class DiffbotResearchProvider implements ResearchProvider {
  readonly id = ID;
  readonly capabilities = {
    jsRender: true,
    search: false,
    local: false,
    freeTier: false,
  } as const;

  async fetchContent(req: ResearchRequest): Promise<ResearchResult> {
    if (!req.apiKey) {
      throw new ResearchError(401, "missing_key", "Diffbot requires an API key");
    }
    const params = new URLSearchParams({
      token: req.apiKey,
      url: req.url,
      // Strip discussion threads / comments — keeps token cost down + matches
      // the "main content" stance of firecrawl/readability.
      discussion: "false",
    });
    let res: Response;
    try {
      res = await smartFetch(`${ENDPOINT}?${params.toString()}`, {
        method: "GET",
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
        `Diffbot returned ${res.status}: ${body.slice(0, 200)}`,
      );
    }
    const data = (await res.json()) as DiffbotResponse;
    if (data.errorCode || data.error) {
      throw new ResearchError(
        data.errorCode ?? 502,
        "upstream_error",
        data.error ?? "Diffbot returned an error envelope",
      );
    }
    const obj = data.objects?.[0];
    if (!obj || (!obj.html && !obj.text)) {
      throw new ResearchError(
        422,
        "empty_content",
        "Diffbot returned no article content",
      );
    }
    const markdown = obj.html
      ? htmlToMarkdown(obj.html)
      : (obj.text ?? "").trim();
    if (markdown.length === 0) {
      throw new ResearchError(
        422,
        "empty_content",
        "Diffbot returned empty markdown after conversion",
      );
    }
    const result: ResearchResult = {
      markdown,
      url: obj.resolvedPageUrl ?? obj.pageUrl ?? req.url,
      title: obj.title ?? req.url,
      byteSize: new Blob([markdown]).size,
      providerId: ID,
      meta: { extractor: "diffbot" },
    };
    if (obj.author) result.author = obj.author;
    return result;
  }
}

function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  return turndown.turndown(html).trim();
}
