import { describe, expect, it } from "vitest";

import {
  buildOpenRouterWebPlugin,
  OPENROUTER_WEB_SEARCH_ADAPTER,
  parseOpenRouterWebSearchEvent,
  withOnlineSuffix,
} from "@/lib/ai/providers/web-search/openrouter";

describe("buildOpenRouterWebPlugin", () => {
  it("emits a bare plugin id when no options", () => {
    expect(buildOpenRouterWebPlugin({})).toEqual({ id: "web" });
  });

  it("clamps max_results to the 1..10 range", () => {
    expect(buildOpenRouterWebPlugin({ maxUses: 5 }).max_results).toBe(5);
    expect(buildOpenRouterWebPlugin({ maxUses: 99 }).max_results).toBe(10);
    expect(buildOpenRouterWebPlugin({ maxUses: -1 }).max_results).toBe(1);
  });

  it("skips max_results for non-finite input", () => {
    expect(buildOpenRouterWebPlugin({ maxUses: NaN }).max_results).toBeUndefined();
  });
});

describe("withOnlineSuffix", () => {
  it("appends :online to a plain slug", () => {
    expect(withOnlineSuffix("openai/gpt-4o")).toBe("openai/gpt-4o:online");
  });

  it("is idempotent on already-suffixed slugs", () => {
    expect(withOnlineSuffix("anthropic/claude-sonnet-4.5:online")).toBe(
      "anthropic/claude-sonnet-4.5:online",
    );
  });

  it("returns empty input as-is", () => {
    expect(withOnlineSuffix("")).toBe("");
  });
});

describe("parseOpenRouterWebSearchEvent", () => {
  it("extracts citations from message.annotations", () => {
    const out = parseOpenRouterWebSearchEvent({
      choices: [
        {
          message: {
            annotations: [
              {
                type: "url_citation",
                url_citation: {
                  url: "https://a.example",
                  title: "A",
                  content: "snip",
                },
              },
            ],
          },
        },
      ],
    });
    expect(out?.citations).toHaveLength(1);
    expect(out?.citations[0]?.result.url).toBe("https://a.example");
    expect(out?.citations[0]?.result.snippet).toBe("snip");
    expect(out?.citations[0]?.result.provider).toBe("openrouter");
  });

  it("extracts citations from delta.annotations with span", () => {
    const out = parseOpenRouterWebSearchEvent({
      choices: [
        {
          delta: {
            annotations: [
              {
                type: "url_citation",
                url_citation: {
                  url: "https://b.example",
                  title: "B",
                  start_index: 4,
                  end_index: 19,
                },
              },
            ],
          },
        },
      ],
    });
    expect(out?.citations[0]?.charSpan).toEqual([4, 19]);
  });

  it("returns null for irrelevant choice payloads", () => {
    expect(parseOpenRouterWebSearchEvent({ choices: [] })).toBeNull();
    expect(
      parseOpenRouterWebSearchEvent({
        choices: [{ message: { content: "no annotations here" } }],
      }),
    ).toBeNull();
    expect(parseOpenRouterWebSearchEvent({})).toBeNull();
  });

  it("skips non-url_citation annotations", () => {
    expect(
      parseOpenRouterWebSearchEvent({
        choices: [
          {
            message: {
              annotations: [{ type: "image_url", url_citation: { url: "x" } }],
            },
          },
        ],
      }),
    ).toBeNull();
  });

  it("adapter wires openrouter providerId + maxUses param", () => {
    expect(OPENROUTER_WEB_SEARCH_ADAPTER.providerId).toBe("openrouter");
    expect(
      OPENROUTER_WEB_SEARCH_ADAPTER.capability.paramsSupported,
    ).toContain("maxUses");
  });
});
