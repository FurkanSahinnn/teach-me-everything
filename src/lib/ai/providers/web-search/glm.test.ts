import { describe, expect, it } from "vitest";

import {
  buildGlmWebSearchTool,
  GLM_WEB_SEARCH_ADAPTER,
  parseGlmWebSearchEvent,
} from "@/lib/ai/providers/web-search/glm";

describe("buildGlmWebSearchTool", () => {
  it("defaults to search_std engine", () => {
    const tool = buildGlmWebSearchTool({});
    expect(tool.web_search.search_engine).toBe("search_std");
    expect(tool.web_search.enable).toBe(true);
    expect(tool.web_search.search_result).toBe(true);
  });

  it("deep mode upgrades to search_pro engine", () => {
    const tool = buildGlmWebSearchTool({ searchMode: "deep" });
    expect(tool.web_search.search_engine).toBe("search_pro");
  });
});

describe("parseGlmWebSearchEvent", () => {
  it("extracts citations from the web_search array", () => {
    const out = parseGlmWebSearchEvent({
      web_search: [
        {
          link: "https://a.example",
          title: "A",
          content: "snip",
          publish_date: "2026-04",
        },
      ],
    });
    expect(out?.citations).toHaveLength(1);
    expect(out?.citations[0]?.result.url).toBe("https://a.example");
    expect(out?.citations[0]?.result.snippet).toBe("snip");
    expect(out?.citations[0]?.result.publishedAt).toBe("2026-04");
    expect(out?.citations[0]?.result.provider).toBe("glm");
  });

  it("skips entries missing link", () => {
    const out = parseGlmWebSearchEvent({
      web_search: [
        { title: "no link" },
        { link: "https://kept.example", title: "K" },
      ],
    });
    expect(out?.citations).toHaveLength(1);
  });

  it("returns null for empty / malformed input", () => {
    expect(parseGlmWebSearchEvent({})).toBeNull();
    expect(parseGlmWebSearchEvent({ web_search: [] })).toBeNull();
    expect(parseGlmWebSearchEvent(null)).toBeNull();
  });

  it("adapter wires glm providerId", () => {
    expect(GLM_WEB_SEARCH_ADAPTER.providerId).toBe("glm");
  });
});
