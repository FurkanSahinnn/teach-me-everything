import { describe, expect, it } from "vitest";

import {
  buildQuoteIndex,
  normalizeForMatch,
  scoreGrounding,
  verifyQuote,
} from "./citation-verify";
import type { ChunkRecord } from "@/lib/db/types";

function chunk(id: string, text: string): ChunkRecord {
  return {
    id,
    sourceId: "src-1",
    workspaceId: "ws-1",
    index: 0,
    text,
    tokenCount: Math.ceil(text.length / 4),
  } as ChunkRecord;
}

const PAPER = [
  chunk(
    "c1",
    "We propose a novel attention mechanism that scales linearly with sequence length, addressing the quadratic bottleneck of standard transformers.",
  ),
  chunk(
    "c2",
    "On the WMT14 benchmark our model reaches a BLEU score of 29.4, outperforming the strongest published baseline by 1.2 points.",
  ),
];

describe("normalizeForMatch", () => {
  it("folds typographic punctuation, ligatures and whitespace", () => {
    expect(normalizeForMatch("The  “ﬁnal”   result—here")).toBe(
      'the "final" result-here',
    );
  });

  it("rejoins words hyphenated across a line break", () => {
    expect(normalizeForMatch("atten-\n   tion is all")).toBe("attention is all");
  });
});

describe("verifyQuote", () => {
  const index = buildQuoteIndex(PAPER);

  it("marks a verbatim span exact and resolves its chunk", () => {
    const result = verifyQuote(
      "scales linearly with sequence length",
      index,
    );
    expect(result).toEqual({ verification: "exact", chunkId: "c1" });
  });

  it("still marks exact when only casing and punctuation differ", () => {
    const result = verifyQuote(
      "a BLEU  score of 29.4, outperforming the strongest published baseline",
      index,
    );
    expect(result).toEqual({ verification: "exact", chunkId: "c2" });
  });

  it("marks a lightly reflowed quote fuzzy rather than exact", () => {
    // Same words as c1 but with an interior clause dropped — a model
    // "verbatim" quote that silently elided text.
    const result = verifyQuote(
      "we propose a novel attention mechanism that scales linearly with length",
      index,
    );
    expect(result.verification).toBe("fuzzy");
    expect(result.chunkId).toBe("c1");
  });

  it("marks a fabricated quote unverified and gives no chunk", () => {
    const result = verifyQuote(
      "our method eliminates the need for any training data whatsoever",
      index,
    );
    expect(result).toEqual({ verification: "unverified" });
  });

  it("refuses to verify a quote too short to be distinctive", () => {
    expect(verifyQuote("we propose", index)).toEqual({
      verification: "unverified",
    });
  });

  it("does not let a short lucky overlap verify a long fabrication", () => {
    // Opens with 8 real words then invents two sentences: the run clears the
    // word-count floor but not the coverage floor.
    const result = verifyQuote(
      "we propose a novel attention mechanism that scales linearly " +
        "and therefore requires no gradient updates at inference time which " +
        "makes it uniquely suited to embedded hardware deployments in the field",
      index,
    );
    expect(result.verification).toBe("unverified");
  });

  it("returns unverified against an empty document", () => {
    expect(
      verifyQuote("scales linearly with sequence length", buildQuoteIndex([])),
    ).toEqual({ verification: "unverified" });
  });
});

describe("scoreGrounding", () => {
  it("counts source claims, citations and per-verdict totals", () => {
    const score = scoreGrounding([
      [
        {
          grounding: "source",
          citations: [
            { verification: "exact", chunkId: "c1" },
            { verification: "unverified" },
          ],
        },
        { grounding: "source", citations: [{ verification: "unverified" }] },
      ],
      [
        { grounding: "general" },
        { grounding: "source", citations: [{ verification: "fuzzy", chunkId: "c2" }] },
      ],
    ]);
    expect(score).toEqual({
      sourceClaims: 3,
      verifiedClaims: 2,
      totalCitations: 4,
      exact: 1,
      fuzzy: 1,
      unverified: 2,
    });
  });

  it("treats a source claim with no citations as unverified", () => {
    const score = scoreGrounding([[{ grounding: "source" }]]);
    expect(score.sourceClaims).toBe(1);
    expect(score.verifiedClaims).toBe(0);
    expect(score.totalCitations).toBe(0);
  });

  it("falls back to chunkId for legacy citations lacking a verdict", () => {
    const score = scoreGrounding([
      [{ grounding: "source", citations: [{ chunkId: "c1" }] }],
    ]);
    expect(score.exact).toBe(1);
    expect(score.verifiedClaims).toBe(1);
  });
});
