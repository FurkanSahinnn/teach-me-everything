import { describe, expect, it } from "vitest";

import {
  buildPerplexityRequestParams,
  parsePerplexityWebSearchEvent,
  PERPLEXITY_WEB_SEARCH_ADAPTER,
} from "@/lib/ai/providers/web-search/perplexity";

describe("buildPerplexityRequestParams", () => {
  it("defaults to medium mode + medium context_size", () => {
    const params = buildPerplexityRequestParams({});
    expect(params.search_mode).toBe("medium");
    expect(params.web_search_options).toEqual({ search_context_size: "medium" });
    expect(params.search_recency_filter).toBeUndefined();
    expect(params.search_domain_filter).toBeUndefined();
  });

  it("deep mode maps to high context_size", () => {
    const params = buildPerplexityRequestParams({ searchMode: "deep" });
    expect(params.search_mode).toBe("high");
    expect(params.web_search_options.search_context_size).toBe("high");
  });

  it("maps recencyDays to the right bucket", () => {
    expect(buildPerplexityRequestParams({ recencyDays: 1 }).search_recency_filter).toBe("hour");
    expect(buildPerplexityRequestParams({ recencyDays: 5 }).search_recency_filter).toBe("day");
    expect(buildPerplexityRequestParams({ recencyDays: 14 }).search_recency_filter).toBe("week");
    expect(buildPerplexityRequestParams({ recencyDays: 90 }).search_recency_filter).toBe("month");
  });

  it("skips recency for non-positive values", () => {
    expect(buildPerplexityRequestParams({ recencyDays: 0 }).search_recency_filter).toBeUndefined();
    expect(buildPerplexityRequestParams({ recencyDays: -1 }).search_recency_filter).toBeUndefined();
  });

  it("combines allow + blocked domains with `-` prefix", () => {
    const params = buildPerplexityRequestParams({
      allowedDomains: ["arxiv.org"],
      blockedDomains: ["spam.example", "ads.example"],
    });
    expect(params.search_domain_filter).toEqual([
      "arxiv.org",
      "-spam.example",
      "-ads.example",
    ]);
  });

  it("omits domain filter when both lists are empty", () => {
    expect(
      buildPerplexityRequestParams({ allowedDomains: [], blockedDomains: [] }).search_domain_filter,
    ).toBeUndefined();
  });
});

describe("parsePerplexityWebSearchEvent", () => {
  it("parses rich search_results into citations", () => {
    const out = parsePerplexityWebSearchEvent({
      search_results: [
        {
          url: "https://a.example",
          title: "A",
          snippet: "first",
          date: "2026-03-01",
        },
        { url: "https://b.example", title: "B" },
      ],
    });
    expect(out?.citations).toHaveLength(2);
    expect(out?.citations[0]?.result.snippet).toBe("first");
    expect(out?.citations[0]?.result.publishedAt).toBe("2026-03-01");
    expect(out?.citations[0]?.result.provider).toBe("perplexity");
  });

  it("merges plain citations with rich results without duplicating URLs", () => {
    const out = parsePerplexityWebSearchEvent({
      citations: ["https://a.example", "https://c.example"],
      search_results: [{ url: "https://a.example", title: "A rich" }],
    });
    expect(out?.citations.map((c) => c.result.url).sort()).toEqual([
      "https://a.example",
      "https://c.example",
    ]);
    const a = out?.citations.find((c) => c.result.url === "https://a.example");
    expect(a?.result.title).toBe("A rich");
  });

  it("falls back to plain URLs when no rich results", () => {
    const out = parsePerplexityWebSearchEvent({
      citations: ["https://only.example"],
    });
    expect(out?.citations).toHaveLength(1);
    expect(out?.citations[0]?.result.title).toBe("https://only.example");
  });

  it("returns null for empty / malformed input", () => {
    expect(parsePerplexityWebSearchEvent({})).toBeNull();
    expect(parsePerplexityWebSearchEvent(null)).toBeNull();
    expect(parsePerplexityWebSearchEvent({ citations: [] })).toBeNull();
  });

  it("adapter wires perplexity providerId + 4 supported params", () => {
    expect(PERPLEXITY_WEB_SEARCH_ADAPTER.providerId).toBe("perplexity");
    expect(PERPLEXITY_WEB_SEARCH_ADAPTER.capability.paramsSupported).toHaveLength(4);
  });
});
