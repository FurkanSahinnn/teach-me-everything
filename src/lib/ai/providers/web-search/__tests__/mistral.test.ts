import { describe, expect, it } from "vitest";

import {
  buildMistralWebSearchConnector,
  MISTRAL_WEB_SEARCH_ADAPTER,
  parseMistralWebSearchEvent,
} from "@/lib/ai/providers/web-search/mistral";

describe("buildMistralWebSearchConnector", () => {
  it("returns the documented connector envelope", () => {
    expect(buildMistralWebSearchConnector({})).toEqual({ type: "web_search" });
  });
});

describe("parseMistralWebSearchEvent", () => {
  it("extracts citations from top-level references", () => {
    const out = parseMistralWebSearchEvent({
      references: [
        {
          url: "https://a.example",
          title: "A",
          description: "desc",
          date: "2026-04",
        },
      ],
    });
    expect(out?.citations).toHaveLength(1);
    expect(out?.citations[0]?.result.snippet).toBe("desc");
    expect(out?.citations[0]?.result.publishedAt).toBe("2026-04");
    expect(out?.citations[0]?.result.provider).toBe("mistral");
  });

  it("extracts citations from output.references", () => {
    const out = parseMistralWebSearchEvent({
      output: { references: [{ url: "https://b.example", title: "B" }] },
    });
    expect(out?.citations[0]?.result.url).toBe("https://b.example");
  });

  it("extracts citations from message.references", () => {
    const out = parseMistralWebSearchEvent({
      message: { references: [{ url: "https://c.example", title: "C" }] },
    });
    expect(out?.citations[0]?.result.url).toBe("https://c.example");
  });

  it("prefers snippet over description when both present", () => {
    const out = parseMistralWebSearchEvent({
      references: [
        {
          url: "https://x.example",
          title: "X",
          snippet: "snippet wins",
          description: "ignored",
        },
      ],
    });
    expect(out?.citations[0]?.result.snippet).toBe("snippet wins");
  });

  it("returns null for empty / malformed input", () => {
    expect(parseMistralWebSearchEvent({})).toBeNull();
    expect(parseMistralWebSearchEvent({ references: [] })).toBeNull();
    expect(parseMistralWebSearchEvent(null)).toBeNull();
  });

  it("adapter wires mistral providerId", () => {
    expect(MISTRAL_WEB_SEARCH_ADAPTER.providerId).toBe("mistral");
  });
});
