import { describe, expect, it } from "vitest";

import {
  buildClaudeWebSearchTool,
  CLAUDE_WEB_SEARCH_ADAPTER,
  CLAUDE_WEB_SEARCH_TOOL_NAME,
  CLAUDE_WEB_SEARCH_TOOL_TYPE,
  parseClaudeWebSearchEvent,
} from "@/lib/ai/providers/web-search/claude";

describe("buildClaudeWebSearchTool", () => {
  it("emits the documented tool envelope with defaults", () => {
    const tool = buildClaudeWebSearchTool({});
    expect(tool.type).toBe(CLAUDE_WEB_SEARCH_TOOL_TYPE);
    expect(tool.name).toBe(CLAUDE_WEB_SEARCH_TOOL_NAME);
    expect(tool.max_uses).toBe(5);
    expect(tool.allowed_domains).toBeUndefined();
    expect(tool.blocked_domains).toBeUndefined();
  });

  it("passes allowed_domains and blocked_domains through", () => {
    const tool = buildClaudeWebSearchTool({
      allowedDomains: ["arxiv.org", "doi.org"],
      blockedDomains: ["spammy.example"],
    });
    expect(tool.allowed_domains).toEqual(["arxiv.org", "doi.org"]);
    expect(tool.blocked_domains).toEqual(["spammy.example"]);
  });

  it("clamps maxUses below 1 to 1", () => {
    const tool = buildClaudeWebSearchTool({ maxUses: -3 });
    expect(tool.max_uses).toBe(1);
  });

  it("clamps maxUses above 10 to 10", () => {
    const tool = buildClaudeWebSearchTool({ maxUses: 999 });
    expect(tool.max_uses).toBe(10);
  });

  it("falls back to default maxUses for non-finite input", () => {
    const tool = buildClaudeWebSearchTool({ maxUses: NaN });
    expect(tool.max_uses).toBe(5);
  });

  it("drops empty domain entries and strips whitespace", () => {
    const tool = buildClaudeWebSearchTool({
      allowedDomains: ["  arxiv.org  ", "", "  "],
    });
    expect(tool.allowed_domains).toEqual(["arxiv.org"]);
  });
});

describe("parseClaudeWebSearchEvent", () => {
  it("extracts citations from a web_search_tool_result content block", () => {
    const event = {
      type: "content_block_start",
      index: 2,
      content_block: {
        type: "web_search_tool_result",
        content: [
          {
            type: "web_search_result",
            url: "https://example.com/a",
            title: "A",
            page_age: "2026-04-02",
          },
          {
            type: "web_search_result",
            url: "https://example.com/b",
            title: "B",
          },
        ],
      },
    };
    const out = parseClaudeWebSearchEvent(event);
    expect(out).not.toBeNull();
    expect(out?.citations).toHaveLength(2);
    expect(out?.citations[0]?.result.url).toBe("https://example.com/a");
    expect(out?.citations[0]?.result.title).toBe("A");
    expect(out?.citations[0]?.result.publishedAt).toBe("2026-04-02");
    expect(out?.citations[0]?.result.provider).toBe("anthropic");
    expect(out?.citations[0]?.messageBlockIndex).toBe(2);
    expect(out?.citations[1]?.result.publishedAt).toBeUndefined();
  });

  it("extracts usage from message_delta server_tool_use", () => {
    const out = parseClaudeWebSearchEvent({
      type: "message_delta",
      usage: { server_tool_use: { web_search_requests: 3 } },
    });
    expect(out?.citations).toEqual([]);
    expect(out?.usage?.calls).toBe(3);
  });

  it("returns null for unrelated events", () => {
    expect(parseClaudeWebSearchEvent({ type: "content_block_stop" })).toBeNull();
    expect(
      parseClaudeWebSearchEvent({ type: "message_start", message: {} }),
    ).toBeNull();
  });

  it("returns null for malformed inputs without throwing", () => {
    expect(parseClaudeWebSearchEvent(null)).toBeNull();
    expect(parseClaudeWebSearchEvent("nope")).toBeNull();
    expect(parseClaudeWebSearchEvent(42)).toBeNull();
    expect(
      parseClaudeWebSearchEvent({
        type: "content_block_start",
        content_block: { type: "web_search_tool_result", content: "boom" },
      }),
    ).toBeNull();
  });

  it("skips result items missing a URL", () => {
    const out = parseClaudeWebSearchEvent({
      type: "content_block_start",
      content_block: {
        type: "web_search_tool_result",
        content: [
          { type: "web_search_result", title: "no url" },
          { type: "web_search_result", url: "https://example.com/keep" },
        ],
      },
    });
    expect(out?.citations).toHaveLength(1);
    expect(out?.citations[0]?.result.url).toBe("https://example.com/keep");
  });
});

describe("CLAUDE_WEB_SEARCH_ADAPTER", () => {
  it("wires up the providerId and capability", () => {
    expect(CLAUDE_WEB_SEARCH_ADAPTER.providerId).toBe("anthropic");
    expect(CLAUDE_WEB_SEARCH_ADAPTER.capability.paramsSupported).toContain("maxUses");
    expect(CLAUDE_WEB_SEARCH_ADAPTER.capability.pricePerCall).toBe(0.01);
  });
});
