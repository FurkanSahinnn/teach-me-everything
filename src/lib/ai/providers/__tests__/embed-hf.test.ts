import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_HF_MODEL, HuggingFaceEmbedProvider } from "../embed-hf";
import { ProviderError } from "../types";

describe("HuggingFaceEmbedProvider.dimFor", () => {
  const provider = new HuggingFaceEmbedProvider();

  it("returns 1024 for BAAI/bge-m3", () => {
    expect(provider.dimFor("BAAI/bge-m3")).toBe(1024);
  });

  it("returns 1024 for intfloat/multilingual-e5-large", () => {
    expect(provider.dimFor("intfloat/multilingual-e5-large")).toBe(1024);
  });

  it("falls back to 1024 for unknown model", () => {
    expect(provider.dimFor("unknown-model")).toBe(1024);
  });

  it("exposes default model constant", () => {
    expect(DEFAULT_HF_MODEL).toBe("BAAI/bge-m3");
  });
});

describe("HuggingFaceEmbedProvider.embed", () => {
  const provider = new HuggingFaceEmbedProvider();

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns empty result for empty inputs without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.embed({
      apiKey: "k",
      model: "BAAI/bge-m3",
      inputs: [],
    });

    expect(result).toEqual({
      vectors: [],
      model: "BAAI/bge-m3",
      dim: 1024,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws ProviderError(401, missing_key) when apiKey is empty", async () => {
    let caught: unknown;
    try {
      await provider.embed({
        apiKey: "",
        model: "BAAI/bge-m3",
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

  it("sends provider, inputs array, and wait_for_model option in body", async () => {
    let capturedBody: unknown;
    const fetchMock = vi.fn().mockImplementation((_url, init) => {
      capturedBody = JSON.parse((init as { body: string }).body);
      return Promise.resolve(
        new Response(JSON.stringify([[0.1, 0.2]]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await provider.embed({
      apiKey: "k",
      model: "BAAI/bge-m3",
      inputs: ["hello"],
    });

    const body = capturedBody as {
      provider: string;
      model: string;
      inputs: unknown;
      options: { wait_for_model: boolean };
    };
    expect(body.provider).toBe("huggingface");
    expect(body.model).toBe("BAAI/bge-m3");
    expect(Array.isArray(body.inputs)).toBe(true);
    expect(body.options.wait_for_model).toBe(true);
  });

  it("returns Float32Array vectors for multi-input response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          [0.1, 0.2],
          [0.3, 0.4],
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.embed({
      apiKey: "k",
      model: "BAAI/bge-m3",
      inputs: ["a", "b"],
    });

    expect(result.dim).toBe(1024);
    expect(result.model).toBe("BAAI/bge-m3");
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

  it("normalizes single-input flat number[] response into number[][]", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([0.1, 0.2]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.embed({
      apiKey: "k",
      model: "BAAI/bge-m3",
      inputs: ["x"],
    });

    expect(result.dim).toBe(1024);
    expect(result.vectors).toHaveLength(1);
    expect(result.vectors[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(result.vectors[0] as Float32Array)).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
    ]);
  });

  it("throws ProviderError(502, shape) when upstream returns wrong vector count", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([[0.1, 0.2, 0.3]]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      provider.embed({
        apiKey: "k",
        model: "BAAI/bge-m3",
        inputs: ["one", "two"],
      }),
    ).rejects.toMatchObject({
      name: "ProviderError",
      status: 502,
      code: "shape",
    });
  });
});
