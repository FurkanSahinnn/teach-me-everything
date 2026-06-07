import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../route";

function makeRequest(body: unknown, opts: { auth?: string } = {}): Request {
  return new Request("https://localhost/api/ai/embed", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.auth !== undefined ? { authorization: opts.auth } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/ai/embed family branching", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("routes google-gemini family with x-goog-api-key header and batchEmbedContents URL", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: unknown;
    const fetchMock = vi.fn().mockImplementation((url, init) => {
      capturedUrl = String(url);
      const h = new Headers((init as RequestInit).headers);
      capturedHeaders = Object.fromEntries(h.entries());
      capturedBody = JSON.parse(String((init as RequestInit).body));
      return Promise.resolve(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = makeRequest(
      {
        provider: "google-gemini",
        model: "text-embedding-004",
        requests: [
          {
            model: "models/text-embedding-004",
            content: { parts: [{ text: "hello" }] },
          },
        ],
      },
      { auth: "Bearer SECRET_KEY" },
    );

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(capturedUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents",
    );
    expect(capturedHeaders["x-goog-api-key"]).toBe("SECRET_KEY");
    // Bearer must NOT appear on Gemini — Gemini uses x-goog-api-key only.
    expect(capturedHeaders["authorization"]).toBeUndefined();
    // model is stripped (URL already encodes it); provider is stripped.
    expect(capturedBody).toEqual({
      requests: [
        {
          model: "models/text-embedding-004",
          content: { parts: [{ text: "hello" }] },
        },
      ],
    });
  });

  it("routes cohere family with bearer auth and forwards body verbatim minus provider", async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: unknown;
    const fetchMock = vi.fn().mockImplementation((_url, init) => {
      const h = new Headers((init as RequestInit).headers);
      capturedHeaders = Object.fromEntries(h.entries());
      capturedBody = JSON.parse(String((init as RequestInit).body));
      return Promise.resolve(
        new Response(JSON.stringify({ embeddings: { float: [[0.1]] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = makeRequest(
      {
        provider: "cohere",
        model: "embed-multilingual-v3.0",
        texts: ["hello"],
        input_type: "search_document",
        embedding_types: ["float"],
      },
      { auth: "Bearer SECRET_KEY" },
    );

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(capturedHeaders["authorization"]).toBe("Bearer SECRET_KEY");
    expect(capturedBody).toEqual({
      model: "embed-multilingual-v3.0",
      texts: ["hello"],
      input_type: "search_document",
      embedding_types: ["float"],
    });
  });

  it("rejects local provider id (ollama) with proxy_local_forbidden", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const req = makeRequest(
      { provider: "ollama", model: "nomic-embed-text", input: ["hi"] },
      { auth: "Bearer ANY" },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("proxy_local_forbidden");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects lm-studio + llama-cpp with proxy_local_forbidden", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const provider of ["lm-studio", "llama-cpp"]) {
      const req = makeRequest({ provider, model: "x", input: ["y"] }, { auth: "Bearer K" });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = (await res.json()) as { code: string };
      expect(json.code).toBe("proxy_local_forbidden");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 401/missing_key when Authorization header is absent (parametrized for google-gemini)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const req = makeRequest({
      provider: "google-gemini",
      model: "text-embedding-004",
      requests: [
        {
          model: "models/text-embedding-004",
          content: { parts: [{ text: "x" }] },
        },
      ],
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("missing_key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects custom: prefix providers (proxy is preset-only)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const req = makeRequest(
      { provider: "custom:my-endpoint", model: "x", input: ["y"] },
      { auth: "Bearer K" },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("custom_endpoint_forbidden");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects google-gemini without body.model (URL construction requires it)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const req = makeRequest(
      {
        provider: "google-gemini",
        requests: [{ content: { parts: [{ text: "x" }] } }],
      },
      { auth: "Bearer K" },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("invalid_shape");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("constructs huggingface URL from body.model (router pipeline feature-extraction) and strips model from body", async () => {
    let capturedUrl = "";
    let capturedBody: unknown;
    const fetchMock = vi.fn().mockImplementation((url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String((init as RequestInit).body));
      return Promise.resolve(
        new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = makeRequest(
      {
        provider: "huggingface",
        model: "BAAI/bge-m3",
        inputs: ["x"],
        options: { wait_for_model: true },
      },
      { auth: "Bearer K" },
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(capturedUrl).toBe(
      "https://router.huggingface.co/hf-inference/models/BAAI/bge-m3/pipeline/feature-extraction",
    );
    expect(capturedBody).toEqual({
      inputs: ["x"],
      options: { wait_for_model: true },
    });
  });

  it("routes mistral family through OpenAI-shape upstream URL with bearer auth", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: unknown;
    const fetchMock = vi.fn().mockImplementation((url, init) => {
      capturedUrl = String(url);
      const h = new Headers((init as RequestInit).headers);
      capturedHeaders = Object.fromEntries(h.entries());
      capturedBody = JSON.parse(String((init as RequestInit).body));
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ embedding: [0.1] }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = makeRequest(
      { provider: "mistral", model: "mistral-embed", input: ["hi"] },
      { auth: "Bearer K" },
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(capturedUrl).toBe("https://api.mistral.ai/v1/embeddings");
    expect(capturedHeaders["authorization"]).toBe("Bearer K");
    expect(capturedBody).toEqual({ model: "mistral-embed", input: ["hi"] });
  });
});
