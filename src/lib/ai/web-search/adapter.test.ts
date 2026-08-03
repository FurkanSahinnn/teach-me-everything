import { describe, expect, it } from "vitest";

import {
  getWebSearchAdapter,
  listWebSearchAdapters,
  supportsWebSearch,
  type WebSearchProviderId,
} from "@/lib/ai/web-search/adapter";

describe("getWebSearchAdapter", () => {
  it("returns adapters for the 8 supported providers", () => {
    // 5.5.H: `openai` (Chat Completions) was replaced by `openai-responses`
    // because the built-in `web_search` tool is only valid on `/v1/responses`.
    const supported: WebSearchProviderId[] = [
      "anthropic",
      "openai-responses",
      "google-gemini",
      "perplexity",
      "xai",
      "mistral",
      "glm",
      "openrouter",
    ];
    for (const id of supported) {
      const adapter = getWebSearchAdapter(id);
      expect(adapter, `expected adapter for ${id}`).not.toBeNull();
      expect(adapter?.providerId).toBe(id);
    }
  });

  it("returns null for providers without a web-search adapter", () => {
    // `openai` (Chat Completions) is now unsupported — Responses provider
    // is the only route that accepts the `web_search` built-in tool.
    expect(getWebSearchAdapter("openai")).toBeNull();
    expect(getWebSearchAdapter("groq")).toBeNull();
    expect(getWebSearchAdapter("deepseek")).toBeNull();
    expect(getWebSearchAdapter("together")).toBeNull();
    expect(getWebSearchAdapter("cerebras")).toBeNull();
    expect(getWebSearchAdapter("ollama")).toBeNull();
  });

  it("returns null for custom: providers", () => {
    expect(getWebSearchAdapter("custom:my-endpoint")).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(getWebSearchAdapter(undefined as unknown as "anthropic")).toBeNull();
  });
});

describe("listWebSearchAdapters", () => {
  it("returns exactly 8 adapters with unique providerIds", () => {
    const adapters = listWebSearchAdapters();
    expect(adapters).toHaveLength(8);
    const ids = adapters.map((a) => a.providerId);
    const unique = new Set(ids);
    expect(unique.size).toBe(8);
  });

  it("every adapter declares a capability with paramsSupported", () => {
    for (const adapter of listWebSearchAdapters()) {
      expect(adapter.capability).toBeDefined();
      expect(Array.isArray(adapter.capability.paramsSupported)).toBe(true);
    }
  });
});

describe("supportsWebSearch", () => {
  it("returns true for known providers", () => {
    expect(supportsWebSearch("anthropic")).toBe(true);
    expect(supportsWebSearch("perplexity")).toBe(true);
  });

  it("returns false for unsupported providers", () => {
    expect(supportsWebSearch("groq")).toBe(false);
    expect(supportsWebSearch("custom:foo")).toBe(false);
  });
});
