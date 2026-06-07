import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAICompatEmbedProvider } from "../embed-openai-compat";
import { ProviderError } from "../types";

describe("OpenAICompatEmbedProvider.dimFor", () => {
  const provider = new OpenAICompatEmbedProvider({ providerId: "mistral" });

  it("returns 1024 for mistral-embed", () => {
    expect(provider.dimFor("mistral-embed")).toBe(1024);
  });

  it("returns 768 for nomic-embed-text", () => {
    expect(provider.dimFor("nomic-embed-text")).toBe(768);
  });

  it("returns 1024 for mxbai-embed-large and bge-m3", () => {
    expect(provider.dimFor("mxbai-embed-large")).toBe(1024);
    expect(provider.dimFor("bge-m3")).toBe(1024);
  });

  it("falls back to 1024 for unknown model", () => {
    expect(provider.dimFor("unknown-embedding-model")).toBe(1024);
  });
});

describe("OpenAICompatEmbedProvider.embed (cloud / proxy mode)", () => {
  const provider = new OpenAICompatEmbedProvider({ providerId: "mistral" });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns empty result for empty inputs without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.embed({
      apiKey: "k",
      model: "mistral-embed",
      inputs: [],
    });

    expect(result).toEqual({ vectors: [], model: "mistral-embed", dim: 1024 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws ProviderError(401, missing_key) when apiKey is empty in cloud mode", async () => {
    await expect(
      provider.embed({ apiKey: "", model: "mistral-embed", inputs: ["x"] }),
    ).rejects.toMatchObject({
      name: "ProviderError",
      status: 401,
      code: "missing_key",
    });
  });

  it("posts to /api/ai/embed with provider discriminator and Bearer auth", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};
    const fetchMock = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = (init.headers ?? {}) as Record<string, string>;
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await provider.embed({
      apiKey: "secret",
      model: "mistral-embed",
      inputs: ["hello"],
    });

    expect(capturedUrl).toBe("/api/ai/embed");
    expect(capturedHeaders.authorization).toBe("Bearer secret");
    expect(capturedBody.provider).toBe("mistral");
    expect(capturedBody.model).toBe("mistral-embed");
    expect(capturedBody.input).toEqual(["hello"]);
  });

  it("returns Float32Array vectors with correct dim", async () => {
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
      model: "mistral-embed",
      inputs: ["a", "b"],
    });

    expect(result.dim).toBe(1024);
    expect(result.vectors).toHaveLength(2);
    expect(result.vectors[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(result.vectors[0] as Float32Array)).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
    ]);
  });

  it("throws ProviderError(502, shape) on count mismatch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [0.1] }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      provider.embed({
        apiKey: "k",
        model: "mistral-embed",
        inputs: ["one", "two"],
      }),
    ).rejects.toMatchObject({
      name: "ProviderError",
      status: 502,
      code: "shape",
    });
  });
});

describe("OpenAICompatEmbedProvider.embed (local / bypass mode)", () => {
  const provider = new OpenAICompatEmbedProvider({
    providerId: "ollama",
    baseUrl: "http://localhost:11434/v1",
    isLocal: true,
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts directly to baseUrl/embeddings (proxy bypass), strips provider, omits auth on empty key", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};
    const fetchMock = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = (init.headers ?? {}) as Record<string, string>;
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ embedding: [0.5, 0.6] }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.embed({
      apiKey: "",
      model: "nomic-embed-text",
      inputs: ["x"],
    });

    expect(capturedUrl).toBe("http://localhost:11434/v1/embeddings");
    expect(capturedHeaders.authorization).toBeUndefined();
    expect(capturedBody.provider).toBeUndefined();
    expect(capturedBody.model).toBe("nomic-embed-text");
    expect(capturedBody.input).toEqual(["x"]);
    expect(result.dim).toBe(768);
    expect(result.vectors).toHaveLength(1);
  });

  it("forwards Bearer auth in local mode when an apiKey is provided (e.g. password-protected Ollama proxy)", async () => {
    let capturedHeaders: Record<string, string> = {};
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedHeaders = (init.headers ?? {}) as Record<string, string>;
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ embedding: [0.1] }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await provider.embed({
      apiKey: "tok",
      model: "bge-m3",
      inputs: ["x"],
    });

    expect(capturedHeaders.authorization).toBe("Bearer tok");
  });

  it("refuses isLocal bypass when baseUrl is not actually loopback (defense in depth)", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    const fetchMock = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ embedding: [0.1] }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    // Caller asserts isLocal=true but the URL is public — adapter must override.
    const sneaky = new OpenAICompatEmbedProvider({
      providerId: "mistral",
      baseUrl: "https://api.evil.example.com/v1",
      isLocal: true,
    });

    await sneaky.embed({
      apiKey: "k",
      model: "mistral-embed",
      inputs: ["x"],
    });

    expect(capturedUrl).toBe("/api/ai/embed");
    expect(capturedBody.provider).toBe("mistral");
  });
});

describe("OpenAICompatEmbedProvider.id", () => {
  it("exposes providerId on the instance", () => {
    const p1 = new OpenAICompatEmbedProvider({ providerId: "mistral" });
    const p2 = new OpenAICompatEmbedProvider({
      providerId: "ollama",
      baseUrl: "http://localhost:11434/v1",
      isLocal: true,
    });
    expect(p1.id).toBe("mistral");
    expect(p2.id).toBe("ollama");
  });

  it("propagates ProviderError instance on missing key (not generic Error)", async () => {
    const provider = new OpenAICompatEmbedProvider({ providerId: "mistral" });
    let caught: unknown;
    try {
      await provider.embed({ apiKey: "", model: "mistral-embed", inputs: ["x"] });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProviderError);
  });
});
