// Bright Data Web Unlocker research provider (BYOK).
// API: POST https://api.brightdata.com/request
// Body: { zone: "<zone>", url: "<target>", format: "raw" }
// Auth: `Authorization: Bearer <api_token>` (zone-scoped token)
// Returns: raw HTML body of the resolved page. Bright Data handles JS
// rendering, residential proxying, and anti-bot bypass server-side; we
// convert the returned HTML to Markdown via turndown for chunker parity
// with diffbot / readability.
//
// Zone scoping note: Bright Data's tokens are zone-scoped, so the user
// configures a zone in their dashboard ("web_unlocker1", "unblocker", etc.)
// and the same name must be passed here. We default to "web_unlocker" — the
// standard zone slug Bright Data documents in their Web Unlocker quickstart.
// Future: surface the zone name in Settings so users with custom zones can
// override without editing source. Tracked for Phase 5.5.D+ polish.
// Docs: https://docs.brightdata.com/api-reference/unlocker

import TurndownService from "turndown";
import { smartFetch } from "@/lib/tauri/fetch";
import {
  ResearchError,
  type ResearchProvider,
  type ResearchProviderId,
  type ResearchRequest,
  type ResearchResult,
} from "./types";

const ID: ResearchProviderId = "brightdata";
const ENDPOINT = "https://api.brightdata.com/request";
const DEFAULT_ZONE = "web_unlocker";

export class BrightDataResearchProvider implements ResearchProvider {
  readonly id = ID;
  readonly capabilities = {
    jsRender: true,
    search: false,
    local: false,
    freeTier: false,
  } as const;

  async fetchContent(req: ResearchRequest): Promise<ResearchResult> {
    if (!req.apiKey) {
      throw new ResearchError(
        401,
        "missing_key",
        "Bright Data requires an API key",
      );
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
          zone: DEFAULT_ZONE,
          url: req.url,
          format: "raw",
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
        `Bright Data returned ${res.status}: ${body.slice(0, 200)}`,
      );
    }
    const html = await res.text();
    if (!html || html.trim().length === 0) {
      throw new ResearchError(
        422,
        "empty_content",
        "Bright Data returned an empty response body",
      );
    }
    const markdown = htmlToMarkdown(html);
    if (markdown.length === 0) {
      throw new ResearchError(
        422,
        "empty_content",
        "Bright Data response produced empty markdown after conversion",
      );
    }
    const title = extractTitle(html) ?? req.url;
    return {
      markdown,
      url: req.url,
      title,
      byteSize: new Blob([markdown]).size,
      providerId: ID,
      meta: { extractor: "brightdata", zone: DEFAULT_ZONE },
    };
  }
}

function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  // Strip <script>/<style>/<noscript> blocks before conversion so noise from
  // those tags doesn't leak into the markdown body.
  turndown.remove(["script", "style", "noscript"]);
  return turndown.turndown(html).trim();
}

// Best-effort title extraction from raw HTML. We can't DOMParse server-side
// here (this code runs in the browser worker), but a regex over <title> is
// safe because the only consumer is the SourceRecord title — chunking
// happens against markdown body, not the title field.
function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  if (!match || !match[1]) return null;
  const trimmed = match[1].trim();
  return trimmed.length > 0 ? trimmed : null;
}
