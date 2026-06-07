import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TavilySearchProvider } from "./tavily";

describe("TavilySearchProvider", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("POSTs to /search with api_key in body (Tavily quirk)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          query: "transformer architectures",
          results: [
            {
              url: "https://a.test/x",
              title: "A page",
              content: "Snippet about transformers.",
              published_date: "2026-03-15",
              score: 0.92,
            },
            { url: "https://b.test/y", title: "B page", content: "Another snippet." },
          ],
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const provider = new TavilySearchProvider();
    const out = await provider.search({
      query: "transformer architectures",
      count: 5,
      apiKey: "tvly-secret",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(call[0])).toBe("https://api.tavily.com/search");
    const headers = call[1].headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(call[1].body as string) as {
      api_key: string;
      query: string;
      max_results: number;
      search_depth: string;
    };
    // Tavily takes the API key in the JSON body, NOT as a header. This is a
    // quirk of their REST API — adapter test pins the expected request shape.
    expect(body.api_key).toBe("tvly-secret");
    expect(body.query).toBe("transformer architectures");
    expect(body.max_results).toBe(5);
    expect(body.search_depth).toBe("basic");

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      url: "https://a.test/x",
      title: "A page",
      description: "Snippet about transformers.",
      age: "2026-03-15",
    });
    expect(out[1]).toMatchObject({
      url: "https://b.test/y",
      title: "B page",
      description: "Another snippet.",
    });
    expect(out[1]?.age).toBeUndefined();
  });

  it("clamps max_results to [1, 20] and defaults to 10", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const provider = new TavilySearchProvider();
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;

    await provider.search({ query: "x", apiKey: "k" });
    expect(JSON.parse(calls[0]![1].body as string).max_results).toBe(10);

    await provider.search({ query: "x", count: 50, apiKey: "k" });
    expect(JSON.parse(calls[1]![1].body as string).max_results).toBe(20);

    await provider.search({ query: "x", count: -3, apiKey: "k" });
    expect(JSON.parse(calls[2]![1].body as string).max_results).toBe(1);
  });

  it("throws missing_key when apiKey is empty", async () => {
    const provider = new TavilySearchProvider();
    await expect(
      provider.search({ query: "x", apiKey: "" }),
    ).rejects.toMatchObject({ code: "missing_key", status: 401 });
  });

  it("throws empty_query when query is blank", async () => {
    const provider = new TavilySearchProvider();
    await expect(
      provider.search({ query: "   ", apiKey: "k" }),
    ).rejects.toMatchObject({ code: "empty_query", status: 400 });
  });

  it("surfaces non-2xx as upstream_error", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("quota exceeded", { status: 429 }),
    ) as unknown as typeof globalThis.fetch;
    const provider = new TavilySearchProvider();
    await expect(
      provider.search({ query: "x", apiKey: "k" }),
    ).rejects.toMatchObject({ code: "upstream_error", status: 429 });
  });

  it("skips results without a url defensively", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            { title: "no url", content: "skip" },
            { url: "https://kept.test/", title: "kept", content: "ok" },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof globalThis.fetch;
    const provider = new TavilySearchProvider();
    const out = await provider.search({ query: "x", apiKey: "k" });
    expect(out).toHaveLength(1);
    expect(out[0]?.url).toBe("https://kept.test/");
  });
});
