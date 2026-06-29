import { describe, expect, it } from "vitest";

import {
  groupChunksIntoSections,
  groupToText,
  MAX_CHUNKS_PER_GROUP,
} from "@/lib/article-analysis/token-budget";
import type { ChunkRecord } from "@/lib/db/types";

function chunk(partial: Partial<ChunkRecord> & { index: number }): ChunkRecord {
  return {
    id: `ck_${partial.index}`,
    sourceId: "src_1",
    workspaceId: "ws_1",
    text: partial.text ?? `chunk text ${partial.index}`,
    tokenCount: partial.tokenCount ?? 100,
    createdAt: 0,
    ...partial,
  };
}

describe("groupChunksIntoSections", () => {
  it("returns no groups for an empty chunk list", () => {
    expect(groupChunksIntoSections([])).toEqual([]);
  });

  it("groups consecutive chunks sharing a section together", () => {
    const groups = groupChunksIntoSections([
      chunk({ index: 0, section: "Intro" }),
      chunk({ index: 1, section: "Intro" }),
      chunk({ index: 2, section: "Methods" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.sectionTitle).toBe("Intro");
    expect(groups[0]?.chunks).toHaveLength(2);
    expect(groups[1]?.sectionTitle).toBe("Methods");
  });

  it("falls back to fixed windows when chunks carry no section", () => {
    const many = Array.from({ length: MAX_CHUNKS_PER_GROUP + 2 }, (_, i) =>
      chunk({ index: i }),
    );
    const groups = groupChunksIntoSections(many);
    // No section labels → pure fixed windows capped at MAX_CHUNKS_PER_GROUP.
    expect(groups).toHaveLength(2);
    expect(groups[0]?.chunks).toHaveLength(MAX_CHUNKS_PER_GROUP);
    expect(groups[0]?.sectionTitle).toBeUndefined();
  });

  it("splits an oversized section by the per-group token cap", () => {
    const groups = groupChunksIntoSections(
      [
        chunk({ index: 0, section: "Big", tokenCount: 3000 }),
        chunk({ index: 1, section: "Big", tokenCount: 3000 }),
        chunk({ index: 2, section: "Big", tokenCount: 3000 }),
      ],
      { maxTokensPerGroup: 4500 },
    );
    // 3000 + 3000 > 4500 → each chunk forced into its own group.
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.sectionTitle === "Big")).toBe(true);
  });

  it("caps the total group count by merging the tail", () => {
    const chunks = Array.from({ length: 40 }, (_, i) =>
      chunk({ index: i, section: `S${i}` }),
    );
    const groups = groupChunksIntoSections(chunks, { maxGroups: 16 });
    expect(groups).toHaveLength(16);
    // The last group absorbs every chunk past the head budget.
    const total = groups.reduce((n, g) => n + g.chunks.length, 0);
    expect(total).toBe(40);
    expect(groups[15]?.chunks.length).toBeGreaterThan(1);
  });

  it("uses the first heading when no explicit section is present", () => {
    const groups = groupChunksIntoSections([
      chunk({ index: 0, headings: ["Results"] }),
    ]);
    expect(groups[0]?.sectionTitle).toBe("Results");
  });
});

describe("groupToText", () => {
  it("renders chunk markers with page numbers", () => {
    const text = groupToText({
      sectionTitle: "Intro",
      chunks: [chunk({ index: 3, page: 7, text: "Hello world" })],
    });
    expect(text).toContain("#3");
    expect(text).toContain("page: 7");
    expect(text).toContain("Hello world");
  });
});
