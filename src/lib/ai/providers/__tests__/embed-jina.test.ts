import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_JINA_DIM,
  DEFAULT_JINA_MODEL,
  JinaEmbedProvider,
} from "../embed-jina";
import { ProviderError } from "../types";

describe("JinaEmbedProvider.dimFor", () => {
  const provider = new JinaEmbedProvider();

  it("returns 1024 for jina-embeddings-v3", () => {
    expect(provider.dimFor("jina-embeddings-v3")).toBe(1024);
  });

  it("falls back to 1024 for unknown model", () => {
    expect(provider.dimFor("unknown-jina-model")).toBe(1024);
  });

  it("exposes default model + dim constants", () => {
    expect(DEFAULT_JINA_MODEL).toBe("jina-embeddings-v3");
    expect(DEFAULT_JINA_DIM).toBe(1024);
  });
});

describe("JinaEmbedProvider.embed", () => {
  const provider = new JinaEmbedProvider();

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns empty result for empty inputs without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.embed({
      apiKey: "k",
      model: "jina-embeddings-v3",
      inputs: [],
    });

    expect(result).toEqual({
      vectors: [],
      model: "jina-embeddings-v3",
      dim: 1024,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws ProviderError(401, missing_key) instance when apiKey is empty", async () => {
    let caught: unknown;
    try {
      await provider.embed({
        apiKey: "",
        model: "jina-embeddings-v3",
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

  it("posts a body with provider=jina, input array, and dimensions=1024", async () => {
    let capturedBody: unknown;
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string);
      return new Response(
        JSON.stringify({
          data: [{ embedding: [0.5, 0.6] }, { embedding: [0.7, 0.8] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await provider.embed({
      apiKey: "k",
      model: "jina-embeddings-v3",
      inputs: ["foo", "bar"],
    });

    expect(capturedBody).toMatchObject({
      provider: "jina",
      model: "jina-embeddings-v3",
      dimensions: 1024,
    });
    expect((capturedBody as { input: unknown }).input).toEqual(["foo", "bar"]);
  });

  it("returns Float32Array vectors with dim 1024", async () => {
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
      model: "jina-embeddings-v3",
      inputs: ["a", "b"],
    });

    expect(result.dim).toBe(1024);
    expect(result.model).toBe("jina-embeddings-v3");
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

  it("throws ProviderError(502, shape) when upstream returns wrong vector count", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      provider.embed({
        apiKey: "k",
        model: "jina-embeddings-v3",
        inputs: ["one", "two"],
      }),
    ).rejects.toMatchObject({
      name: "ProviderError",
      status: 502,
      code: "shape",
    });
  });

  it("throws ProviderError(502, shape) when upstream omits data array", async () => {
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
        model: "jina-embeddings-v3",
        inputs: ["one"],
      }),
    ).rejects.toMatchObject({
      name: "ProviderError",
      status: 502,
      code: "shape",
    });
  });
});
