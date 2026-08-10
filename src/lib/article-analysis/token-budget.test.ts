import { describe, expect, it } from "vitest";

import {
  ARTICLE_WINDOW_TOKENS,
  buildArticleWindow,
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

describe("buildArticleWindow", () => {
  it("returns an empty window for no chunks", () => {
    expect(buildArticleWindow([])).toEqual({
      text: "",
      truncated: false,
      includedChunks: 0,
      omittedChunks: 0,
    });
  });

  it("includes the whole document untruncated when it fits the budget", () => {
    const chunks = [0, 1, 2].map((index) =>
      chunk({ index, text: `body ${index}`, tokenCount: 100 }),
    );
    const win = buildArticleWindow(chunks, 1000);
    expect(win.truncated).toBe(false);
    expect(win.includedChunks).toBe(3);
    expect(win.omittedChunks).toBe(0);
    for (const c of chunks) expect(win.text).toContain(c.text);
  });

  it("keeps BOTH the head and the tail when the document overflows", () => {
    // 10 chunks × 100 tokens, budget 500 → head 300 (0-2), tail 200 (8-9).
    const chunks = Array.from({ length: 10 }, (_, index) =>
      chunk({ index, text: `body ${index}`, tokenCount: 100 }),
    );
    const win = buildArticleWindow(chunks, 500);
    expect(win.truncated).toBe(true);
    expect(win.text).toContain("body 0");
    // The regression this guards: a head-only clamp dropped the paper's
    // conclusions/limitations entirely.
    expect(win.text).toContain("body 9");
    expect(win.text).not.toContain("body 5");
    expect(win.includedChunks + win.omittedChunks).toBe(10);
  });

  it("marks the elided span so the model knows text is missing", () => {
    const chunks = Array.from({ length: 10 }, (_, index) =>
      chunk({ index, tokenCount: 100 }),
    );
    const win = buildArticleWindow(chunks, 500);
    expect(win.text).toContain(`${win.omittedChunks} chunk(s)`);
    expect(win.text).toContain("omitted for length");
  });

  it("never splits a chunk — every included chunk appears whole", () => {
    const chunks = Array.from({ length: 8 }, (_, index) =>
      chunk({ index, text: `sentence ${index} stays intact`, tokenCount: 100 }),
    );
    const win = buildArticleWindow(chunks, 400);
    for (const c of chunks) {
      const present = win.text.includes(c.text);
      const partial =
        !present && win.text.includes(c.text.slice(0, c.text.length - 3));
      expect(partial).toBe(false);
    }
  });

  it("still emits the first chunk when it alone exceeds the budget", () => {
    const win = buildArticleWindow(
      [chunk({ index: 0, text: "huge", tokenCount: 5000 })],
      100,
    );
    expect(win.text).toContain("huge");
    expect(win.includedChunks).toBe(1);
  });

  it("defaults to a budget generous enough for an ordinary paper", () => {
    // ~30k tokens is a long conference paper; it must not be truncated.
    const chunks = Array.from({ length: 60 }, (_, index) =>
      chunk({ index, tokenCount: 500 }),
    );
    expect(ARTICLE_WINDOW_TOKENS).toBeGreaterThanOrEqual(30_000);
    expect(buildArticleWindow(chunks).truncated).toBe(false);
  });
});
