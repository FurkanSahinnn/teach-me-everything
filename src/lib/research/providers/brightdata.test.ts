import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrightDataResearchProvider } from "./brightdata";

describe("BrightDataResearchProvider", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("posts to the Web Unlocker endpoint with zone + url + raw format", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        "<html><head><title>Target Page</title></head><body><h1>Hi</h1><p>Body.</p></body></html>",
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const provider = new BrightDataResearchProvider();
    const result = await provider.fetchContent({
      url: "https://target.test/page",
      apiKey: "bd-secret",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://api.brightdata.com/request");
    const init = call[1];
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer bd-secret");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(String(init.body));
    expect(body.url).toBe("https://target.test/page");
    expect(body.format).toBe("raw");
    expect(typeof body.zone).toBe("string");
    expect(body.zone.length).toBeGreaterThan(0);

    expect(result.title).toBe("Target Page");
    expect(result.url).toBe("https://target.test/page");
    expect(result.providerId).toBe("brightdata");
    expect(result.markdown).toContain("# Hi");
    expect(result.markdown).toContain("Body.");
  });

  it("strips script + style blocks before turndown conversion", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        "<html><body><script>alert(1)</script><style>.x{color:red}</style><h2>Visible</h2></body></html>",
        { status: 200 },
      ),
    ) as unknown as typeof globalThis.fetch;
    const provider = new BrightDataResearchProvider();
    const result = await provider.fetchContent({
      url: "https://x",
      apiKey: "k",
    });
    expect(result.markdown).toContain("## Visible");
    expect(result.markdown).not.toContain("alert(1)");
    expect(result.markdown).not.toContain("color:red");
  });

  it("falls back to the input URL when no <title> tag is present", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("<html><body><p>No title here.</p></body></html>", {
        status: 200,
      }),
    ) as unknown as typeof globalThis.fetch;
    const provider = new BrightDataResearchProvider();
    const result = await provider.fetchContent({
      url: "https://no-title.test",
      apiKey: "k",
    });
    expect(result.title).toBe("https://no-title.test");
  });

  it("throws missing_key when no apiKey is supplied", async () => {
    const provider = new BrightDataResearchProvider();
    await expect(
      provider.fetchContent({ url: "https://x" }),
    ).rejects.toMatchObject({ code: "missing_key", status: 401 });
  });

  it("surfaces non-2xx HTTP responses as upstream_error", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("forbidden", { status: 403 }),
    ) as unknown as typeof globalThis.fetch;
    const provider = new BrightDataResearchProvider();
    await expect(
      provider.fetchContent({ url: "https://x", apiKey: "k" }),
    ).rejects.toMatchObject({ code: "upstream_error", status: 403 });
  });

  it("throws empty_content when the upstream body is blank", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("", { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    const provider = new BrightDataResearchProvider();
    await expect(
      provider.fetchContent({ url: "https://x", apiKey: "k" }),
    ).rejects.toMatchObject({ code: "empty_content", status: 422 });
  });
});
