import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiffbotResearchProvider } from "./diffbot";

describe("DiffbotResearchProvider", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("calls the article endpoint with token + url and converts html to markdown", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          objects: [
            {
              title: "Quantum Computing Today",
              html:
                "<h1>Quantum Computing Today</h1><p>A short <a href=\"https://x.test\">intro</a>.</p>",
              author: "Ada Lovelace",
              date: "2026-05-12T00:00:00Z",
              resolvedPageUrl: "https://example.org/quantum",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const provider = new DiffbotResearchProvider();
    const result = await provider.fetchContent({
      url: "https://example.org/quantum",
      apiKey: "diffbot-secret",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const requestedUrl = String(call[0]);
    expect(requestedUrl).toContain("https://api.diffbot.com/v3/article");
    expect(requestedUrl).toContain("token=diffbot-secret");
    expect(requestedUrl).toContain(
      "url=" + encodeURIComponent("https://example.org/quantum"),
    );
    expect(requestedUrl).toContain("discussion=false");

    expect(result.title).toBe("Quantum Computing Today");
    expect(result.author).toBe("Ada Lovelace");
    expect(result.url).toBe("https://example.org/quantum");
    expect(result.providerId).toBe("diffbot");
    // Turndown converts <h1> → "# " heading + paragraph with markdown link.
    expect(result.markdown).toContain("# Quantum Computing Today");
    expect(result.markdown).toContain("[intro](https://x.test)");
  });

  it("falls back to plain text when html is missing", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          objects: [
            { title: "Plain", text: "Bare text body, no html.", pageUrl: "https://x" },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof globalThis.fetch;
    const provider = new DiffbotResearchProvider();
    const result = await provider.fetchContent({ url: "https://x", apiKey: "k" });
    expect(result.markdown).toBe("Bare text body, no html.");
    expect(result.title).toBe("Plain");
  });

  it("throws missing_key when no apiKey is supplied", async () => {
    const provider = new DiffbotResearchProvider();
    await expect(
      provider.fetchContent({ url: "https://x" }),
    ).rejects.toMatchObject({ code: "missing_key", status: 401 });
  });

  it("surfaces the upstream error envelope as upstream_error", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ errorCode: 429, error: "Rate limited" }),
        { status: 200 },
      ),
    ) as unknown as typeof globalThis.fetch;
    const provider = new DiffbotResearchProvider();
    await expect(
      provider.fetchContent({ url: "https://x", apiKey: "k" }),
    ).rejects.toMatchObject({ code: "upstream_error", status: 429 });
  });

  it("throws empty_content when the article object is missing or has no body", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ objects: [] }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    const provider = new DiffbotResearchProvider();
    await expect(
      provider.fetchContent({ url: "https://x", apiKey: "k" }),
    ).rejects.toMatchObject({ code: "empty_content", status: 422 });
  });

  it("surfaces non-2xx HTTP responses as upstream_error", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("internal", { status: 500 }),
    ) as unknown as typeof globalThis.fetch;
    const provider = new DiffbotResearchProvider();
    await expect(
      provider.fetchContent({ url: "https://x", apiKey: "k" }),
    ).rejects.toMatchObject({ code: "upstream_error", status: 500 });
  });
});
