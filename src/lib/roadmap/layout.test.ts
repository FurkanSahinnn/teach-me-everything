import { describe, expect, it } from "vitest";
import {
  boundsForGraph,
  buildRoadmapLayoutGraph,
  runRoadmapLayout,
} from "./layout";
import type {
  RoadmapEdgeRecord,
  RoadmapNodeRecord,
} from "./types";

function node(id: string, parentId: string | null, depth: 0 | 1 | 2): RoadmapNodeRecord {
  return {
    id,
    roadmapId: "r1",
    parentId,
    depth,
    title: id,
    description: "",
    status: "todo",
    createdAt: 0,
    updatedAt: 0,
  };
}

function edge(from: string, to: string): RoadmapEdgeRecord {
  return {
    id: `e_${from}_${to}`,
    roadmapId: "r1",
    fromNodeId: from,
    toNodeId: to,
    createdAt: 0,
  };
}

function byId(graph: ReturnType<typeof runRoadmapLayout>, id: string) {
  const found = graph.nodes.find((n) => n.id === id);
  if (!found) throw new Error(`node ${id} missing`);
  return found;
}

describe("buildRoadmapLayoutGraph", () => {
  it("drops edges that reference missing endpoints", () => {
    const graph = buildRoadmapLayoutGraph(
      [node("a", null, 0), node("b", null, 0)],
      [edge("a", "b"), edge("a", "ghost"), edge("a", "a")],
    );
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toEqual([{ source: "a", target: "b" }]);
  });

  it("seeds positions from cached x/y when present", () => {
    const cached = { ...node("a", null, 0), x: 123, y: 45 };
    const graph = buildRoadmapLayoutGraph([cached], []);
    expect(graph.nodes[0]?.x).toBe(123);
    expect(graph.nodes[0]?.y).toBe(45);
  });
});

describe("runRoadmapLayout (layered)", () => {
  it("is deterministic for the same input (no seed needed)", () => {
    const build = (): ReturnType<typeof runRoadmapLayout> =>
      runRoadmapLayout(
        buildRoadmapLayoutGraph(
          [node("a", null, 0), node("b", null, 0), node("c", "a", 1)],
          [edge("a", "b"), edge("a", "c")],
        ),
      );
    const left = build();
    const right = build();
    for (let i = 0; i < left.nodes.length; i += 1) {
      expect(left.nodes[i]?.x).toBe(right.nodes[i]?.x);
      expect(left.nodes[i]?.y).toBe(right.nodes[i]?.y);
    }
  });

  it("returns finite coordinates for a single-node graph", () => {
    const graph = runRoadmapLayout(
      buildRoadmapLayoutGraph([node("solo", null, 0)], []),
    );
    expect(Number.isFinite(graph.nodes[0]?.x ?? NaN)).toBe(true);
    expect(Number.isFinite(graph.nodes[0]?.y ?? NaN)).toBe(true);
    expect(graph.nodes[0]?.layer).toBe(0);
  });

  it("stacks a prerequisite chain top→down (increasing layer + y)", () => {
    const graph = runRoadmapLayout(
      buildRoadmapLayoutGraph(
        [node("a", null, 0), node("b", null, 0), node("c", null, 0)],
        [edge("a", "b"), edge("b", "c")],
      ),
    );
    const a = byId(graph, "a");
    const b = byId(graph, "b");
    const c = byId(graph, "c");
    expect(a.layer).toBe(0);
    expect(b.layer).toBe(1);
    expect(c.layer).toBe(2);
    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(c.y);
  });

  it("places a subnode below its parent even with no explicit edge", () => {
    // Older roadmaps stored parentId but no parent→child edge. The layering
    // graph synthesizes one so the child still sits one layer down.
    const graph = runRoadmapLayout(
      buildRoadmapLayoutGraph(
        [node("p", null, 0), node("c", "p", 1)],
        [],
      ),
    );
    const p = byId(graph, "p");
    const c = byId(graph, "c");
    expect(p.layer).toBe(0);
    expect(c.layer).toBe(1);
    expect(c.y).toBeGreaterThan(p.y);
  });

  it("keeps a pinned node's cached position instead of auto-placing it", () => {
    const pinned: RoadmapNodeRecord = {
      ...node("a", null, 0),
      x: 999,
      y: 888,
      pinned: true,
    };
    const graph = runRoadmapLayout(
      buildRoadmapLayoutGraph([pinned, node("b", null, 0)], []),
    );
    const a = byId(graph, "a");
    const b = byId(graph, "b");
    // Pinned node keeps its cached coordinates exactly...
    expect(a.x).toBe(999);
    expect(a.y).toBe(888);
    expect(a.pinned).toBe(true);
    // ...while the un-pinned node still gets a finite auto position (and is
    // not dragged off to the pinned node's coordinates).
    expect(b.pinned).toBe(false);
    expect(Number.isFinite(b.x)).toBe(true);
    expect(Number.isFinite(b.y)).toBe(true);
    expect(b.x).not.toBe(999);
  });

  it("centres a layer's siblings around x = 0", () => {
    const graph = runRoadmapLayout(
      buildRoadmapLayoutGraph(
        [node("root", null, 0), node("a", null, 0), node("b", null, 0)],
        [edge("root", "a"), edge("root", "b")],
      ),
    );
    const a = byId(graph, "a");
    const b = byId(graph, "b");
    // two siblings on the same layer straddle the centre line
    expect(a.layer).toBe(1);
    expect(b.layer).toBe(1);
    expect(Math.sign(a.x)).not.toBe(Math.sign(b.x));
    expect(a.x + b.x).toBeCloseTo(0, 6);
  });
});

describe("boundsForGraph", () => {
  it("falls back to a default rect when the graph is empty", () => {
    const rect = boundsForGraph({ nodes: [], edges: [] });
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });

  it("includes padding around all nodes", () => {
    const graph = {
      nodes: [
        { id: "a", parentId: null, depth: 0 as const, title: "", status: "todo" as const, layer: 0, x: 0, y: 0, pinned: false, vx: 0, vy: 0 },
        { id: "b", parentId: null, depth: 0 as const, title: "", status: "todo" as const, layer: 0, x: 100, y: 50, pinned: false, vx: 0, vy: 0 },
      ],
      edges: [],
    };
    const rect = boundsForGraph(graph, 20);
    expect(rect.x).toBe(-20);
    expect(rect.y).toBe(-20);
    expect(rect.width).toBe(140);
    expect(rect.height).toBe(90);
  });
});
