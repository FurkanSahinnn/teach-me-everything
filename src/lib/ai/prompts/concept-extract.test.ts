import { describe, it, expect } from "vitest";
import {
  buildConceptExtractSystem,
  normalizeConceptLabel,
  parseConceptExtractOutput,
} from "./concept-extract";

const SAMPLE_VALID = JSON.stringify({
  concepts: [
    {
      label: "Entropy",
      kind: "concept",
      definition: "Measure of disorder.",
      chunkRefs: ["#0", "#3"],
    },
    {
      label: "Heat engine",
      kind: "method",
      chunkRefs: ["#2"],
    },
  ],
  edges: [
    {
      from: "Heat engine",
      to: "Entropy",
      kind: "depends-on",
      evidence: ["#2"],
    },
  ],
});

describe("buildConceptExtractSystem", () => {
  it("emits two blocks with cache_control on the source payload", () => {
    const blocks = buildConceptExtractSystem({
      source: { title: "Thermo", type: "pdf" },
      chunks: [
        { id: "c1", index: 0, text: "alpha", section: "Intro" },
        { id: "c2", index: 1, text: "beta", page: 12 },
      ],
      locale: "en",
    });
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.text).toContain("concept graph");
    expect(blocks[1]?.cache_control).toEqual({ type: "ephemeral" });
    expect(blocks[1]?.text).toContain("alpha");
    expect(blocks[1]?.text).toContain("section: Intro");
    expect(blocks[1]?.text).toContain("page: 12");
  });
});

describe("parseConceptExtractOutput", () => {
  it("parses a clean concepts + edges payload", () => {
    const r = parseConceptExtractOutput(SAMPLE_VALID);
    expect(r.concepts).toHaveLength(2);
    expect(r.edges).toHaveLength(1);
    expect(r.concepts[0]?.label).toBe("Entropy");
    expect(r.concepts[0]?.definition).toBe("Measure of disorder.");
    expect(r.edges[0]).toMatchObject({
      from: "Heat engine",
      to: "Entropy",
      kind: "depends-on",
    });
    expect(r.edges[0]?.evidence).toEqual(["#2"]);
  });

  it("strips markdown code fences and leading prose", () => {
    const noisy =
      "Here you go:\n```json\n" + SAMPLE_VALID + "\n```\n\nLet me know.";
    const r = parseConceptExtractOutput(noisy);
    expect(r.concepts).toHaveLength(2);
    expect(r.edges).toHaveLength(1);
  });

  it("drops concepts missing label or chunkRefs and silently coerces invalid kind", () => {
    const partial = JSON.stringify({
      concepts: [
        { label: "Good one", kind: "concept", chunkRefs: ["#0"] },
        // missing chunkRefs → drop
        { label: "Bare", kind: "term" },
        // empty chunkRefs → drop
        { label: "Empty refs", kind: "term", chunkRefs: [] },
        // missing label → drop
        { kind: "concept", chunkRefs: ["#1"] },
        // unknown kind → coerced to "concept"
        { label: "Mystery", kind: "alien", chunkRefs: ["#2"] },
      ],
      edges: [],
    });
    const r = parseConceptExtractOutput(partial);
    expect(r.concepts.map((c) => c.label)).toEqual(["Good one", "Mystery"]);
    expect(r.concepts[1]?.kind).toBe("concept");
  });

  it("drops invalid edges (missing endpoints, unknown kind, self-loops)", () => {
    const partial = JSON.stringify({
      concepts: [{ label: "A", kind: "concept", chunkRefs: ["#0"] }],
      edges: [
        // unknown kind → drop
        { from: "A", to: "B", kind: "wat" },
        // missing endpoint → drop
        { from: "A", kind: "is-a" },
        // self-loop (after normalization) → drop
        { from: "A", to: "a", kind: "related" },
        // valid → keep
        { from: "A", to: "B", kind: "is-a" },
      ],
    });
    const r = parseConceptExtractOutput(partial);
    expect(r.edges).toHaveLength(1);
    expect(r.edges[0]?.kind).toBe("is-a");
  });

  it("recovers when trailing chatter follows the JSON object", () => {
    const r = parseConceptExtractOutput(
      SAMPLE_VALID + "\n\nThis was fun!",
    );
    expect(r.concepts).toHaveLength(2);
  });

  it("throws when there's no JSON or both lists are empty", () => {
    expect(() => parseConceptExtractOutput("not json")).toThrow();
    expect(() =>
      parseConceptExtractOutput(JSON.stringify({ concepts: [], edges: [] })),
    ).toThrow(/no valid concepts/);
  });
});

describe("normalizeConceptLabel", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeConceptLabel("Heat-Engine!")).toBe("heat engine");
    expect(normalizeConceptLabel("  alpha  beta  ")).toBe("alpha beta");
    expect(normalizeConceptLabel("ENTROPY (S)")).toBe("entropy s");
  });

  it("NFKC-normalizes Unicode forms so accented letters survive", () => {
    expect(normalizeConceptLabel("café")).toBe("café");
    // Compatibility forms should normalize equally.
    const a = normalizeConceptLabel("ﬁnale"); // ligature
    const b = normalizeConceptLabel("finale");
    expect(a).toBe(b);
  });
});
