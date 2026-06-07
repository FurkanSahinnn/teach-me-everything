import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_GEMINI_EMBED_MODEL,
  GeminiEmbedProvider,
} from "../embed-gemini";
import { ProviderError } from "../types";

describe("GeminiEmbedProvider.dimFor", () => {
  const provider = new GeminiEmbedProvider();

  it("returns 768 for text-embedding-004", () => {
    expect(provider.dimFor("text-embedding-004")).toBe(768);
  });

  it("returns 3072 for gemini-embedding-001 and falls back to 768 for unknown", () => {
    expect(provider.dimFor("gemini-embedding-001")).toBe(3072);
    expect(provider.dimFor("unknown-model")).toBe(768);
  });

  it("exposes default model constant", () => {
    expect(DEFAULT_GEMINI_EMBED_MODEL).toBe("gemini-embedding-2");
  });
});

describe("GeminiEmbedProvider.embed", () => {
  const provider = new GeminiEmbedProvider();

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns empty result for empty inputs without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.embed({
      apiKey: "k",
      model: "text-embedding-004",
      inputs: [],
    });

    expect(result).toEqual({
      vectors: [],
      model: "text-embedding-004",
      dim: 768,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws ProviderError(401, missing_key) when apiKey is empty", async () => {
    let caught: unknown;
    try {
      await provider.embed({
        apiKey: "",
        model: "text-embedding-004",
        inputs: ["x"],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    expect(caught).toMatchObject({
      name: "ProviderError",
      status: 401,
      code: "missing_key",
    });
  });

  it("posts batchEmbedContents body shape with provider tag and per-request model path", async () => {
    let capturedBody: unknown;
    const fetchMock = vi.fn().mockImplementation((_url, init) => {
      capturedBody = JSON.parse(String((init as RequestInit).body));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await provider.embed({
      apiKey: "k",
      model: "text-embedding-004",
      inputs: ["alpha", "beta"],
    });

    const body = capturedBody as {
      provider: string;
      model: string;
      requests: Array<{ model: string; content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.provider).toBe("google-gemini");
    expect(body.model).toBe("text-embedding-004");
    expect(Array.isArray(body.requests)).toBe(true);
    expect(body.requests).toHaveLength(2);
    for (const r of body.requests) {
      expect(r.model.startsWith("models/")).toBe(true);
      expect(typeof r.content.parts[0]?.text).toBe("string");
    }
    expect(body.requests[0]?.content.parts[0]?.text).toBe("alpha");
    expect(body.requests[1]?.content.parts[0]?.text).toBe("beta");

    const init = (fetchMock.mock.calls[0]?.[1] ?? {}) as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer k");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("returns Float32Array vectors and propagates dim from model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.embed({
      apiKey: "k",
      model: "gemini-embedding-001",
      inputs: ["a", "b"],
    });

    expect(result.dim).toBe(3072);
    expect(result.model).toBe("gemini-embedding-001");
    expect(result.vectors).toHaveLength(2);
    expect(result.vectors[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(result.vectors[0] as Float32Array)).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
    ]);
    expect(Array.from(result.vectors[1] as Float32Array)).toEqual([
      Math.fround(0.3),
      Math.fround(0.4),
    ]);
  });

  it("throws ProviderError(502, shape) when upstream returns wrong embeddings count", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          embeddings: [{ values: [0.1, 0.2, 0.3] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      provider.embed({
        apiKey: "k",
        model: "text-embedding-004",
        inputs: ["one", "two"],
      }),
    ).rejects.toMatchObject({
      name: "ProviderError",
      status: 502,
      code: "shape",
    });
  });

  it("throws ProviderError(502, shape) when embeddings field is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      provider.embed({
        apiKey: "k",
        model: "text-embedding-004",
        inputs: ["one"],
      }),
    ).rejects.toMatchObject({
      name: "ProviderError",
      status: 502,
      code: "shape",
    });
  });
});
