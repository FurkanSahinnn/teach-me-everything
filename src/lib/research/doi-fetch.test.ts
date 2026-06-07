import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDoi } from "./doi-fetch";

function mockJsonOk(body: unknown): typeof globalThis.fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof globalThis.fetch;
}

describe("fetchDoi", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("builds Markdown from Crossref response", async () => {
    globalThis.fetch = mockJsonOk({
      status: "ok",
      message: {
        title: ["Sample Paper Title"],
        author: [
          { given: "Alice", family: "Example" },
          { given: "Bob", family: "Sample" },
        ],
        "container-title": ["Journal of Things"],
        publisher: "Example Press",
        URL: "https://example.org/paper",
        abstract:
          "<jats:p>An example abstract <jats:italic>with</jats:italic> JATS.</jats:p>",
      },
    });
    const result = await fetchDoi("10.1234/sample");
    expect(result.title).toBe("Sample Paper Title");
    expect(result.author).toBe("Alice Example, Bob Sample");
    expect(result.markdown).toContain("# Sample Paper Title");
    expect(result.markdown).toContain("**Journal:** Journal of Things");
    expect(result.markdown).toContain("**Publisher:** Example Press");
    expect(result.markdown).toContain("[10.1234/sample](https://doi.org/10.1234/sample)");
    expect(result.markdown).toContain("## Abstract");
    expect(result.markdown).toContain("An example abstract with JATS.");
    expect(result.meta?.extractor).toBe("crossref");
    expect(result.meta?.hasAbstract).toBe(true);
  });

  it("surfaces pdf link when content-type is application/pdf", async () => {
    globalThis.fetch = mockJsonOk({
      status: "ok",
      message: {
        title: ["With PDF"],
        link: [
          { URL: "https://example.org/x.html", "content-type": "text/html" },
          { URL: "https://example.org/x.pdf", "content-type": "application/pdf" },
        ],
      },
    });
    const result = await fetchDoi("10.1/x");
    expect(result.pdfUrl).toBe("https://example.org/x.pdf");
  });

  it("falls back when no abstract is provided", async () => {
    globalThis.fetch = mockJsonOk({
      status: "ok",
      message: { title: ["Bare Entry"] },
    });
    const result = await fetchDoi("10.1/bare");
    expect(result.markdown).toContain("No abstract available");
    expect(result.meta?.hasAbstract).toBe(false);
  });

  it("throws ResearchError on non-OK", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("notfound", { status: 404 }),
    ) as unknown as typeof globalThis.fetch;
    await expect(fetchDoi("10.1/missing")).rejects.toMatchObject({
      status: 404,
      code: "upstream_error",
    });
  });

  it("throws on network error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof globalThis.fetch;
    await expect(fetchDoi("10.1/x")).rejects.toMatchObject({
      code: "fetch_failed",
    });
  });
});
