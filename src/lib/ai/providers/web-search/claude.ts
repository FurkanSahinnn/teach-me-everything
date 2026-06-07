// Phase 5.5.B.1 — Claude native web_search adapter.
//
// Anthropic `web_search_20260209` server-tool: the model decides when to
// invoke search; the API runs the query and stitches the result into the
// stream as a `web_search_tool_result` content block. We don't get streaming
// citations; the whole result list arrives in one `content_block_start`.
// Usage roll-up rides on `message_delta.usage.server_tool_use.web_search_requests`.
//
// Cap rules from the Anthropic docs:
//   max_uses: 1..10 (we clamp; default 5)
//   allowed_domains / blocked_domains: optional string[]. Mutually exclusive
//   in practice — Anthropic returns a 400 if both are provided. We pass both
//   through so the upstream error message is the authoritative source rather
//   than us silently dropping one.

import type {
  WebSearchAdapter,
  WebSearchParseResult,
} from "@/lib/ai/web-search/adapter";
import type {
  WebCitation,
  WebSearchCapability,
  WebSearchOptions,
  WebSearchUsage,
} from "@/lib/ai/web-search/types";

export const CLAUDE_WEB_SEARCH_TOOL_TYPE = "web_search_20260209";
export const CLAUDE_WEB_SEARCH_TOOL_NAME = "web_search";

const MAX_USES_MIN = 1;
const MAX_USES_MAX = 10;
const MAX_USES_DEFAULT = 5;

function clampMaxUses(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return MAX_USES_DEFAULT;
  if (value < MAX_USES_MIN) return MAX_USES_MIN;
  if (value > MAX_USES_MAX) return MAX_USES_MAX;
  return Math.floor(value);
}

function cleanDomains(list: string[] | undefined): string[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const trimmed = list
    .map((d) => (typeof d === "string" ? d.trim() : ""))
    .filter((d) => d.length > 0);
  return trimmed.length > 0 ? trimmed : undefined;
}

export interface ClaudeWebSearchTool {
  type: typeof CLAUDE_WEB_SEARCH_TOOL_TYPE;
  name: typeof CLAUDE_WEB_SEARCH_TOOL_NAME;
  max_uses: number;
  allowed_domains?: string[];
  blocked_domains?: string[];
}

export function buildClaudeWebSearchTool(
  opts: WebSearchOptions,
): ClaudeWebSearchTool {
  const tool: ClaudeWebSearchTool = {
    type: CLAUDE_WEB_SEARCH_TOOL_TYPE,
    name: CLAUDE_WEB_SEARCH_TOOL_NAME,
    max_uses: clampMaxUses(opts.maxUses),
  };
  const allowed = cleanDomains(opts.allowedDomains);
  if (allowed) tool.allowed_domains = allowed;
  const blocked = cleanDomains(opts.blockedDomains);
  if (blocked) tool.blocked_domains = blocked;
  return tool;
}

interface ClaudeWebSearchResultItem {
  type?: string;
  url?: string;
  title?: string;
  page_age?: string | null;
  encrypted_content?: string;
}

interface ClaudeContentBlockBody {
  type?: string;
  content?: ClaudeWebSearchResultItem[] | { type?: string; error_code?: string };
}

interface ClaudeStreamEvent {
  type?: string;
  index?: number;
  content_block?: ClaudeContentBlockBody;
  usage?: {
    server_tool_use?: { web_search_requests?: number };
  };
}

export function parseClaudeWebSearchEvent(
  event: unknown,
): WebSearchParseResult | null {
  if (typeof event !== "object" || event === null) return null;
  const e = event as ClaudeStreamEvent;

  let usage: WebSearchUsage | undefined;
  if (e.type === "message_delta" && e.usage?.server_tool_use) {
    const calls = e.usage.server_tool_use.web_search_requests;
    if (typeof calls === "number" && Number.isFinite(calls) && calls >= 0) {
      usage = { calls };
    }
  }

  const citations: WebCitation[] = [];
  if (
    e.type === "content_block_start" &&
    e.content_block?.type === "web_search_tool_result"
  ) {
    const content = e.content_block.content;
    if (Array.isArray(content)) {
      for (const item of content) {
        if (!item || item.type !== "web_search_result") continue;
        if (typeof item.url !== "string" || !item.url) continue;
        const title = typeof item.title === "string" && item.title
          ? item.title
          : item.url;
        const published =
          typeof item.page_age === "string" && item.page_age.length > 0
            ? item.page_age
            : undefined;
        const citation: WebCitation = {
          result: {
            url: item.url,
            title,
            snippet: "",
            provider: "anthropic",
            ...(published ? { publishedAt: published } : {}),
          },
          messageBlockIndex: typeof e.index === "number" ? e.index : 0,
        };
        citations.push(citation);
      }
    }
  }

  if (citations.length === 0 && !usage) return null;
  return { citations, ...(usage ? { usage } : {}) };
}

export const CLAUDE_WEB_SEARCH_CAPABILITY: WebSearchCapability = {
  paramsSupported: ["maxUses", "allowedDomains", "blockedDomains"],
  pricePerCall: 0.01,
};

export const CLAUDE_WEB_SEARCH_ADAPTER: WebSearchAdapter = {
  providerId: "anthropic",
  capability: CLAUDE_WEB_SEARCH_CAPABILITY,
  buildToolBlock: buildClaudeWebSearchTool,
  parseStreamEvent: parseClaudeWebSearchEvent,
};
