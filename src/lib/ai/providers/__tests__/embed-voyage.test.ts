import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_VOYAGE_MODEL, VoyageEmbedProvider } from "../embed-voyage";
import { ProviderError } from "../types";

describe("VoyageEmbedProvider.dimFor", () => {
  const provider = new VoyageEmbedProvider();

  it("returns 1024 for voyage-3", () => {
    expect(provider.dimFor("voyage-3")).toBe(1024);
  });

  it("returns 2048 for voyage-3-large", () => {
    expect(provider.dimFor("voyage-3-large")).toBe(2048);
  });

  it("falls back to 1024 for unknown model", () => {
    expect(provider.dimFor("unknown-model")).toBe(1024);
  });

  it("exposes default model constant", () => {
    expect(DEFAULT_VOYAGE_MODEL).toBe("voyage-3");
  });
});

describe("VoyageEmbedProvider.embed", () => {
  const provider = new VoyageEmbedProvider();

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns empty result for empty inputs without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.embed({
      apiKey: "k",
      model: "voyage-3",
      inputs: [],
    });

    expect(result).toEqual({
      vectors: [],
      model: "voyage-3",
      dim: 1024,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws ProviderError(401, missing_key) when apiKey is empty", async () => {
    let caught: unknown;
    try {
      await provider.embed({
        apiKey: "",
        model: "voyage-3",
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

  it("posts body with provider=voyage, input_type=document, and input array", async () => {
    let capturedBody: unknown;
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ embedding: [0.5, 0.6] }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await provider.embed({
      apiKey: "k",
      model: "voyage-3",
      inputs: ["hello"],
    });

    expect(capturedBody).toMatchObject({
      provider: "voyage",
      model: "voyage-3",
      input_type: "document",
    });
    expect(Array.isArray((capturedBody as { input: unknown }).input)).toBe(true);
    expect((capturedBody as { input: string[] }).input).toEqual(["hello"]);
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
      model: "voyage-3",
      inputs: ["a", "b"],
    });

    expect(result.dim).toBe(1024);
    expect(result.model).toBe("voyage-3");
    expect(result.vectors).toHaveLength(2);
    expect(result.vectors[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(result.vectors[0] as Float32Array)).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
    ]);
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
        model: "voyage-3",
        inputs: ["one", "two"],
      }),
    ).rejects.toMatchObject({
      name: "ProviderError",
      status: 502,
      code: "shape",
    });
  });
});
