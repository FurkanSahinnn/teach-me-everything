// Wire format for the cross-provider web-search layer (Phase 5.5).
//
// `WebSearchOptions` is the user-facing knob set surfaced by the reader and
// Settings → Models tab. Each provider adapter (5.5.B) reads only the subset
// it actually supports — `WebSearchCapability.paramsSupported` declares the
// subset so the UI can grey-out unsupported knobs per provider.
//
// `WebCitation` is the provider-neutral shape adapters emit during a streamed
// response. Persisted on `ChatMessageRecord.webCitations` so reload + share
// flows can re-render inline chips + the "Kaynaklar (N)" footer without
// replaying the original adapter parser.

export interface WebSearchOptions {
  maxUses?: number | undefined;
  allowedDomains?: string[] | undefined;
  blockedDomains?: string[] | undefined;
  searchMode?: "default" | "deep" | undefined;
  recencyDays?: number | undefined;
}

export interface WebSearchResult {
  url: string;
  title: string;
  snippet: string;
  faviconUrl?: string | undefined;
  publishedAt?: string | undefined;
  // Which LLM provider produced the citation — surfaced as a small label in
  // the peek modal so the user can tell native (Claude / OpenAI / Gemini)
  // results apart from OpenRouter `:online` plugin or third-party search.
  provider: string;
}

export interface WebCitation {
  result: WebSearchResult;
  // Index into the assistant message's content blocks the citation belongs
  // to. Reader maps this back onto the rendered text so inline chips land
  // at the correct paragraph; mismatched indices fall through to the
  // mesage-tail "Kaynaklar" list without throwing.
  messageBlockIndex: number;
  // Optional [start, end) UTF-16 offset inside the target block. When
  // present the chip is inlined at the span; when absent the chip appears
  // only in the message-tail list.
  charSpan?: [number, number] | undefined;
}

// Capability registry entry per chat option. Surfaced by `ChatOption` so the
// reader toggle can disable itself for non-supporting models and the cost
// chip can preview the call price up-front. `pricePerCall` / `pricePerResult`
// are USD; either or both may be undefined (e.g. local providers).
export interface WebSearchCapability {
  paramsSupported: (keyof WebSearchOptions)[];
  pricePerCall?: number | undefined;
  pricePerResult?: number | undefined;
}

// Helper for `computeWebSearchCostUsd`. Adapter usage events fill these in
// alongside the existing `Usage` token counts so cost roll-ups can sum
// search-induced spend separately from completion tokens.
export interface WebSearchUsage {
  calls?: number | undefined;
  results?: number | undefined;
}
