import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_EMBED_MODEL, OpenAIEmbedProvider } from "../embed-openai";
import { ProviderError } from "../types";

describe("OpenAIEmbedProvider.dimFor", () => {
  const provider = new OpenAIEmbedProvider();

  it("returns 1536 for text-embedding-3-small", () => {
    expect(provider.dimFor("text-embedding-3-small")).toBe(1536);
  });

  it("returns 3072 for text-embedding-3-large", () => {
    expect(provider.dimFor("text-embedding-3-large")).toBe(3072);
  });

  it("falls back to 1536 for unknown model", () => {
    expect(provider.dimFor("unknown-model")).toBe(1536);
  });

  it("exposes default model constant", () => {
    expect(DEFAULT_EMBED_MODEL).toBe("text-embedding-3-small");
  });
});

describe("OpenAIEmbedProvider.embed", () => {
  const provider = new OpenAIEmbedProvider();

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns empty result for empty inputs without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.embed({
      apiKey: "k",
      model: "text-embedding-3-small",
      inputs: [],
    });

    expect(result).toEqual({
      vectors: [],
      model: "text-embedding-3-small",
      dim: 1536,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws ProviderError(401, missing_key) when apiKey is empty", async () => {
    await expect(
      provider.embed({
        apiKey: "",
        model: "text-embedding-3-small",
        inputs: ["x"],
      }),
    ).rejects.toMatchObject({
      name: "ProviderError",
      status: 401,
      code: "missing_key",
    });
  });

  it("throws ProviderError instance (not generic Error) on missing key", async () => {
    let caught: unknown;
    try {
      await provider.embed({
        apiKey: "",
        model: "text-embedding-3-small",
        inputs: ["x"],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProviderError);
  });

  it("throws ProviderError(502, shape) when upstream returns wrong vector count", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      provider.embed({
        apiKey: "k",
        model: "text-embedding-3-small",
        inputs: ["one", "two"],
      }),
    ).rejects.toMatchObject({
      name: "ProviderError",
      status: 502,
      code: "shape",
    });
  });

  it("returns Float32Array vectors and propagates dim from model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.embed({
      apiKey: "k",
      model: "text-embedding-3-large",
      inputs: ["a", "b"],
    });

    expect(result.dim).toBe(3072);
    expect(result.model).toBe("text-embedding-3-large");
    expect(result.vectors).toHaveLength(2);
    expect(result.vectors[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(result.vectors[0] as Float32Array)).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
    ]);
  });
});
