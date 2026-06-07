import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirecrawlResearchProvider } from "./firecrawl";

describe("FirecrawlResearchProvider", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("posts the URL + apiKey with the expected body shape", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: "# Hello\n\nWorld",
            metadata: {
              title: "Hello",
              author: "Someone",
              sourceURL: "https://example.org/x",
            },
          },
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const provider = new FirecrawlResearchProvider();
    const result = await provider.fetchContent({
      url: "https://example.org/x",
      apiKey: "fc-secret",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const init = call[1];
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer fc-secret");
    const body = JSON.parse(String(init.body));
    expect(body.url).toBe("https://example.org/x");
    expect(body.formats).toEqual(["markdown"]);
    expect(body.onlyMainContent).toBe(true);

    expect(result.title).toBe("Hello");
    expect(result.author).toBe("Someone");
    expect(result.markdown).toContain("# Hello");
    expect(result.providerId).toBe("firecrawl");
  });

  it("throws missing_key when no apiKey is supplied", async () => {
    const provider = new FirecrawlResearchProvider();
    await expect(provider.fetchContent({ url: "https://x" })).rejects.toMatchObject({
      code: "missing_key",
      status: 401,
    });
  });

  it("throws empty_content when success=false", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ success: false, error: "rate limited" }),
        { status: 200 },
      ),
    ) as unknown as typeof globalThis.fetch;
    const provider = new FirecrawlResearchProvider();
    await expect(
      provider.fetchContent({ url: "https://x", apiKey: "k" }),
    ).rejects.toMatchObject({ code: "empty_content" });
  });
});
