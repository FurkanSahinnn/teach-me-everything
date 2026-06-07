// Pure layout for the Mind Map. Self-contained mini force-sim — no d3-force
// dependency so the bundle stays slim and the test suite can pin exact node
// positions via a seeded RNG. The page calls `runForceLayout` once per graph
// change and renders the resulting (x, y) tuples on a 2D canvas.

import type {
  ConceptEdgeKind,
  ConceptEdgeRecord,
  ConceptKind,
  ConceptRecord,
} from "@/lib/concepts/types";

export type LayoutNode = {
  id: string;
  label: string;
  kind: ConceptKind;
  // Positions are mutable — `runForceLayout` writes into the same node objects
  // each iteration so the caller can re-run incrementally.
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed?: boolean;
};

export type LayoutLink = {
  source: string;
  target: string;
  kind: ConceptEdgeKind;
};

export type LayoutGraph = {
  nodes: LayoutNode[];
  links: LayoutLink[];
};

export type LayoutOpts = {
  width: number;
  height: number;
  iterations?: number;
  seed?: number;
  // Repulsive force between every pair of nodes. Larger = more spread.
  charge?: number;
  // Spring rest length for connected nodes.
  linkDistance?: number;
  // Stiffness of the spring (0..1). Larger = links pull harder.
  linkStrength?: number;
};

const DEFAULT_OPTS: Required<Omit<LayoutOpts, "seed">> = {
  width: 800,
  height: 600,
  iterations: 200,
  charge: -300,
  linkDistance: 90,
  linkStrength: 0.05,
};

/**
 * Seeded PRNG (mulberry32). Same seed → same sequence on every run; tests
 * pin layout positions by passing a fixed seed. Pure.
 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a layout-ready graph from raw concept + edge records. Links whose
 * endpoint isn't in the concept set are dropped (the user could have edited
 * the graph manually before this runs). Pure.
 */
export function buildLayoutGraph(
  concepts: ConceptRecord[],
  edges: ConceptEdgeRecord[],
): LayoutGraph {
  const ids = new Set(concepts.map((c) => c.id));
  const nodes: LayoutNode[] = concepts.map((c) => ({
    id: c.id,
    label: c.label,
    kind: c.kind,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
  }));
  const links: LayoutLink[] = [];
  for (const e of edges) {
    if (!ids.has(e.fromId) || !ids.has(e.toId)) continue;
    if (e.fromId === e.toId) continue;
    links.push({ source: e.fromId, target: e.toId, kind: e.kind });
  }
  return { nodes, links };
}

/**
 * Initialize node positions in a circle around the canvas centre. Slightly
 * jittered so co-located nodes don't degenerate to identical positions
 * (which would divide-by-zero in the repulsion step).
 */
function seedPositions(
  nodes: LayoutNode[],
  width: number,
  height: number,
  rng: () => number,
): void {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 3;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (!node) continue;
    const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
    node.x = cx + Math.cos(angle) * r + (rng() - 0.5) * 4;
    node.y = cy + Math.sin(angle) * r + (rng() - 0.5) * 4;
    node.vx = 0;
    node.vy = 0;
  }
}

/**
 * Run a fixed-iteration force simulation. Charge force pushes every pair
 * of nodes apart (~1/r²); spring force pulls linked pairs toward
 * `linkDistance`; a soft centring force keeps the graph from drifting off
 * the canvas. Mutates `graph.nodes` in place and returns the same graph
 * for chaining. Pure (deterministic given the same seed).
 */
export function runForceLayout(
  graph: LayoutGraph,
  opts: LayoutOpts,
): LayoutGraph {
  const merged = { ...DEFAULT_OPTS, ...opts };
  const rng = mulberry32(opts.seed ?? 1);
  seedPositions(graph.nodes, merged.width, merged.height, rng);

  const cx = merged.width / 2;
  const cy = merged.height / 2;
  const linkIndex = new Map<string, number>();
  graph.nodes.forEach((n, i) => linkIndex.set(n.id, i));

  for (let iter = 0; iter < merged.iterations; iter += 1) {
    // Charge (repulsion). O(n²) — fine up to the documented 500-node budget.
    for (let i = 0; i < graph.nodes.length; i += 1) {
      const a = graph.nodes[i];
      if (!a) continue;
      for (let j = i + 1; j < graph.nodes.length; j += 1) {
        const b = graph.nodes[j];
        if (!b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy + 0.01;
        // Repulsion magnitude: charge / d² then split between the two nodes.
        const mag = merged.charge / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * mag;
        const fy = (dy / d) * mag;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // Spring (attraction along edges).
    for (const link of graph.links) {
      const ai = linkIndex.get(link.source);
      const bi = linkIndex.get(link.target);
      if (ai === undefined || bi === undefined) continue;
      const a = graph.nodes[ai];
      const b = graph.nodes[bi];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const delta = d - merged.linkDistance;
      const mag = delta * merged.linkStrength;
      const fx = (dx / d) * mag;
      const fy = (dy / d) * mag;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // Soft centring + velocity decay + position update.
    for (const node of graph.nodes) {
      if (node.fixed) {
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      // Gentle pull toward centre so disconnected components don't escape.
      node.vx += (cx - node.x) * 0.01;
      node.vy += (cy - node.y) * 0.01;
      // Velocity decay (Verlet-style damping). Keeps the system from oscillating.
      node.vx *= 0.7;
      node.vy *= 0.7;
      node.x += node.vx;
      node.y += node.vy;
    }
  }

  return graph;
}

/**
 * Walk a node's neighbours via the link list. Used by both the inspector
 * and tests. Pure.
 */
export function neighborsForConcept(
  conceptId: string,
  links: LayoutLink[],
): { neighborId: string; kind: ConceptEdgeKind; direction: "out" | "in" }[] {
  const out: {
    neighborId: string;
    kind: ConceptEdgeKind;
    direction: "out" | "in";
  }[] = [];
  for (const l of links) {
    if (l.source === conceptId) {
      out.push({ neighborId: l.target, kind: l.kind, direction: "out" });
    } else if (l.target === conceptId) {
      out.push({ neighborId: l.source, kind: l.kind, direction: "in" });
    }
  }
  return out;
}

/**
 * Group a concept's neighbours by edge kind for the inspector list. Pure.
 * Map keys are inserted in the order edges first appear so the inspector
 * shows the most-recently-traversed kind first.
 */
export function groupNeighborsByKind(
  conceptId: string,
  links: LayoutLink[],
): Map<ConceptEdgeKind, string[]> {
  const map = new Map<ConceptEdgeKind, string[]>();
  for (const n of neighborsForConcept(conceptId, links)) {
    const list = map.get(n.kind) ?? [];
    if (!list.includes(n.neighborId)) list.push(n.neighborId);
    if (!map.has(n.kind)) map.set(n.kind, list);
  }
  return map;
}
