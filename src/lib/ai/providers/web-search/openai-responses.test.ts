import { describe, expect, it } from "vitest";

import {
  buildOpenAIWebSearchTool,
  OPENAI_RESPONSES_WEB_SEARCH_ADAPTER,
  parseOpenAIResponsesWebSearchEvent,
} from "@/lib/ai/providers/web-search/openai-responses";

describe("buildOpenAIWebSearchTool", () => {
  it("defaults to medium context size", () => {
    expect(buildOpenAIWebSearchTool({})).toEqual({
      type: "web_search",
      search_context_size: "medium",
    });
  });

  it("maps searchMode='deep' to high", () => {
    expect(buildOpenAIWebSearchTool({ searchMode: "deep" })).toEqual({
      type: "web_search",
      search_context_size: "high",
    });
  });
});

describe("parseOpenAIResponsesWebSearchEvent", () => {
  it("extracts citations from a web_search_call done event", () => {
    const out = parseOpenAIResponsesWebSearchEvent({
      type: "response.output_item.done",
      output_index: 3,
      item: {
        type: "web_search_call",
        results: [
          { url: "https://a.example", title: "A", snippet: "hello" },
          { url: "https://b.example", title: "B", published_date: "2026-04" },
        ],
      },
    });
    expect(out?.citations).toHaveLength(2);
    expect(out?.citations[0]?.result.snippet).toBe("hello");
    expect(out?.citations[0]?.messageBlockIndex).toBe(3);
    expect(out?.citations[1]?.result.publishedAt).toBe("2026-04");
    expect(out?.citations[1]?.result.provider).toBe("openai");
    expect(out?.usage?.results).toBe(2);
  });

  it("extracts a url_citation annotation with span", () => {
    const out = parseOpenAIResponsesWebSearchEvent({
      type: "response.output_text.annotation.added",
      annotation: {
        type: "url_citation",
        url: "https://example.com",
        title: "Example",
        start_index: 10,
        end_index: 25,
      },
    });
    expect(out?.citations).toHaveLength(1);
    expect(out?.citations[0]?.charSpan).toEqual([10, 25]);
    expect(out?.citations[0]?.result.url).toBe("https://example.com");
  });

  it("annotation without span omits charSpan", () => {
    const out = parseOpenAIResponsesWebSearchEvent({
      type: "response.output_text.annotation.added",
      annotation: { type: "url_citation", url: "https://example.com" },
    });
    expect(out?.citations[0]?.charSpan).toBeUndefined();
  });

  it("returns null for unrelated events and malformed input", () => {
    expect(
      parseOpenAIResponsesWebSearchEvent({ type: "response.created" }),
    ).toBeNull();
    expect(parseOpenAIResponsesWebSearchEvent(null)).toBeNull();
    expect(parseOpenAIResponsesWebSearchEvent("event")).toBeNull();
    expect(
      parseOpenAIResponsesWebSearchEvent({
        type: "response.output_item.done",
        item: { type: "message" },
      }),
    ).toBeNull();
  });

  it("returns null when results is empty or missing urls", () => {
    expect(
      parseOpenAIResponsesWebSearchEvent({
        type: "response.output_item.done",
        item: { type: "web_search_call", results: [] },
      }),
    ).toBeNull();
    expect(
      parseOpenAIResponsesWebSearchEvent({
        type: "response.output_item.done",
        item: { type: "web_search_call", results: [{ title: "no url" }] },
      }),
    ).toBeNull();
  });

  it("adapter exposes openai-responses providerId and searchMode capability", () => {
    // 5.5.H: retargeted from `openai` to `openai-responses` — the
    // built-in `web_search` tool only works on `/v1/responses`, and the
    // dedicated chat provider class lives under that id.
    expect(OPENAI_RESPONSES_WEB_SEARCH_ADAPTER.providerId).toBe(
      "openai-responses",
    );
    expect(
      OPENAI_RESPONSES_WEB_SEARCH_ADAPTER.capability.paramsSupported,
    ).toContain("searchMode");
  });
});
