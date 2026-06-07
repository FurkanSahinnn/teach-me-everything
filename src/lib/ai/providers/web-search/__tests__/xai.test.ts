import { describe, expect, it } from "vitest";

import {
  buildXaiWebSearchTool,
  parseXaiWebSearchEvent,
  XAI_WEB_SEARCH_ADAPTER,
} from "@/lib/ai/providers/web-search/xai";

describe("buildXaiWebSearchTool", () => {
  it("emits a bare web_search tool when no options provided", () => {
    expect(buildXaiWebSearchTool({})).toEqual({ type: "web_search" });
  });

  it("includes allowed and excluded domain lists", () => {
    const tool = buildXaiWebSearchTool({
      allowedDomains: ["a.example", "b.example"],
      blockedDomains: ["bad.example"],
    });
    expect(tool.allowed_domains).toEqual(["a.example", "b.example"]);
    expect(tool.excluded_domains).toEqual(["bad.example"]);
  });

  it("clamps max_search_results to the 1..20 range", () => {
    expect(buildXaiWebSearchTool({ maxUses: 9 }).max_search_results).toBe(9);
    expect(buildXaiWebSearchTool({ maxUses: 999 }).max_search_results).toBe(20);
    expect(buildXaiWebSearchTool({ maxUses: 0 }).max_search_results).toBe(1);
  });

  it("skips max_search_results for non-finite input", () => {
    expect(buildXaiWebSearchTool({ maxUses: NaN }).max_search_results).toBeUndefined();
  });
});

describe("parseXaiWebSearchEvent", () => {
  it("extracts citations from a web_search_call done event", () => {
    const out = parseXaiWebSearchEvent({
      type: "response.output_item.done",
      output_index: 1,
      item: {
        type: "web_search_call",
        results: [
          {
            url: "https://x.example",
            title: "X",
            snippet: "s",
            published_date: "2026-04",
          },
        ],
      },
    });
    expect(out?.citations).toHaveLength(1);
    expect(out?.citations[0]?.result.provider).toBe("xai");
    expect(out?.citations[0]?.result.publishedAt).toBe("2026-04");
    expect(out?.citations[0]?.messageBlockIndex).toBe(1);
  });

  it("returns null for unrelated events", () => {
    expect(
      parseXaiWebSearchEvent({
        type: "response.output_item.done",
        item: { type: "message" },
      }),
    ).toBeNull();
    expect(parseXaiWebSearchEvent({ type: "response.created" })).toBeNull();
  });

  it("returns null for empty results", () => {
    expect(
      parseXaiWebSearchEvent({
        type: "response.output_item.done",
        item: { type: "web_search_call", results: [] },
      }),
    ).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(parseXaiWebSearchEvent(null)).toBeNull();
    expect(parseXaiWebSearchEvent(42)).toBeNull();
  });

  it("adapter wires xai providerId", () => {
    expect(XAI_WEB_SEARCH_ADAPTER.providerId).toBe("xai");
  });
});
