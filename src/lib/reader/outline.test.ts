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
