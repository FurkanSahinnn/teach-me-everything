import { afterEach, describe, expect, it, vi } from "vitest";

import { GEMINI_MODEL_FETCH_ADAPTER } from "../gemini";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(response: { ok: boolean; status?: number; json?: unknown }): void {
  globalThis.fetch = vi.fn(async () => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 400),
    json: async () => response.json ?? {},
  })) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("GEMINI_MODEL_FETCH_ADAPTER", () => {
  it("returns empty when no api key is supplied (auth required)", async () => {
    const result = await GEMINI_MODEL_FETCH_ADAPTER.fetch({});
    expect(result.models).toEqual([]);
  });

  it("parses modern Gemini 2.5+/3.x models and drops legacy", async () => {
    mockFetch({
      ok: true,
      json: {
        models: [
          {
            name: "models/gemini-3-pro",
            displayName: "Gemini 3 Pro",
            supportedGenerationMethods: ["generateContent", "countTokens"],
          },
          {
            name: "models/gemini-2.5-flash",
            displayName: "Gemini 2.5 Flash",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/gemini-2.0-flash",
            displayName: "Gemini 2.0 Flash",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/gemini-1.5-pro",
            displayName: "Gemini 1.5 Pro",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      },
    });

    const result = await GEMINI_MODEL_FETCH_ADAPTER.fetch({ apiKey: "k" });
    const ids = result.models.map((m) => m.id);
    expect(ids).toContain("gemini-3-pro");
    expect(ids).toContain("gemini-2.5-flash");
    expect(ids).not.toContain("gemini-2.0-flash");
    expect(ids).not.toContain("gemini-1.5-pro");
  });

  it("drops embedding / aqa models even when generateContent is listed", async () => {
    mockFetch({
      ok: true,
      json: {
        models: [
          {
            name: "models/gemini-embedding-001",
            displayName: "Gemini Embedding 001",
            supportedGenerationMethods: ["generateContent", "embedContent"],
          },
          {
            name: "models/aqa",
            displayName: "AQA",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      },
    });

    const result = await GEMINI_MODEL_FETCH_ADAPTER.fetch({ apiKey: "k" });
    expect(result.models).toEqual([]);
  });

  it("filters models lacking generateContent support", async () => {
    mockFetch({
      ok: true,
      json: {
        models: [
          {
            name: "models/gemini-3-pro",
            displayName: "Gemini 3 Pro",
            supportedGenerationMethods: ["countTokens"],
          },
        ],
      },
    });

    const result = await GEMINI_MODEL_FETCH_ADAPTER.fetch({ apiKey: "k" });
    expect(result.models).toEqual([]);
  });

  it("returns empty list on non-2xx HTTP", async () => {
    mockFetch({ ok: false, status: 401 });
    const result = await GEMINI_MODEL_FETCH_ADAPTER.fetch({ apiKey: "bad" });
    expect(result.models).toEqual([]);
  });

  it("infers tier from id when no curated tier exists", async () => {
    mockFetch({
      ok: true,
      json: {
        models: [
          {
            name: "models/gemini-3-pro",
            displayName: "Gemini 3 Pro",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/gemini-3-flash-lite",
            displayName: "Gemini 3 Flash Lite",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      },
    });

    const result = await GEMINI_MODEL_FETCH_ADAPTER.fetch({ apiKey: "k" });
    const pro = result.models.find((m) => m.id === "gemini-3-pro");
    const lite = result.models.find((m) => m.id === "gemini-3-flash-lite");
    expect(pro?.tier).toBe("flagship");
    expect(lite?.tier).toBe("fast");
  });
});
