import { describe, expect, it } from "vitest";
import {
  buildLayoutGraph,
  groupNeighborsByKind,
  mulberry32,
  neighborsForConcept,
  runForceLayout,
  type LayoutLink,
} from "./layout";
import type {
  ConceptEdgeRecord,
  ConceptRecord,
} from "./types";

function concept(id: string, label = id): ConceptRecord {
  return {
    id,
    workspaceId: "w",
    label,
    labelNorm: label.toLowerCase(),
    kind: "concept",
    sourceIds: [],
    chunkRefs: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function edge(
  fromId: string,
  toId: string,
  kind: ConceptEdgeRecord["kind"] = "related",
): ConceptEdgeRecord {
  return {
    id: `${fromId}-${toId}-${kind}`,
    workspaceId: "w",
    fromId,
    toId,
    kind,
    evidenceChunkIds: [],
    createdAt: 0,
  };
}

describe("mulberry32", () => {
  it("is deterministic given the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });
});

describe("buildLayoutGraph", () => {
  it("drops edges whose endpoints aren't in the concept set", () => {
    const concepts = [concept("a"), concept("b")];
    const edges = [edge("a", "b"), edge("a", "ghost"), edge("ghost", "b")];
    const g = buildLayoutGraph(concepts, edges);
    expect(g.nodes).toHaveLength(2);
    expect(g.links).toHaveLength(1);
    expect(g.links[0]).toMatchObject({ source: "a", target: "b" });
  });

  it("drops self-loops", () => {
    const concepts = [concept("a")];
    const g = buildLayoutGraph(concepts, [edge("a", "a")]);
    expect(g.links).toEqual([]);
  });
});

describe("runForceLayout", () => {
  it("converges to finite, bounded positions for a small graph", () => {
    const concepts = [concept("a"), concept("b"), concept("c")];
    const edges = [edge("a", "b"), edge("b", "c")];
    const g = buildLayoutGraph(concepts, edges);
    const out = runForceLayout(g, {
      width: 600,
      height: 400,
      iterations: 100,
      seed: 7,
    });
    for (const n of out.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      // After centring, no node should drift more than width/2 from centre.
      expect(Math.abs(n.x - 300)).toBeLessThan(600);
      expect(Math.abs(n.y - 200)).toBeLessThan(400);
    }
  });

  it("is deterministic across runs given the same seed", () => {
    const concepts = [concept("a"), concept("b"), concept("c")];
    const edges = [edge("a", "b"), edge("b", "c"), edge("a", "c")];
    const g1 = buildLayoutGraph(concepts, edges);
    const g2 = buildLayoutGraph(concepts, edges);
    runForceLayout(g1, { width: 600, height: 400, iterations: 50, seed: 99 });
    runForceLayout(g2, { width: 600, height: 400, iterations: 50, seed: 99 });
    g1.nodes.forEach((n, i) => {
      const m = g2.nodes[i];
      expect(m).toBeDefined();
      expect(n.x).toBeCloseTo(m!.x, 6);
      expect(n.y).toBeCloseTo(m!.y, 6);
    });
  });
});

describe("neighborsForConcept + groupNeighborsByKind", () => {
  const links: LayoutLink[] = [
    { source: "a", target: "b", kind: "is-a" },
    { source: "c", target: "a", kind: "related" },
    { source: "a", target: "d", kind: "related" },
  ];

  it("returns directed-aware neighbours for the selected node", () => {
    const ns = neighborsForConcept("a", links);
    expect(ns).toHaveLength(3);
    const labels = ns.map((n) => `${n.direction}:${n.neighborId}:${n.kind}`);
    expect(labels).toEqual(
      expect.arrayContaining([
        "out:b:is-a",
        "in:c:related",
        "out:d:related",
      ]),
    );
  });

  it("groups neighbours by edge kind, deduping repeats", () => {
    const grouped = groupNeighborsByKind("a", links);
    expect(Array.from(grouped.keys()).sort()).toEqual(["is-a", "related"]);
    expect(grouped.get("is-a")).toEqual(["b"]);
    expect(grouped.get("related")?.sort()).toEqual(["c", "d"]);
  });

  it("returns an empty map for an isolated concept", () => {
    expect(groupNeighborsByKind("ghost", links).size).toBe(0);
    expect(neighborsForConcept("ghost", links)).toEqual([]);
  });
});
