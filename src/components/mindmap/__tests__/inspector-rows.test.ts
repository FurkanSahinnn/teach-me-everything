import { describe, expect, it } from "vitest";
import { inspectorRows } from "../ConceptInspector";
import type {
  ConceptEdgeRecord,
  ConceptRecord,
} from "@/lib/concepts/types";

function concept(id: string, label: string): ConceptRecord {
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
  kind: ConceptEdgeRecord["kind"],
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

describe("inspectorRows", () => {
  const concepts = [
    concept("a", "Alpha"),
    concept("b", "Beta"),
    concept("c", "Gamma"),
  ];
  const edges = [
    edge("a", "b", "is-a"),
    edge("c", "a", "related"),
    edge("a", "c", "depends-on"),
  ];

  it("returns one row per neighbour kind, with neighbour labels resolved", () => {
    const rows = inspectorRows("a", concepts, edges);
    const byKind = new Map(rows.map((r) => [r.kind, r]));
    expect(byKind.get("is-a")?.neighbors).toEqual([{ id: "b", label: "Beta" }]);
    expect(byKind.get("related")?.neighbors).toEqual([
      { id: "c", label: "Gamma" },
    ]);
    expect(byKind.get("depends-on")?.neighbors).toEqual([
      { id: "c", label: "Gamma" },
    ]);
  });

  it("returns an empty list for an isolated concept", () => {
    const isolated = [...concepts, concept("z", "Zeta")];
    const rows = inspectorRows("z", isolated, edges);
    expect(rows).toEqual([]);
  });

  it("falls back to the id when the neighbour label is missing", () => {
    const rows = inspectorRows(
      "a",
      // omit "b" so its label can't be resolved
      [concept("a", "Alpha"), concept("c", "Gamma")],
      edges,
    );
    const isA = rows.find((r) => r.kind === "is-a");
    expect(isA?.neighbors).toEqual([{ id: "b", label: "b" }]);
  });

  it("dedupes neighbours when multiple edges of the same kind connect them", () => {
    const dup = [
      ...edges,
      edge("a", "b", "is-a"), // duplicate kind+endpoint
    ];
    const rows = inspectorRows("a", concepts, dup);
    const isA = rows.find((r) => r.kind === "is-a");
    expect(isA?.neighbors).toEqual([{ id: "b", label: "Beta" }]);
  });
});
