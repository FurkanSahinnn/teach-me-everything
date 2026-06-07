import { describe, it, expect } from "vitest";
import {
  dedupeRawConcepts,
  mergeRawEdges,
  type DedupedConcept,
} from "../concept-extraction";
import type { RawConcept, RawEdge } from "../prompts/concept-extract";

describe("dedupeRawConcepts", () => {
  it("returns an empty list for empty input", () => {
    expect(dedupeRawConcepts([])).toEqual([]);
  });

  it("collapses synonyms by normalized label and unions chunkRefs", () => {
    const raw: RawConcept[] = [
      { label: "Entropy", kind: "concept", chunkRefs: ["#0"] },
      { label: "ENTROPY!", kind: "concept", chunkRefs: ["#3"] },
      { label: "entropy", kind: "concept", chunkRefs: ["#0", "#5"] },
    ];
    const out = dedupeRawConcepts(raw);
    expect(out).toHaveLength(1);
    expect(out[0]?.label).toBe("Entropy"); // first display label wins
    expect(out[0]?.chunkRefs).toEqual(["#0", "#3", "#5"]); // dedup + order
  });

  it("upgrades generic 'concept' kind when a later record specializes it", () => {
    const raw: RawConcept[] = [
      { label: "Carnot", kind: "concept", chunkRefs: ["#0"] },
      { label: "Carnot", kind: "person", chunkRefs: ["#2"] },
    ];
    const out = dedupeRawConcepts(raw);
    expect(out[0]?.kind).toBe("person");
  });

  it("keeps the first non-empty definition wins", () => {
    const raw: RawConcept[] = [
      { label: "Heat", kind: "concept", chunkRefs: ["#0"] },
      {
        label: "heat",
        kind: "concept",
        chunkRefs: ["#1"],
        definition: "Energy in transit.",
      },
      {
        label: "Heat",
        kind: "concept",
        chunkRefs: ["#2"],
        definition: "Different definition.",
      },
    ];
    const out = dedupeRawConcepts(raw);
    expect(out[0]?.definition).toBe("Energy in transit.");
  });

  it("skips entries whose normalized label is empty", () => {
    const raw: RawConcept[] = [
      { label: "  !!!  ", kind: "concept", chunkRefs: ["#0"] },
      { label: "Real", kind: "concept", chunkRefs: ["#1"] },
    ];
    const out = dedupeRawConcepts(raw);
    expect(out).toHaveLength(1);
    expect(out[0]?.label).toBe("Real");
  });

  it("is order-preserving for distinct concepts", () => {
    const raw: RawConcept[] = [
      { label: "B", kind: "concept", chunkRefs: ["#0"] },
      { label: "A", kind: "concept", chunkRefs: ["#1"] },
      { label: "C", kind: "concept", chunkRefs: ["#2"] },
    ];
    const out = dedupeRawConcepts(raw);
    expect(out.map((c) => c.label)).toEqual(["B", "A", "C"]);
  });
});

describe("mergeRawEdges", () => {
  function concept(id: string, label: string): DedupedConcept {
    return {
      id,
      label,
      labelNorm: label.toLowerCase(),
      kind: "concept",
      chunkRefs: [],
    };
  }

  it("drops edges whose endpoint isn't in the deduped concept map", () => {
    const concepts = [concept("c1", "A"), concept("c2", "B")];
    const raw: RawEdge[] = [
      { from: "A", to: "Ghost", kind: "is-a" },
      { from: "Ghost", to: "B", kind: "related" },
      { from: "A", to: "B", kind: "is-a" },
    ];
    const out = mergeRawEdges(raw, concepts);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ fromId: "c1", toId: "c2", kind: "is-a" });
  });

  it("merges duplicate triples and unions evidence", () => {
    const concepts = [concept("c1", "A"), concept("c2", "B")];
    const raw: RawEdge[] = [
      { from: "A", to: "B", kind: "is-a", evidence: ["#0"] },
      { from: "A", to: "B", kind: "is-a", evidence: ["#1", "#0"] },
      { from: "A", to: "B", kind: "is-a", evidence: ["#3"] },
    ];
    const out = mergeRawEdges(raw, concepts);
    expect(out).toHaveLength(1);
    expect(out[0]?.evidenceChunkIds).toEqual(["#0", "#1", "#3"]);
  });

  it("keeps edges with the same endpoints but different kinds separate", () => {
    const concepts = [concept("c1", "A"), concept("c2", "B")];
    const raw: RawEdge[] = [
      { from: "A", to: "B", kind: "is-a" },
      { from: "A", to: "B", kind: "related" },
    ];
    const out = mergeRawEdges(raw, concepts);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.kind).sort()).toEqual(["is-a", "related"]);
  });

  it("drops self-loops even when endpoints resolve to the same id", () => {
    const concepts = [concept("c1", "A")];
    const raw: RawEdge[] = [{ from: "A", to: "a", kind: "related" }];
    const out = mergeRawEdges(raw, concepts);
    expect(out).toEqual([]);
  });
});
