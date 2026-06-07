import { describe, expect, it } from "vitest";

import {
  buildGeminiGoogleSearchTool,
  GEMINI_WEB_SEARCH_ADAPTER,
  parseGeminiWebSearchEvent,
} from "@/lib/ai/providers/web-search/gemini";

describe("buildGeminiGoogleSearchTool", () => {
  it("emits the google_search server tool envelope", () => {
    expect(buildGeminiGoogleSearchTool({})).toEqual({ google_search: {} });
  });

  it("ignores unsupported options", () => {
    expect(
      buildGeminiGoogleSearchTool({
        maxUses: 9,
        allowedDomains: ["a.com"],
      }),
    ).toEqual({ google_search: {} });
  });
});

describe("parseGeminiWebSearchEvent", () => {
  it("converts groundingChunks into citations and folds spans from groundingSupports", () => {
    const out = parseGeminiWebSearchEvent({
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: "https://a.example", title: "A" } },
              { web: { uri: "https://b.example", title: "B" } },
            ],
            groundingSupports: [
              {
                segment: { startIndex: 0, endIndex: 12, text: "hello world" },
                groundingChunkIndices: [0],
              },
            ],
          },
        },
      ],
    });
    expect(out?.citations).toHaveLength(2);
    expect(out?.citations[0]?.charSpan).toEqual([0, 12]);
    expect(out?.citations[1]?.charSpan).toBeUndefined();
    expect(out?.citations[0]?.result.provider).toBe("google-gemini");
    expect(out?.usage?.results).toBe(2);
  });

  it("returns null when no groundingMetadata", () => {
    expect(parseGeminiWebSearchEvent({ candidates: [{ content: {} }] })).toBeNull();
  });

  it("returns null when groundingChunks is empty", () => {
    expect(
      parseGeminiWebSearchEvent({
        candidates: [{ groundingMetadata: { groundingChunks: [] } }],
      }),
    ).toBeNull();
  });

  it("skips chunks missing uri", () => {
    const out = parseGeminiWebSearchEvent({
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: [
              { web: { title: "no uri" } },
              { web: { uri: "https://kept.example" } },
            ],
          },
        },
      ],
    });
    expect(out?.citations).toHaveLength(1);
    expect(out?.citations[0]?.result.url).toBe("https://kept.example");
  });

  it("returns null for malformed inputs", () => {
    expect(parseGeminiWebSearchEvent(null)).toBeNull();
    expect(parseGeminiWebSearchEvent("nope")).toBeNull();
    expect(parseGeminiWebSearchEvent({})).toBeNull();
  });

  it("adapter wires google-gemini providerId", () => {
    expect(GEMINI_WEB_SEARCH_ADAPTER.providerId).toBe("google-gemini");
  });
});
