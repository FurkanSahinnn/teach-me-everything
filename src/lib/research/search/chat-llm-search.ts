// Phase 5.5.G — Chat-LLM wrapper that turns a chat provider into a search
// backend by hijacking its native web-search tool.
//
// Flow:
//   1. Resolve `ChatProvider` + `WebSearchAdapter` for the configured providerId.
//   2. Build a tiny chat request with a research-oriented system prompt, the
//      user's query as the single message, and the adapter's `buildToolBlock`
//      spliced into `tools[]`. `maxUses: 1` keeps the cost predictable.
//   3. Stream the response. Collect citations from `kind:"raw"` events via
//      `adapter.parseStreamEvent`. Ignore text deltas, tool uses, etc.
//   4. Normalise the `WebCitation[]` into `SearchResultItem[]` — same shape
//      the pure search providers (Brave/Exa/Tavily) emit.
//
// One class, eight instances — every native-web-search-capable chat provider
// becomes a `*-search` priority-list entry without duplicating logic.

import { getChatProvider } from "@/lib/ai/providers/registry";
import type {
  ChatRequest,
  ProviderId,
  SystemBlock,
} from "@/lib/ai/providers/types";
import type { GetChatProviderOpts } from "@/lib/ai/providers/registry";
import type { AnthropicTool } from "@/lib/ai/tools";
import { getWebSearchAdapter } from "@/lib/ai/web-search/adapter";
import type { WebSearchAdapter } from "@/lib/ai/web-search/adapter";
import type { WebCitation } from "@/lib/ai/web-search/types";
import { usePrefs } from "@/stores/prefs";
import { BraveSearchError } from "./brave";
import type {
  SearchInput,
  SearchProviderId,
  SearchResultItem,
  UnifiedSearchProvider,
} from "./types";

export type ChatLlmSearchConfig = {
  searchId: SearchProviderId;
  chatProviderId: ProviderId;
  /** Default chat model — caller can override via prefs.modelBindings later. */
  modelId: string;
  label: string;
  /** Approximate USD cost per single-search call. */
  costPerCallUsd?: number;
  freeTierNote?: string;
};

// Dual-mode system prompt. We can't rely on the native `web_search` server
// tool being honoured by every credential path (notably Claude Code OAuth
// proxies the tool away in some configurations and returns plain text
// instead). So we tell the model to do whichever it can:
//   - If it has a web search tool available, invoke it once and let the
//     adapter pull citations out of the tool-result block.
//   - Otherwise, list the most relevant sources it knows, one per line,
//     and we'll regex-extract the URLs from the text stream.
// Either path produces the same final SearchResultItem[] shape because
// the wrapper merges tool-emitted citations and text-extracted URLs.
const SEARCH_SYSTEM_TEXT = `You are a research assistant. Given a topic, list the most relevant, recent, and authoritative web sources.

If a web search tool is available, invoke it once to ground your answer in current results. Otherwise, list the sources you know.

Output format: one source per line, in this exact shape:
- TITLE — URL

No preamble, no commentary, no closing remarks. Just the bulleted list.`;

// URL extraction regex — greedy but stops at whitespace, brackets, quotes,
// and common Markdown punctuation. Used as the text-mode fallback when the
// model emits sources as a bulleted text list instead of via the server
// tool. Matches http(s) only — we intentionally skip mailto:/ftp: etc.
const URL_REGEX = /https?:\/\/[^\s\)\]\}>"'<,]+/g;

export class ChatLlmSearchProvider implements UnifiedSearchProvider {
  readonly id: SearchProviderId;
  readonly label: string;
  readonly kind = "chat" as const;
  readonly costPerCallUsd?: number | undefined;
  readonly freeTierNote?: string | undefined;

  private readonly chatProviderId: ProviderId;
  private readonly modelId: string;
  private adapter: WebSearchAdapter | null = null;

  constructor(config: ChatLlmSearchConfig) {
    this.id = config.searchId;
    this.label = config.label;
    this.chatProviderId = config.chatProviderId;
    this.modelId = config.modelId;
    if (config.costPerCallUsd !== undefined) {
      this.costPerCallUsd = config.costPerCallUsd;
    }
    if (config.freeTierNote !== undefined) {
      this.freeTierNote = config.freeTierNote;
    }
  }

  /**
   * Resolve the model to use for THIS search call. Looks up the prefs entry
   * for this search provider and prefers `config.modelId` when set; falls
   * back to the catalog default otherwise. Trimmed empty strings count as
   * "unset" so a cleared input doesn't pin the model to "".
   */
  private resolveModelId(): string {
    try {
      const entry = usePrefs
        .getState()
        .searchProviders.find((p) => p.id === this.id);
      const override = entry?.config?.modelId;
      if (typeof override === "string" && override.trim().length > 0) {
        return override.trim();
      }
    } catch {
      // Prefs store not available (e.g. SSR / test without provider) — fall
      // through to the catalog default. Search is best-effort here.
    }
    return this.modelId;
  }

  /** Lazy adapter lookup so registry import order doesn't matter. */
  private getAdapter(): WebSearchAdapter {
    if (this.adapter) return this.adapter;
    const adapter = getWebSearchAdapter(this.chatProviderId);
    if (!adapter) {
      throw new BraveSearchError(
        500,
        "no_adapter",
        `No web-search adapter for provider ${this.chatProviderId}`,
      );
    }
    this.adapter = adapter;
    return adapter;
  }

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
        `${this.label} requires an API key`,
      );
    }

    const adapter = this.getAdapter();
    // For Anthropic, the OAuth path is served by a separate chat provider
    // class (`AnthropicOAuthChatProvider`) that POSTs to /api/ai/chat-oauth
    // with a Bearer token. Route through it when the dispatcher resolved
    // the credential via the OAuth slot.
    const chatOpts: GetChatProviderOpts = {};
    if (input.authKind === "oauth") chatOpts.authKind = "oauth";
    const provider = getChatProvider(this.chatProviderId, chatOpts);

    const toolBlock = adapter.buildToolBlock({
      // Cap to 1 search call so the cost surface is predictable. The model
      // may emit fewer if it decides the query doesn't need a search at all.
      maxUses: 1,
    });

    const system: SystemBlock[] = [
      { type: "text", text: SEARCH_SYSTEM_TEXT },
    ];

    const request: ChatRequest = {
      apiKey: input.apiKey,
      model: this.resolveModelId(),
      system,
      messages: [
        {
          role: "user",
          content: `Search the web for: ${query}\n\nReturn citations only.`,
        },
      ],
      // Cast at this seam: each provider's buildToolBlock returns a
      // provider-specific envelope (Anthropic's lacks `input_schema`, etc.).
      // The chat provider accepts both classic tools and server tools in the
      // same `tools` array, so the cast through `unknown` is acceptable here.
      tools: [toolBlock as unknown as AnthropicTool],
      // 1024 leaves room for the model to emit a bulleted text fallback
      // (10 sources × ~80 chars) when the server tool isn't actually
      // invoked — 256 was too tight, truncating the list mid-URL.
      maxTokens: 1024,
    };
    if (input.signal) request.signal = input.signal;
    // Anthropic's `streamChat` consumes `authKind` to decide which header
    // (x-api-key vs Authorization: Bearer) to attach. Non-Anthropic chat
    // providers ignore the field.
    if (input.authKind) request.authKind = input.authKind;

    const handle = provider.streamChat(request);
    const citations: WebCitation[] = [];
    // Buffer raw assistant text alongside tool citations. Some credential
    // paths (notably Claude Code OAuth) don't actually invoke the server
    // web_search tool — the model produces a plain-text bulleted list
    // instead. We mine that text for URLs at the end of the stream so the
    // wrapper succeeds in both modes.
    let textBuffer = "";
    let streamError: { status: number; message: string } | null = null;

    try {
      for await (const event of handle.events) {
        if (input.signal?.aborted) {
          handle.abort();
          throw new BraveSearchError(0, "aborted", "Search was aborted");
        }
        if (event.kind === "raw") {
          const parsed = adapter.parseStreamEvent(event.payload);
          if (parsed?.citations?.length) {
            citations.push(...parsed.citations);
          }
        } else if (event.kind === "text") {
          textBuffer += event.delta;
        } else if (event.kind === "error") {
          streamError = { status: event.status, message: event.message };
        }
      }
    } catch (err) {
      if (err instanceof BraveSearchError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new BraveSearchError(0, "fetch_failed", msg);
    }

    if (streamError) {
      throw new BraveSearchError(
        streamError.status,
        "upstream_error",
        `${this.label} stream error: ${streamError.message}`,
      );
    }

    // Text-mode fallback: mine the buffered assistant prose for raw URLs.
    // Runs unconditionally — citations from the tool path are deduped by
    // URL below, so any overlap is harmless. The line-scan heuristic uses
    // the chunk before the first URL as a candidate title, after
    // stripping bullet markers and dash separators.
    if (textBuffer.length > 0) {
      const alreadySeen = new Set<string>(
        citations.map((c) => c.result.url),
      );
      for (const line of textBuffer.split(/\r?\n/)) {
        const matches = line.match(URL_REGEX);
        if (!matches) continue;
        for (const raw of matches) {
          const url = raw.replace(/[.,;:!?]+$/, "");
          if (alreadySeen.has(url)) continue;
          alreadySeen.add(url);
          const before = line
            .slice(0, line.indexOf(raw))
            .trim()
            .replace(/^[-*•]\s*/, "")
            .replace(/[—\-:]\s*$/, "")
            .trim();
          const title = before.length > 0 ? before : url;
          citations.push({
            result: {
              url,
              title,
              snippet: "",
              provider: this.chatProviderId,
            },
            messageBlockIndex: 0,
          });
        }
      }
    }

    // Dedupe by URL and cap to requested count. Some adapters emit duplicate
    // citations across content blocks (e.g. when the model cites the same
    // page in multiple sentences).
    const seen = new Set<string>();
    const desired = input.count ?? 10;
    const items: SearchResultItem[] = [];
    for (const c of citations) {
      const url = c.result.url;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const item: SearchResultItem = {
        url,
        title: c.result.title || url,
        description: c.result.snippet ?? "",
      };
      if (c.result.publishedAt !== undefined) item.age = c.result.publishedAt;
      if (c.result.faviconUrl !== undefined) item.faviconUrl = c.result.faviconUrl;
      items.push(item);
      if (items.length >= desired) break;
    }
    return items;
  }
}

/**
 * Catalog of the 8 chat-LLM search instances. Each entry maps a SearchProviderId
 * to a (chat provider, default model, label, cost) tuple. The registry uses
 * this to lazily construct providers; tests use it to enumerate the catalog.
 */
export const CHAT_LLM_SEARCH_CATALOG: Record<string, ChatLlmSearchConfig> = {
  "anthropic-search": {
    searchId: "anthropic-search",
    chatProviderId: "anthropic",
    modelId: "claude-sonnet-4-6",
    label: "Claude (web search)",
    costPerCallUsd: 0.01,
  },
  "openai-search": {
    searchId: "openai-search",
    // 5.5.H: routed to the Responses-API provider — the `web_search`
    // built-in tool is only accepted on `/v1/responses`, Chat Completions
    // rejects it with HTTP 400.
    chatProviderId: "openai-responses",
    modelId: "gpt-5-mini",
    label: "OpenAI (web search)",
    costPerCallUsd: 0.03,
  },
  "gemini-search": {
    searchId: "gemini-search",
    chatProviderId: "google-gemini",
    modelId: "gemini-2.5-flash",
    label: "Gemini (google search)",
    costPerCallUsd: 0.035,
  },
  "perplexity-search": {
    searchId: "perplexity-search",
    chatProviderId: "perplexity",
    modelId: "sonar",
    label: "Perplexity Sonar",
    costPerCallUsd: 0.005,
  },
  "xai-search": {
    searchId: "xai-search",
    chatProviderId: "xai",
    modelId: "grok-4",
    label: "Grok (live search)",
    costPerCallUsd: 0.025,
  },
  "mistral-search": {
    searchId: "mistral-search",
    chatProviderId: "mistral",
    modelId: "mistral-large-latest",
    label: "Mistral (agents)",
    costPerCallUsd: 0.03,
  },
  "glm-search": {
    searchId: "glm-search",
    chatProviderId: "glm",
    modelId: "glm-4.6",
    label: "GLM (web search)",
    costPerCallUsd: 0.005,
  },
  "openrouter-search": {
    searchId: "openrouter-search",
    // Default fallback when the user hasn't picked one in Settings. The
    // Settings UI lets the user override this via prefs.searchProviders[].config.modelId.
    chatProviderId: "openrouter",
    modelId: "z-ai/glm-5",
    label: "OpenRouter `:online`",
    costPerCallUsd: 0.004,
  },
};
