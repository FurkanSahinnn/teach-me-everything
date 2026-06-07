// Phase 5.5.G — Brave Search wrapped in the UnifiedSearchProvider interface.
//
// The existing `BraveSearchProvider` class (5.5.E) ships its own typed
// options + result shapes and is still consumed directly by adapter tests.
// This thin adapter normalises the call signature so the priority-chain
// dispatcher can iterate any UnifiedSearchProvider without knowing whether
// the underlying API is a pure search engine or a chat-LLM wrapper.

import { BraveSearchProvider } from "./brave";
import type {
  SearchInput,
  SearchProviderId,
  SearchResultItem,
  UnifiedSearchProvider,
} from "./types";

export class BraveUnifiedSearchProvider implements UnifiedSearchProvider {
  readonly id: SearchProviderId = "brave";
  readonly label = "Brave Search";
  readonly kind = "pure" as const;
  readonly costPerCallUsd = 0.005;
  readonly freeTierNote = "2,000 sorgu/ay ücretsiz";

  private readonly inner = new BraveSearchProvider();

  async search(input: SearchInput): Promise<SearchResultItem[]> {
    const searchOpts: {
      query: string;
      count?: number;
      signal?: AbortSignal;
    } = { query: input.query };
    if (input.count !== undefined) searchOpts.count = input.count;
    if (input.signal !== undefined) searchOpts.signal = input.signal;
    const list = await this.inner.search(searchOpts, input.apiKey);
    // BraveSearchResult is already SearchResultItem-shaped; pass through with
    // explicit optional-field handling for exactOptionalPropertyTypes.
    return list.map((r) => {
      const item: SearchResultItem = {
        url: r.url,
        title: r.title,
        description: r.description,
      };
      if (r.age !== undefined) item.age = r.age;
      if (r.faviconUrl !== undefined) item.faviconUrl = r.faviconUrl;
      return item;
    });
  }
}
