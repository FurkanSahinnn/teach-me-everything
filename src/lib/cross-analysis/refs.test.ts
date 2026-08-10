import { describe, expect, it } from "vitest";

import {
  bestVerifiedCitation,
  buildClaimTable,
  formatRef,
  groundContradictions,
  renderClaimTable,
  type RawContradiction,
} from "./refs";
import type {
  AnalysisClaim,
  ArticleAnalysisPayload,
} from "@/lib/article-analysis/types";

function claim(
  text: string,
  citations?: AnalysisClaim["citations"],
): AnalysisClaim {
  return {
    text,
    grounding: citations ? "source" : "general",
    ...(citations ? { citations } : {}),
  };
}

// Minimal payload carrying only the fields the ref table reads.
function payload(over: Partial<ArticleAnalysisPayload>): ArticleAnalysisPayload {
  return {
    contributions: [],
    keyResults: [],
    assumptionsLimitations: [],
    howItSolves: [],
    ...over,
  } as unknown as ArticleAnalysisPayload;
}

const VERIFIED = [{ quote: "a verbatim span", verification: "exact" as const }];
const FUZZY = [{ quote: "a reflowed span", verification: "fuzzy" as const }];
const UNVERIFIED = [
  { quote: "invented span", verification: "unverified" as const },
];

describe("formatRef / buildClaimTable", () => {
  it("indexes every comparable field under a stable ref", () => {
    const table = buildClaimTable([
      payload({
        contributions: [claim("c0"), claim("c1")],
        keyResults: [claim("r0")],
      }),
      payload({ assumptionsLimitations: [claim("a0")] }),
    ]);

    expect(table.get("p0.co0")?.claim.text).toBe("c0");
    expect(table.get("p0.co1")?.claim.text).toBe("c1");
    expect(table.get("p0.kr0")?.claim.text).toBe("r0");
    expect(table.get("p1.al0")?.claim.text).toBe("a0");
    expect(table.size).toBe(4);
  });

  it("formatRef matches the keys buildClaimTable emits", () => {
    const table = buildClaimTable([payload({ keyResults: [claim("r")] })]);
    expect(table.has(formatRef(0, "keyResults", 0))).toBe(true);
  });

  it("does not index problemMotivation or priorWorkGap", () => {
    const table = buildClaimTable([
      payload({
        problemMotivation: [claim("pm")],
        priorWorkGap: [claim("pw")],
      } as Partial<ArticleAnalysisPayload>),
    ]);
    expect(table.size).toBe(0);
  });
});

describe("bestVerifiedCitation", () => {
  it("prefers an exact citation over a fuzzy one", () => {
    const c = claim("x", [...FUZZY, ...VERIFIED]);
    expect(bestVerifiedCitation(c)?.verification).toBe("exact");
  });

  it("falls back to fuzzy when no exact citation exists", () => {
    expect(bestVerifiedCitation(claim("x", FUZZY))?.verification).toBe("fuzzy");
  });

  it("returns undefined when every citation is unverified", () => {
    expect(bestVerifiedCitation(claim("x", UNVERIFIED))).toBeUndefined();
  });

  it("returns undefined for a claim with no citations", () => {
    expect(bestVerifiedCitation(claim("x"))).toBeUndefined();
  });

  it("treats a legacy citation with a chunkId but no verdict as verified", () => {
    const legacy = claim("x", [{ quote: "old", chunkId: "chunk-1" }]);
    expect(bestVerifiedCitation(legacy)?.chunkId).toBe("chunk-1");
  });
});

describe("groundContradictions", () => {
  const table = buildClaimTable([
    payload({ keyResults: [claim("A improves X", VERIFIED)] }),
    payload({ keyResults: [claim("A degrades X", VERIFIED), claim("loose", UNVERIFIED)] }),
  ]);

  const pair = (over: Partial<RawContradiction> = {}): RawContradiction => ({
    aRef: "p0.kr0",
    bRef: "p1.kr0",
    kind: "direct",
    explanation: "opposite direction on the same metric",
    ...over,
  });

  it("resolves refs to the original claim text, not model prose", () => {
    const [found] = groundContradictions([pair()], table);
    expect(found?.a.text).toBe("A improves X");
    expect(found?.b.text).toBe("A degrades X");
    expect(found?.grounded).toBe(true);
  });

  it("drops a pair whose ref does not resolve", () => {
    expect(groundContradictions([pair({ aRef: "p9.kr9" })], table)).toEqual([]);
  });

  it("drops a pair pointing at a single paper", () => {
    const selfPair = pair({ aRef: "p1.kr0", bRef: "p1.kr1" });
    expect(groundContradictions([selfPair], table)).toEqual([]);
  });

  it("collapses a duplicate pair emitted in reverse order", () => {
    const reversed = pair({ aRef: "p1.kr0", bRef: "p0.kr0" });
    expect(groundContradictions([pair(), reversed], table)).toHaveLength(1);
  });

  it("marks a pair ungrounded when one side has no verified citation", () => {
    const [found] = groundContradictions(
      [pair({ bRef: "p1.kr1" })],
      table,
    );
    expect(found?.grounded).toBe(false);
    expect(found?.b.citation).toBeUndefined();
  });

  it("sorts grounded findings ahead of ungrounded ones", () => {
    const results = groundContradictions(
      [pair({ bRef: "p1.kr1" }), pair()],
      table,
    );
    expect(results.map((r) => r.grounded)).toEqual([true, false]);
  });

  it("carries the model's kind and explanation through unchanged", () => {
    const [found] = groundContradictions(
      [pair({ kind: "scope", explanation: "different populations" })],
      table,
    );
    expect(found?.kind).toBe("scope");
    expect(found?.explanation).toBe("different populations");
  });
});

describe("renderClaimTable", () => {
  it("labels every claim with its ref and a verifiability mark", () => {
    const rendered = renderClaimTable(
      [payload({ keyResults: [claim("checkable", VERIFIED), claim("bare")] })],
      ["Attention Is All You Need"],
    );
    expect(rendered).toContain("Paper p0: Attention Is All You Need");
    expect(rendered).toContain("[p0.kr0] ✓ checkable");
    expect(rendered).toContain("[p0.kr1] · bare");
  });

  it("falls back when a title is missing", () => {
    expect(renderClaimTable([payload({})], [])).toContain("(untitled)");
  });
});
