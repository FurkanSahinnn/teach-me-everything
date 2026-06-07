import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BraveSearchProvider } from "./brave";

describe("BraveSearchProvider", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("calls the web/search endpoint with q + count + auth header", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          web: {
            results: [
              {
                url: "https://a.test/x",
                title: "A page",
                description: "First snippet.",
                age: "2 days ago",
                meta_url: { favicon: "https://a.test/fav.ico" },
              },
              {
                url: "https://b.test/y",
                title: "B page",
                description: "Second snippet.",
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const provider = new BraveSearchProvider();
    const results = await provider.search(
      { query: "quantum computing basics", count: 5 },
      "brave-secret",
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const requestedUrl = String(call[0]);
    expect(requestedUrl).toContain(
      "https://api.search.brave.com/res/v1/web/search",
    );
    // URLSearchParams.toString() encodes spaces as `+` (form-urlencoded),
    // not `%20` — match against that exact representation.
    expect(requestedUrl).toContain("q=quantum+computing+basics");
    expect(requestedUrl).toContain("count=5");
    const headers = call[1].headers as Record<string, string>;
    expect(headers["X-Subscription-Token"]).toBe("brave-secret");
    expect(headers.Accept).toBe("application/json");

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      url: "https://a.test/x",
      title: "A page",
      description: "First snippet.",
      age: "2 days ago",
      faviconUrl: "https://a.test/fav.ico",
    });
    expect(results[1]).toMatchObject({
      url: "https://b.test/y",
      title: "B page",
      description: "Second snippet.",
    });
    expect(results[1]?.age).toBeUndefined();
    expect(results[1]?.faviconUrl).toBeUndefined();
  });

  it("clamps count to [1, 20] and defaults to 10 when omitted", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ web: { results: [] } }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const provider = new BraveSearchProvider();

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    await provider.search({ query: "x" }, "k");
    expect(String(calls[0]?.[0])).toContain("count=10");

    await provider.search({ query: "x", count: 999 }, "k");
    expect(String(calls[1]?.[0])).toContain("count=20");

    await provider.search({ query: "x", count: 0 }, "k");
    expect(String(calls[2]?.[0])).toContain("count=1");
  });

  it("passes freshness + safesearch when provided", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ web: { results: [] } }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const provider = new BraveSearchProvider();
    await provider.search(
      { query: "news", freshness: "pd", safesearch: "strict" },
      "k",
    );
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const url = String(calls[0]?.[0]);
    expect(url).toContain("freshness=pd");
    expect(url).toContain("safesearch=strict");
  });

  it("throws missing_key when no apiKey is supplied", async () => {
    const provider = new BraveSearchProvider();
    await expect(
      provider.search({ query: "x" }, ""),
    ).rejects.toMatchObject({ code: "missing_key", status: 401 });
  });

  it("throws empty_query when the query is blank after trim", async () => {
    const provider = new BraveSearchProvider();
    await expect(
      provider.search({ query: "   " }, "k"),
    ).rejects.toMatchObject({ code: "empty_query", status: 400 });
  });

  it("surfaces non-2xx responses as upstream_error", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("rate limited", { status: 429 }),
    ) as unknown as typeof globalThis.fetch;
    const provider = new BraveSearchProvider();
    await expect(
      provider.search({ query: "x" }, "k"),
    ).rejects.toMatchObject({ code: "upstream_error", status: 429 });
  });

  it("skips results with no url field defensively", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          web: {
            results: [
              { title: "no url here", description: "skip me" },
              { url: "https://kept.test", title: "kept", description: "ok" },
            ],
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof globalThis.fetch;
    const provider = new BraveSearchProvider();
    const out = await provider.search({ query: "x" }, "k");
    expect(out).toHaveLength(1);
    expect(out[0]?.url).toBe("https://kept.test");
  });
});
