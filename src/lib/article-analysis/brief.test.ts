import { describe, expect, it } from "vitest";
import { buildQuoteIndex } from "./citation-verify";
import { countBriefWords, countUnmatchedSourceBlocks, hasSufficientBriefDepth, materializeBrief, minimumBriefWords, parseBrief, parseBriefProgress, projectBriefToLegacy, streamingBriefText } from "./brief";
import type { ChunkRecord } from "@/lib/db/types";

const chunk = {
  id: "chunk-1",
  sourceId: "source-1",
  index: 0,
  text: "We compared the proposed method with a baseline on 100 samples.",
} as ChunkRecord;

const wire = {
  paperType: "empirical",
  field: "machine learning",
  methodologyType: "controlled comparison",
  dataSample: "100 samples",
  thesis: {
    kind: "prose",
    text: "The method improves a measured outcome.",
    grounding: "source",
    citations: [{ quote: "compared the proposed method with a baseline" }],
  },
  sections: [
    {
      kind: "findings",
      title: "What the study found",
      blocks: [{
        kind: "result",
        text: "A comparison was reported.",
        grounding: "source",
        citations: [{ quote: "We compared the proposed method with a baseline" }],
        metric: "outcome",
        context: "100 samples",
      }],
    },
  ],
};

describe("article brief", () => {
  it("verifies quotes and projects comparable claims for existing comparisons", () => {
    const parsed = parseBrief(JSON.stringify(wire));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const brief = materializeBrief(parsed.value, buildQuoteIndex([chunk]), {
      includedChunks: 1,
      omittedChunks: 0,
    });
    expect(brief.thesis.citations?.[0]).toMatchObject({
      verification: "exact",
      chunkId: "chunk-1",
    });
    expect(brief.sections[0]?.blocks[0]?.id).toBe("findings-0-0");
    expect(projectBriefToLegacy(brief).keyResults[0]?.citations?.[0]?.chunkId).toBe("chunk-1");
    expect(projectBriefToLegacy(brief).ataGlance).toMatchObject({
      field: "machine learning", methodologyType: "controlled comparison", dataSample: "100 samples",
    });
    expect(countUnmatchedSourceBlocks(brief)).toBe(0);
  });

  it("rejects malformed analysis instead of persisting it", () => {
    expect(parseBrief('{"paperType":"empirical","sections":[]}').ok).toBe(false);
  });

  it("reveals only complete sections from a streaming JSON response", () => {
    const opening = JSON.stringify({ ...wire, sections: [] }).replace(/\[\]}$/, "[");
    const first = JSON.stringify(wire.sections[0]);
    const second = JSON.stringify({ kind: "critical", title: "Limits", blocks: [{ kind: "caution", text: "A brace } inside a sentence is harmless.", grounding: "interpretation" }] });
    const initial = parseBriefProgress(opening);
    expect(initial.ok && initial.value.sections).toHaveLength(0);
    const incomplete = parseBriefProgress(opening + first.slice(0, -4));
    expect(incomplete.ok && incomplete.value.sections).toHaveLength(0);
    const one = parseBriefProgress(opening + first + "," + second.slice(0, -5));
    expect(one.ok && one.value.sections).toHaveLength(1);
    const two = parseBriefProgress(opening + first + "," + second + "]}");
    expect(two.ok && two.value.sections).toHaveLength(2);
  });

  it("extracts unfinished prose without exposing JSON syntax", () => {
    expect(streamingBriefText('{"thesis":{"text":"A measured')).toBe("A measured");
    expect(streamingBriefText('{"thesis":{"text":"A \\"careful\\"')).toBe('A "careful"');
    expect(streamingBriefText('{"thesis":{"text":"Done","grounding":"source"')).toBeUndefined();
  });

  it("counts source claims whose quoted passages cannot be found", () => {
    const parsed = parseBrief(JSON.stringify({
      ...wire,
      thesis: { ...wire.thesis, citations: [{ quote: "an invented source passage" }] },
    }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const brief = materializeBrief(parsed.value, buildQuoteIndex([chunk]), { includedChunks: 1, omittedChunks: 0 });
    expect(countUnmatchedSourceBlocks(brief)).toBe(1);
  });

  it("expects substantial detail for a full paper without padding a tiny source", () => {
    expect(minimumBriefWords(200)).toBe(0);
    expect(minimumBriefWords(2_000)).toBe(760);
    expect(minimumBriefWords(10_000)).toBe(3_000);
    const parsed = parseBrief(JSON.stringify(wire));
    if (!parsed.ok) throw new Error("Fixture should parse");
    const brief = materializeBrief(parsed.value, buildQuoteIndex([chunk]), { includedChunks: 1, omittedChunks: 0 });
    expect(countBriefWords(brief)).toBeGreaterThan(10);
    expect(countBriefWords(brief)).toBeLessThan(100);
    expect(hasSufficientBriefDepth(brief, 10_000)).toBe(false);
    expect(hasSufficientBriefDepth(brief, 200)).toBe(true);
  });
});
