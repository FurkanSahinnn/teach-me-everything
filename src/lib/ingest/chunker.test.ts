import { describe, it, expect } from "vitest";
import { approxTokens, chunkPages, isHeadingByPattern } from "./chunker";

function paragraph(approxChars: number, seed = "lorem ipsum dolor sit amet "): string {
  let out = "";
  while (out.length < approxChars) out += seed;
  return out.slice(0, approxChars);
}

describe("approxTokens", () => {
  it("returns 0 for empty input", () => {
    expect(approxTokens("")).toBe(0);
  });

  it("approximates one token per ~4 characters", () => {
    expect(approxTokens("abcd")).toBe(1);
    expect(approxTokens("abcdefgh")).toBe(2);
  });

  it("never returns 0 for non-empty strings", () => {
    expect(approxTokens("a")).toBe(1);
  });
});

describe("isHeadingByPattern", () => {
  it("detects numbered section headings", () => {
    expect(isHeadingByPattern("1.2 Section Name")).toBe(true);
    expect(isHeadingByPattern("12.4.1 Sub-section")).toBe(true);
  });

  it("detects ALL-CAPS lines under 80 chars", () => {
    expect(isHeadingByPattern("INTRODUCTION")).toBe(true);
    expect(isHeadingByPattern("METHODS AND MATERIALS")).toBe(true);
  });

  it("detects keyword headings in English and Turkish", () => {
    expect(isHeadingByPattern("Bölüm 3 — Dalgalar")).toBe(true);
    expect(isHeadingByPattern("Chapter Two: Energy")).toBe(true);
    expect(isHeadingByPattern("Tartışma ve Sonuçlar")).toBe(true);
    expect(isHeadingByPattern("Abstract")).toBe(true);
  });

  it("rejects long sentences and tiny strings", () => {
    expect(isHeadingByPattern("a")).toBe(false);
    expect(isHeadingByPattern("This is a normal sentence that just keeps going and going past the threshold of any reasonable heading length.")).toBe(false);
  });
});

describe("chunkPages", () => {
  it("returns an empty array for no pages", () => {
    expect(chunkPages({ pages: [] })).toEqual([]);
  });

  it("emits a single chunk for short input", () => {
    const out = chunkPages({
      pages: [{ page: 1, text: "Hello world. This is short." }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.page).toBe(1);
    expect(out[0]?.text.length).toBeGreaterThan(0);
  });

  it("splits long input across multiple chunks with overlap", () => {
    // ~12,000 chars ≈ 3000 tokens → at TARGET_TOKENS=750 we expect 3-5 chunks
    const big = paragraph(12_000);
    const out = chunkPages({
      pages: [{ page: 1, text: big.replace(/ /g, "\n") }],
    });
    expect(out.length).toBeGreaterThanOrEqual(3);
    out.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.tokenCount).toBeGreaterThan(0);
    });
  });

  it("captures section heading and propagates it to following chunks", () => {
    const out = chunkPages({
      pages: [
        {
          page: 1,
          text: ["1.1 Quantum Field Theory", paragraph(600), paragraph(600)].join("\n"),
        },
      ],
    });
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0]?.section).toBe("1.1 Quantum Field Theory");
  });

  it("respects explicit headings list per page", () => {
    const out = chunkPages({
      pages: [
        {
          page: 2,
          text: "Custom Heading Line\nbody body body",
          headings: ["Custom Heading Line"],
        },
      ],
    });
    expect(out[0]?.headings).toContain("Custom Heading Line");
  });

  it("preserves the originating page on the first chunk", () => {
    const out = chunkPages({
      pages: [
        { page: 4, text: "Page four content." },
        { page: 5, text: "Page five content." },
      ],
    });
    expect(out[0]?.page).toBe(4);
  });

  it("preserves indentation and blank lines inside fenced code blocks", () => {
    const text = [
      "Intro paragraph.",
      "",
      "```python",
      "for param in model.features.parameters():",
      "    param.requires_grad = False",
      "",
      "model.classifier = nn.Sequential(",
      "    nn.Dropout(p=0.2),",
      "    nn.Linear(1280, len(class_names))",
      ")",
      "```",
      "",
      "End paragraph.",
    ].join("\n");
    const out = chunkPages({ pages: [{ page: 1, text }] });
    expect(out).toHaveLength(1);
    const body = out[0]?.text ?? "";
    expect(body).toContain("    param.requires_grad = False");
    expect(body).toContain("    nn.Dropout(p=0.2),");
    expect(body).toContain("    nn.Linear(1280, len(class_names))");
    // Blank line between for-loop and assignment must survive too.
    expect(body).toMatch(/param\.requires_grad = False\n\nmodel\.classifier/);
  });

  it("does not treat indented Python lines as headings inside fences", () => {
    const text = [
      "```python",
      "Abstract = 1  # would match HEADING_KEYWORDS without fence guard",
      "    for x in y:  # would match isColonLabelHeading",
      "```",
    ].join("\n");
    const out = chunkPages({ pages: [{ page: 1, text }] });
    // No section detected — these are code, not headings.
    expect(out[0]?.section).toBeUndefined();
    expect(out[0]?.headings).toBeUndefined();
  });
});
