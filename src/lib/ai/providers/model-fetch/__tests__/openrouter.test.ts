import { afterEach, describe, expect, it, vi } from "vitest";

import { OPENROUTER_MODEL_FETCH_ADAPTER } from "../openrouter";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(json: unknown, ok: boolean = true): void {
  globalThis.fetch = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 400,
    json: async () => json,
  })) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("OPENROUTER_MODEL_FETCH_ADAPTER", () => {
  it("does NOT require an api key — catalog is public", () => {
    expect(OPENROUTER_MODEL_FETCH_ADAPTER.requiresApiKey).toBe(false);
  });

  it("keeps models where supported_parameters includes 'tools'", async () => {
    mockFetch({
      data: [
        {
          id: "z-ai/glm-4.6",
          name: "GLM 4.6",
          supported_parameters: ["tools", "tool_choice"],
          pricing: { prompt: "0.0000005", completion: "0.0000015" },
        },
        {
          id: "meta-llama/llama-3-no-tools",
          name: "Llama 3 (no tools)",
          supported_parameters: ["response_format"],
          pricing: { prompt: "0", completion: "0" },
        },
        {
          id: "openai/gpt-5",
          name: "GPT 5",
          supported_parameters: ["tools"],
          pricing: { prompt: "0.00000125", completion: "0.00001" },
        },
      ],
    });

    const result = await OPENROUTER_MODEL_FETCH_ADAPTER.fetch({});
    const ids = result.models.map((m) => m.id);
    expect(ids).toContain("z-ai/glm-4.6");
    expect(ids).toContain("openai/gpt-5");
    expect(ids).not.toContain("meta-llama/llama-3-no-tools");
  });

  it("converts per-token pricing to per-1M and infers 'free' when both are 0", async () => {
    mockFetch({
      data: [
        {
          id: "x/free-model",
          name: "Free Model",
          supported_parameters: ["tools"],
          pricing: { prompt: "0", completion: "0" },
        },
        {
          id: "x/paid-model",
          name: "Paid Model",
          supported_parameters: ["tools"],
          pricing: { prompt: "0.000001", completion: "0.000005" },
        },
      ],
    });

    const result = await OPENROUTER_MODEL_FETCH_ADAPTER.fetch({});
    const free = result.models.find((m) => m.id === "x/free-model");
    expect(free?.tier).toBe("free");
  });

  it("returns empty list on non-2xx HTTP", async () => {
    mockFetch({}, false);
    const result = await OPENROUTER_MODEL_FETCH_ADAPTER.fetch({});
    expect(result.models).toEqual([]);
  });

  it("falls back to humanized id when name is missing", async () => {
    mockFetch({
      data: [
        {
          id: "z-ai/glm-4.6",
          supported_parameters: ["tools"],
          pricing: { prompt: "0", completion: "0" },
        },
      ],
    });

    const result = await OPENROUTER_MODEL_FETCH_ADAPTER.fetch({});
    expect(result.models[0]?.displayName).toMatch(/glm/i);
  });
});
