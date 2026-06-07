// Default research provider — runs fully client-side.
// Pipeline: fetch(url) → DOMParser → Mozilla Readability → HTML → Markdown.
// No API key, no proxy hop for CORS-friendly origins (Wikipedia, MDN, most
// blogs). When the browser blocks the fetch with CORS, the caller can opt
// into the `/api/ai/research` proxy via `useProxy: true`.
//
// Imports are eager: this file is only pulled into a bundle when the
// registry constructs a ReadabilityResearchProvider, which happens client-
// side from AddUrlModal. The bundler tree-shakes turndown + @mozilla/
// readability out of routes that never reach this provider.

import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { isTauriEnvWithOverride } from "@/lib/tauri/env";
import { tauriFetch } from "@/lib/tauri/fetch";
import {
  ResearchError,
  type ResearchProvider,
  type ResearchProviderId,
  type ResearchRequest,
  type ResearchResult,
} from "./types";

const ID: ResearchProviderId = "readability";

export type ReadabilityFetchOpts = {
  /**
   * Route the upstream HTML fetch through the same-origin `/api/ai/research`
   * Edge proxy. Default is `true` because:
   *   1. CSP `connect-src` does not whitelist arbitrary origins — direct
   *      `fetch("https://news.site/article")` is blocked at the browser
   *      layer in production.
   *   2. The proxy hides the user's IP from the upstream and applies SSRF
   *      defenses (private/loopback host rejection, body cap).
   *   3. Cookies are stripped server-side so the user's logged-in sessions
   *      on the target host never leak into the extraction.
   * Set to `false` only in unit-test contexts that exercise the direct path.
   */
  useProxy?: boolean;
};

export class ReadabilityResearchProvider implements ResearchProvider {
  readonly id = ID;
  readonly capabilities = {
    jsRender: false,
    search: false,
    local: true,
    freeTier: true,
  } as const;

  constructor(private readonly opts: ReadabilityFetchOpts = {}) {}

  async fetchContent(req: ResearchRequest): Promise<ResearchResult> {
    // Tauri's plugin-http has no CORS, no CSP connect-src gate, and no
    // browser-cookie surface — so the proxy hop becomes redundant in
    // native mode. Web stays on the proxy by default for the same SSRF
    // + cookie-stripping guarantees the route always enforced.
    const isTauri = isTauriEnvWithOverride();
    const useProxy = !isTauri && this.opts.useProxy !== false;
    const fetchUrl = useProxy
      ? `/api/ai/research?url=${encodeURIComponent(req.url)}`
      : req.url;
    const doFetch = isTauri ? tauriFetch : fetch;

    let html: string;
    try {
      const res = await doFetch(fetchUrl, {
        method: "GET",
        // Avoid sending site-specific cookies on direct fetch — readability
        // mode is for public content. Proxy mode strips this server-side too.
        credentials: "omit",
        headers: { Accept: "text/html,application/xhtml+xml" },
        ...(req.signal ? { signal: req.signal } : {}),
      });
      if (!res.ok) {
        throw new ResearchError(
          res.status,
          "upstream_error",
          `Upstream returned ${res.status}`,
        );
      }
      html = await res.text();
    } catch (err) {
      if (err instanceof ResearchError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      // Surfacing CORS specifically lets the UI nudge the user toward proxy
      // mode instead of leaving the failure as a generic "fetch failed".
      const isCors = /CORS|cross[- ]origin|opaque/i.test(msg);
      throw new ResearchError(
        0,
        isCors ? "cors_blocked" : "fetch_failed",
        msg,
      );
    }

    const result = parseHtmlToMarkdown(html, req.url);
    const doc = new DOMParser().parseFromString(html, "text/html");
    // Readability mutates the document, so we already extracted a fallback
    // title from the raw parse above before handing it over.
    const article = new Readability(doc).parse();

    let markdown: string;
    let title: string = result.title;
    let author: string | undefined;
    if (article && typeof article.content === "string" && article.content.length > 0) {
      const td = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        bulletListMarker: "-",
      });
      markdown = td.turndown(article.content).trim();
      if (typeof article.title === "string" && article.title.length > 0) {
        title = article.title;
      }
      if (typeof article.byline === "string" && article.byline.length > 0) {
        author = article.byline;
      }
    } else {
      // Readability failed (probably a non-article page). Fall back to the
      // raw text extraction so we still have *something* to chunk + embed.
      markdown = result.fallbackText;
    }

    if (markdown.length === 0) {
      throw new ResearchError(
        422,
        "empty_content",
        "No readable content extracted from page",
      );
    }

    return {
      markdown,
      url: req.url,
      title,
      author,
      byteSize: new Blob([markdown]).size,
      providerId: ID,
      meta: { extractor: "readability", htmlByteSize: html.length },
    };
  }
}

/**
 * Pure helper exported for tests: extracts a fallback title + plain text from
 * raw HTML without invoking Readability or Turndown. Lets us assert on
 * pre-extraction behaviour (and document what we fall back to when Readability
 * can't find an article body).
 */
export function parseHtmlToMarkdown(
  html: string,
  url: string,
): { title: string; fallbackText: string } {
  let title = url;
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (titleMatch && typeof titleMatch[1] === "string") {
    const stripped = titleMatch[1].replace(/\s+/g, " ").trim();
    if (stripped.length > 0) title = stripped;
  }
  // Brutal but predictable: strip tags, collapse whitespace. Used only when
  // Readability fails to identify an article body.
  const fallbackText = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { title, fallbackText };
}
