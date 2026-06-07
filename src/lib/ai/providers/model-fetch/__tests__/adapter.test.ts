import { describe, expect, it } from "vitest";

import {
  getModelFetchAdapter,
  listModelFetchAdapters,
  supportsModelFetch,
} from "../adapter";

describe("model-fetch dispatcher", () => {
  it("returns an adapter for every cloud chat provider with a /models endpoint", () => {
    const ids = [
      "anthropic",
      "openai",
      "openai-responses",
      "google-gemini",
      "openrouter",
      "groq",
      "deepseek",
      "glm",
      "xai",
      "mistral",
      "together",
      "cerebras",
      "ollama",
      "lm-studio",
      "llama-cpp",
    ] as const;
    for (const id of ids) {
      expect(getModelFetchAdapter(id), `missing adapter for ${id}`).not.toBeNull();
    }
  });

  it("returns null for perplexity (no public /models endpoint)", () => {
    expect(getModelFetchAdapter("perplexity")).toBeNull();
  });

  it("returns null for custom: presets (synthesized at runtime)", () => {
    expect(getModelFetchAdapter("custom:my-endpoint" as never)).toBeNull();
  });

  it("listModelFetchAdapters enumerates every registered adapter", () => {
    const all = listModelFetchAdapters();
    expect(all.length).toBeGreaterThanOrEqual(15);
    const providerIds = new Set(all.map((a) => a.providerId));
    expect(providerIds.has("anthropic")).toBe(true);
    expect(providerIds.has("google-gemini")).toBe(true);
    expect(providerIds.has("openrouter")).toBe(true);
  });

  it("supportsModelFetch is true/false aligned with adapter presence", () => {
    expect(supportsModelFetch("anthropic")).toBe(true);
    expect(supportsModelFetch("google-gemini")).toBe(true);
    expect(supportsModelFetch("perplexity")).toBe(false);
    expect(supportsModelFetch("custom:foo" as never)).toBe(false);
  });

  it("rejects non-string presetIds without throwing", () => {
    expect(
      getModelFetchAdapter(undefined as unknown as "anthropic"),
    ).toBeNull();
    expect(
      getModelFetchAdapter(null as unknown as "anthropic"),
    ).toBeNull();
  });
});
