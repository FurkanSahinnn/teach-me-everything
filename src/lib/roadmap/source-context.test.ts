import { describe, expect, it } from "vitest";
import type { RetrievedChunk } from "@/lib/ai/retrieval";
import type { ChunkRecord } from "@/lib/db/types";
import {
  buildRoadmapSourceContext,
  formatExcerptContext,
} from "./source-context";

function chunk(
  id: string,
  sourceId: string,
  text: string,
  embedding?: Float32Array,
  section?: string,
): ChunkRecord {
  return {
    id,
    sourceId,
    workspaceId: "w1",
    index: 0,
    text,
    tokenCount: Math.max(1, Math.ceil(text.length / 4)),
    page: undefined,
    section: section ?? null,
    headings: [],
    createdAt: 0,
    ...(embedding
      ? {
          embedding,
          embeddingProvider: "openai",
          embeddingModel: "text-embedding-3-small",
          embeddingDim: embedding.length,
        }
      : {}),
  } as unknown as ChunkRecord;
}

const emb = (n: number): Float32Array => Float32Array.from([n, 0, 0]);
const r = (c: ChunkRecord, score: number): RetrievedChunk => ({ chunk: c, score });

describe("formatExcerptContext", () => {
  it("returns undefined for no chunks", () => {
    expect(formatExcerptContext([])).toBeUndefined();
  });

  it("caps each excerpt + collapses whitespace (no full-document dump)", () => {
    const long = "word \n\t ".repeat(2000); // ~16k chars of whitespace-heavy text
    const out = formatExcerptContext([r(chunk("c1", "s1", long), 0.9)]);
    expect(out).toContain("top matches only");
    // header + one ~600-char excerpt — nowhere near the raw length
    expect((out ?? "").length).toBeLessThan(900);
  });

  it("prefixes a section heading when present", () => {
    const out = formatExcerptContext([
      r(chunk("c1", "s1", "body text", undefined, "Chapter 2"), 0.9),
    ]);
    expect(out).toContain("[Chapter 2]");
    expect(out).toContain("body text");
  });
});

describe("buildRoadmapSourceContext", () => {
  it("grounds on retrieved excerpts from ONLY the selected sources", async () => {
    const out = await buildRoadmapSourceContext(
      "w1",
      { topic: "transformers", sourceIds: ["sA"] },
      {
        loadChunks: async () => [
          chunk("c1", "sA", "Attention is all you need", emb(1)),
          chunk("c2", "sB", "Totally unrelated thing", emb(1)),
        ],
        embedQuery: async () => emb(1),
      },
    );
    expect(out).toContain("Attention is all you need");
    expect(out).not.toContain("Totally unrelated"); // sB filtered out by sourceIds
  });
});
