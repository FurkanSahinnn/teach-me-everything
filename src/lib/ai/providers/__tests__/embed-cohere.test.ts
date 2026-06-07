import { afterEach, describe, expect, it, vi } from "vitest";

import { CohereEmbedProvider, DEFAULT_COHERE_MODEL } from "../embed-cohere";
import { ProviderError } from "../types";

describe("CohereEmbedProvider.dimFor", () => {
  const provider = new CohereEmbedProvider();

  it("returns 1024 for embed-multilingual-v3.0", () => {
    expect(provider.dimFor("embed-multilingual-v3.0")).toBe(1024);
  });

  it("falls back to 1024 for unknown model", () => {
    expect(provider.dimFor("unknown-model")).toBe(1024);
  });

  it("exposes default model constant", () => {
    expect(DEFAULT_COHERE_MODEL).toBe("embed-multilingual-v3.0");
  });
});

describe("CohereEmbedProvider.embed", () => {
  const provider = new CohereEmbedProvider();

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns empty result for empty inputs without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.embed({
      apiKey: "k",
      model: "embed-multilingual-v3.0",
      inputs: [],
    });

    expect(result).toEqual({
      vectors: [],
      model: "embed-multilingual-v3.0",
      dim: 1024,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws ProviderError(401, missing_key) when apiKey is empty", async () => {
    let caught: unknown;
    try {
      await provider.embed({
        apiKey: "",
        model: "embed-multilingual-v3.0",
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

  it("posts Cohere-shaped body (texts + input_type + embedding_types)", async () => {
    let capturedBody: unknown;
    const fetchMock = vi.fn().mockImplementation((_url, init) => {
      capturedBody = JSON.parse((init as { body: string }).body);
      return Promise.resolve(
        new Response(
          JSON.stringify({ embeddings: { float: [[0.1, 0.2]] } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await provider.embed({
      apiKey: "k",
      model: "embed-multilingual-v3.0",
      inputs: ["hello"],
    });

    const body = capturedBody as {
      provider: string;
      model: string;
      texts: string[];
      input_type: string;
      embedding_types: string[];
    };
    expect(body.provider).toBe("cohere");
    expect(body.model).toBe("embed-multilingual-v3.0");
    expect(Array.isArray(body.texts)).toBe(true);
    expect(body.texts).toEqual(["hello"]);
    expect(body.input_type).toBe("search_document");
    expect(body.embedding_types).toEqual(["float"]);
  });

  it("returns Float32Array vectors and propagates dim from model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          embeddings: { float: [[0.1, 0.2], [0.3, 0.4]] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.embed({
      apiKey: "k",
      model: "embed-multilingual-v3.0",
      inputs: ["a", "b"],
    });

    expect(result.dim).toBe(1024);
    expect(result.model).toBe("embed-multilingual-v3.0");
    expect(result.vectors).toHaveLength(2);
    expect(result.vectors[0]).toBeInstanceOf(Float32Array);
    expect(result.vectors[1]).toBeInstanceOf(Float32Array);
    expect(Array.from(result.vectors[0] as Float32Array)).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
    ]);
    expect(Array.from(result.vectors[1] as Float32Array)).toEqual([
      Math.fround(0.3),
      Math.fround(0.4),
    ]);
  });

  it("throws ProviderError(502, shape) when embeddings.float is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ embeddings: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      provider.embed({
        apiKey: "k",
        model: "embed-multilingual-v3.0",
        inputs: ["one", "two"],
      }),
    ).rejects.toMatchObject({
      name: "ProviderError",
      status: 502,
      code: "shape",
    });
  });

  it("throws ProviderError(502, shape) when upstream returns wrong vector count", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ embeddings: { float: [[0.1, 0.2, 0.3]] } }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      provider.embed({
        apiKey: "k",
        model: "embed-multilingual-v3.0",
        inputs: ["one", "two"],
      }),
    ).rejects.toMatchObject({
      name: "ProviderError",
      status: 502,
      code: "shape",
    });
  });
});
