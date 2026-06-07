import { afterEach, describe, expect, it, vi } from "vitest";

import { createOpenAICompatAdapter } from "../openai-compat";

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

describe("createOpenAICompatAdapter", () => {
  it("applies toolFilter to drop unwanted ids", async () => {
    mockFetch({
      data: [
        { id: "grok-4", object: "model" },
        { id: "grok-3", object: "model" },
        { id: "grok-2-vision-1212", object: "model" },
      ],
    });

    const adapter = createOpenAICompatAdapter({
      providerId: "xai",
      baseUrl: "https://api.x.ai/v1",
      endpointLabel: "xai",
      requiresApiKey: true,
      toolFilter: (id) => !id.startsWith("grok-2"),
    });

    const result = await adapter.fetch({ apiKey: "k" });
    const ids = result.models.map((m) => m.id);
    expect(ids).toEqual(["grok-4", "grok-3"]);
  });

  it("honors override baseUrl from caller (custom endpoints)", async () => {
    let capturedUrl = "";
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const adapter = createOpenAICompatAdapter({
      providerId: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      endpointLabel: "groq",
      requiresApiKey: true,
    });

    await adapter.fetch({
      apiKey: "k",
      baseUrl: "https://custom.proxy.example/v1",
    });
    expect(capturedUrl).toBe("https://custom.proxy.example/v1/models");
  });

  it("falls back to humanized id when no display_name/name in row", async () => {
    mockFetch({
      data: [{ id: "llama-3.3-70b-versatile", object: "model" }],
    });

    const adapter = createOpenAICompatAdapter({
      providerId: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      endpointLabel: "groq",
      requiresApiKey: true,
    });

    const result = await adapter.fetch({ apiKey: "k" });
    expect(result.models[0]?.displayName).toMatch(/llama/i);
  });

  it("does NOT send Authorization header when bearerAuth=false", async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn(async (_: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const adapter = createOpenAICompatAdapter({
      providerId: "ollama",
      baseUrl: "http://localhost:11434/v1",
      endpointLabel: "ollama",
      requiresApiKey: false,
      bearerAuth: false,
    });

    await adapter.fetch({ apiKey: "ignored" });
    expect(capturedHeaders.Authorization).toBeUndefined();
  });
});
