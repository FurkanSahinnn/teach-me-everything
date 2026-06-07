import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExaSearchProvider } from "./exa";

describe("ExaSearchProvider", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("POSTs to /search with x-api-key header + JSON body", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              url: "https://a.test/x",
              title: "A page",
              author: "Alice",
              publishedDate: "2026-04-01",
              favicon: "https://a.test/fav.ico",
            },
            { url: "https://b.test/y", title: "B page" },
          ],
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const provider = new ExaSearchProvider();
    const out = await provider.search({
      query: "neural networks",
      count: 7,
      apiKey: "exa-secret",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(call[0])).toBe("https://api.exa.ai/search");
    const headers = call[1].headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("exa-secret");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(call[1].body as string) as {
      query: string;
      numResults: number;
      type: string;
    };
    expect(body.query).toBe("neural networks");
    expect(body.numResults).toBe(7);
    expect(body.type).toBe("neural");

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      url: "https://a.test/x",
      title: "A page",
      age: "2026-04-01",
      faviconUrl: "https://a.test/fav.ico",
    });
    expect(out[1]).toMatchObject({
      url: "https://b.test/y",
      title: "B page",
      description: "",
    });
  });

  it("clamps numResults to [1, 25] and defaults to 10", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const provider = new ExaSearchProvider();
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;

    await provider.search({ query: "x", apiKey: "k" });
    expect(JSON.parse(calls[0]![1].body as string).numResults).toBe(10);

    await provider.search({ query: "x", count: 999, apiKey: "k" });
    expect(JSON.parse(calls[1]![1].body as string).numResults).toBe(25);

    await provider.search({ query: "x", count: 0, apiKey: "k" });
    expect(JSON.parse(calls[2]![1].body as string).numResults).toBe(1);
  });

  it("throws missing_key when apiKey is empty", async () => {
    const provider = new ExaSearchProvider();
    await expect(
      provider.search({ query: "x", apiKey: "" }),
    ).rejects.toMatchObject({ code: "missing_key", status: 401 });
  });

  it("throws empty_query when query is blank", async () => {
    const provider = new ExaSearchProvider();
    await expect(
      provider.search({ query: "  ", apiKey: "k" }),
    ).rejects.toMatchObject({ code: "empty_query", status: 400 });
  });

  it("surfaces non-2xx as upstream_error", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("forbidden", { status: 403 }),
    ) as unknown as typeof globalThis.fetch;
    const provider = new ExaSearchProvider();
    await expect(
      provider.search({ query: "x", apiKey: "k" }),
    ).rejects.toMatchObject({ code: "upstream_error", status: 403 });
  });

  it("skips results without a url defensively", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            { title: "no url" },
            { url: "https://kept.test/", title: "kept" },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof globalThis.fetch;
    const provider = new ExaSearchProvider();
    const out = await provider.search({ query: "x", apiKey: "k" });
    expect(out).toHaveLength(1);
    expect(out[0]?.url).toBe("https://kept.test/");
  });

  it("falls back to URL when title is missing", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [{ url: "https://a.test/no-title" }],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof globalThis.fetch;
    const provider = new ExaSearchProvider();
    const out = await provider.search({ query: "x", apiKey: "k" });
    expect(out[0]?.title).toBe("https://a.test/no-title");
  });
});
