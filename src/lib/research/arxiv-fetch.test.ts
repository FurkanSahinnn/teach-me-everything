import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchArxiv, parseArxivAtom } from "./arxiv-fetch";

const SAMPLE_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.12345v1</id>
    <updated>2024-01-23T12:34:56Z</updated>
    <published>2024-01-23T12:34:56Z</published>
    <title>Attention Is All You Need (Revisited)</title>
    <summary>This is a sample abstract describing a transformer revisit.</summary>
    <author><name>Alice Example</name></author>
    <author><name>Bob Sample</name></author>
    <link href="http://arxiv.org/abs/2401.12345v1" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2401.12345v1.pdf" rel="related" type="application/pdf"/>
  </entry>
</feed>`;

describe("parseArxivAtom", () => {
  it("extracts title, authors, abstract, year, and pdf link", () => {
    const parsed = parseArxivAtom(SAMPLE_ATOM, "2401.12345");
    expect(parsed.title).toBe("Attention Is All You Need (Revisited)");
    expect(parsed.authors).toEqual(["Alice Example", "Bob Sample"]);
    expect(parsed.abstract).toContain("transformer revisit");
    expect(parsed.publishedYear).toBe("2024");
    expect(parsed.pdfUrl).toBe("http://arxiv.org/pdf/2401.12345v1.pdf");
    expect(parsed.canonicalUrl).toBe("https://arxiv.org/abs/2401.12345");
  });

  it("returns empty fields for empty XML", () => {
    const parsed = parseArxivAtom("<feed></feed>", "0000.0000");
    expect(parsed.title).toBe("arXiv 0000.0000");
    expect(parsed.authors).toEqual([]);
    expect(parsed.abstract).toBe("");
  });

  it("decodes XML entities in title and abstract", () => {
    const xml = `<feed><entry>
      <title>A &amp; B in &lt;sup&gt;1&lt;/sup&gt; space</title>
      <summary>Energy &gt; threshold &amp; convergence.</summary>
    </entry></feed>`;
    const parsed = parseArxivAtom(xml, "x");
    expect(parsed.title).toBe("A & B in <sup>1</sup> space");
    expect(parsed.abstract).toBe("Energy > threshold & convergence.");
  });
});

describe("fetchArxiv (mocked fetch)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("builds a Markdown body with metadata + abstract", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(SAMPLE_ATOM, { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    const result = await fetchArxiv("2401.12345");
    expect(result.title).toBe("Attention Is All You Need (Revisited)");
    expect(result.author).toBe("Alice Example, Bob Sample");
    expect(result.markdown).toContain("# Attention Is All You Need");
    expect(result.markdown).toContain("**Authors:** Alice Example, Bob Sample");
    expect(result.markdown).toContain("**Year:** 2024");
    expect(result.markdown).toContain("## Abstract");
    expect(result.pdfUrl).toBe("http://arxiv.org/pdf/2401.12345v1.pdf");
    expect(result.providerId).toBe("readability");
    expect(result.meta?.extractor).toBe("arxiv-api");
  });

  it("throws ResearchError when upstream returns non-OK", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("nope", { status: 503 }),
    ) as unknown as typeof globalThis.fetch;
    await expect(fetchArxiv("2401.12345")).rejects.toMatchObject({
      status: 503,
      code: "upstream_error",
    });
  });
});
