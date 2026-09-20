import { describe, expect, it } from "vitest";
import type { ChunkRecord } from "@/lib/db/types";
import { buildReaderOutline, splitChunkIntoMarkdownSegments } from "./outline";

function chunk(id: string, text: string, extra: Partial<ChunkRecord> = {}): ChunkRecord {
  return {
    id,
    sourceId: "src_1",
    workspaceId: "ws_1",
    index: 0,
    text,
    tokenCount: 10,
    createdAt: 1,
    ...extra,
  };
}

describe("buildReaderOutline", () => {
  it("retains PDF section headings beside lists and question headings", () => {
    const entries = buildReaderOutline([chunk("pdf", "4 Contributions\n1. We propose a method.\n2. We show results.\n\n3 Results\nBody\n2.3 How do we measure catastrophic forgetting in practice?")]);
    expect(entries.map((e) => e.label)).toEqual([
      "4 Contributions", "3 Results", "2.3 How do we measure catastrophic forgetting in practice?",
    ]);
  });
  it("extracts multiple headings from a single chunk", () => {
    const outline = buildReaderOutline([
      chunk(
        "ck_1",
        [
          "### 1.3 Kritik Teknik Detaylar",
          "Patch embedding matematiksel olarak:",
          "```python",
          "# not an outline heading",
          "```",
          "**Forward SDE:**",
          "body text",
        ].join("\n"),
      ),
    ]);

    expect(outline.map((item) => item.label)).toEqual([
      "1.3 Kritik Teknik Detaylar",
      "Patch embedding matematiksel olarak",
      "Forward SDE",
    ]);
    expect(outline.map((item) => item.targetId)).toEqual([
      "reader-heading-ck_1-0",
      "reader-heading-ck_1-1",
      "reader-heading-ck_1-5",
    ]);
  });

  it("deduplicates section and inline headings", () => {
    const outline = buildReaderOutline([
      chunk("ck_1", "## 1.1 Intro\nText", {
        section: "1.1 Intro",
        headings: ["1.1 Intro"],
      }),
    ]);

    expect(outline.map((item) => item.label)).toEqual(["1.1 Intro"]);
  });

  it("ignores bullet lines", () => {
    const outline = buildReaderOutline([
      chunk("ck_1", "- Stable Diffusion neden devrimsel oldu?\n2.1 Real Heading"),
    ]);

    expect(outline.map((item) => item.label)).toEqual(["2.1 Real Heading"]);
  });

  it("keeps an ordered list in one segment when the document uses # headings", () => {
    const segments = splitChunkIntoMarkdownSegments(
      chunk("ck_1", "## Steps\n\n1. First\n2. Second\n3. Third"),
    );
    expect(segments).toHaveLength(1);
  });

  it("does not read ordered-list items or numbered sentences as headings in plain text", () => {
    const outline = buildReaderOutline([
      chunk(
        "ck_1",
        "1. First item here\n2. Second item here\n3. Third item here\n\n2.1. Dead neurons are a problem that appears when the input is negative.\n\n2.2 Real Heading",
      ),
    ]);
    expect(outline.map((item) => item.label)).toEqual(["2.2 Real Heading"]);
  });

  it("splits chunk markdown at heading anchors", () => {
    const segments = splitChunkIntoMarkdownSegments(
      chunk("ck_1", "Lead text\n## First\nBody\n### Second\nMore"),
    );

    expect(segments).toEqual([
      { key: "ck_1-0", text: "Lead text" },
      {
        key: "ck_1-1",
        anchorId: "reader-heading-ck_1-1",
        text: "## First\nBody",
      },
      {
        key: "ck_1-3",
        anchorId: "reader-heading-ck_1-3",
        text: "### Second\nMore",
      },
    ]);
  });
});
