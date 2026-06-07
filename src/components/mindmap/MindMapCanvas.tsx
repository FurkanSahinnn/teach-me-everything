"use client";

// Canvas-based mind map view. The layout (`runForceLayout`) populates
// (x, y) once per graph change; the canvas re-renders on every pointer
// interaction so dragging stays smooth without a per-frame physics loop.
//
// Click empty space → clear selection. Click a node → onSelect(id).
// Wheel → zoom. Drag bg → pan. Drag a node → fix its position.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildLayoutGraph,
  runForceLayout,
  type LayoutGraph,
  type LayoutNode,
} from "@/lib/concepts/layout";
import type {
  ConceptEdgeKind,
  ConceptEdgeRecord,
  ConceptKind,
  ConceptRecord,
} from "@/lib/concepts/types";

const NODE_RADIUS = 20;
const NODE_FILL: Record<ConceptKind, string> = {
  concept: "#E8E2D6", // paper-3 / accent-soft tones
  term: "#D9D2C2",
  person: "#F0C9A6",
  place: "#C7DBC8",
  method: "#C8D4E8",
  event: "#E8C8C8",
  work: "#D6C8E8",
};

type EdgeStyle = {
  color: string;
  width: number;
  dash: number[];
};

const EDGE_STYLE: Record<ConceptEdgeKind, EdgeStyle> = {
  "is-a": { color: "#3a3a3a", width: 2, dash: [] },
  "part-of": { color: "#3a6663", width: 1.5, dash: [] },
  related: { color: "#9a9a9a", width: 1, dash: [4, 3] },
  "depends-on": { color: "#6a4a8a", width: 1.5, dash: [1, 3] },
};

type Props = {
  concepts: ConceptRecord[];
  edges: ConceptEdgeRecord[];
  selectedId?: string;
  onSelect: (id: string | null) => void;
  width: number;
  height: number;
};

type Viewport = { scale: number; tx: number; ty: number };

export function MindMapCanvas({
  concepts,
  edges,
  selectedId,
  onSelect,
  width,
  height,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const graphRef = useRef<LayoutGraph | null>(null);
  const [viewport, setViewport] = useState<Viewport>({
    scale: 1,
    tx: 0,
    ty: 0,
  });
  const draggingRef = useRef<
    | { kind: "none" }
    | { kind: "pan"; lastX: number; lastY: number }
    | { kind: "node"; node: LayoutNode; offsetX: number; offsetY: number }
  >({ kind: "none" });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const graph = graphRef.current;
    if (!canvas || !graph) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(viewport.tx, viewport.ty);
    ctx.scale(viewport.scale, viewport.scale);

    // Edges first so nodes paint on top.
    for (const link of graph.links) {
      const a = graph.nodes.find((n) => n.id === link.source);
      const b = graph.nodes.find((n) => n.id === link.target);
      if (!a || !b) continue;
      const style = EDGE_STYLE[link.kind];
      ctx.strokeStyle = style.color;
      ctx.lineWidth = style.width;
      ctx.setLineDash(style.dash);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Nodes.
    ctx.font =
      "12px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const node of graph.nodes) {
      const isSelected = node.id === selectedId;
      ctx.fillStyle = NODE_FILL[node.kind] ?? NODE_FILL.concept;
      ctx.strokeStyle = isSelected ? "#B8601C" : "#3a3a3a";
      ctx.lineWidth = isSelected ? 3 : 1;
      ctx.beginPath();
      ctx.arc(node.x, node.y, NODE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#1a1a1a";
      const truncated =
        node.label.length > 22 ? node.label.slice(0, 21) + "…" : node.label;
      ctx.fillText(truncated, node.x, node.y + NODE_RADIUS + 4);
    }

    ctx.restore();
  }, [viewport, width, height, selectedId]);

  // Re-layout whenever the source set changes. The seed is keyed on the id
  // list so adding/removing concepts doesn't shuffle existing positions
  // randomly between sessions.
  useEffect(() => {
    const seed = hashIds(concepts.map((c) => c.id));
    const built = buildLayoutGraph(concepts, edges);
    graphRef.current = runForceLayout(built, {
      width,
      height,
      iterations: 250,
      seed,
    });
    draw();
  }, [concepts, edges, width, height, draw]);

  useEffect(() => {
    draw();
  }, [draw]);

  const screenToWorld = useCallback(
    (sx: number, sy: number): { x: number; y: number } => {
      return {
        x: (sx - viewport.tx) / viewport.scale,
        y: (sy - viewport.ty) / viewport.scale,
      };
    },
    [viewport],
  );

  const hitNode = useCallback(
    (sx: number, sy: number): LayoutNode | null => {
      const graph = graphRef.current;
      if (!graph) return null;
      const w = screenToWorld(sx, sy);
      // Reverse iterate so newer/upper nodes win when overlapping.
      for (let i = graph.nodes.length - 1; i >= 0; i -= 1) {
        const n = graph.nodes[i];
        if (!n) continue;
        const dx = n.x - w.x;
        const dy = n.y - w.y;
        if (dx * dx + dy * dy <= NODE_RADIUS * NODE_RADIUS) return n;
      }
      return null;
    },
    [screenToWorld],
  );

  function localXY(e: React.PointerEvent<HTMLCanvasElement>): {
    sx: number;
    sy: number;
  } {
    const rect = e.currentTarget.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>): void {
    e.currentTarget.setPointerCapture(e.pointerId);
    const { sx, sy } = localXY(e);
    const node = hitNode(sx, sy);
    if (node) {
      const w = screenToWorld(sx, sy);
      draggingRef.current = {
        kind: "node",
        node,
        offsetX: node.x - w.x,
        offsetY: node.y - w.y,
      };
      node.fixed = true;
    } else {
      draggingRef.current = { kind: "pan", lastX: sx, lastY: sy };
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>): void {
    const drag = draggingRef.current;
    if (drag.kind === "none") return;
    const { sx, sy } = localXY(e);
    if (drag.kind === "pan") {
      setViewport((v) => ({
        ...v,
        tx: v.tx + (sx - drag.lastX),
        ty: v.ty + (sy - drag.lastY),
      }));
      draggingRef.current = { kind: "pan", lastX: sx, lastY: sy };
    } else if (drag.kind === "node") {
      const w = screenToWorld(sx, sy);
      drag.node.x = w.x + drag.offsetX;
      drag.node.y = w.y + drag.offsetY;
      draw();
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>): void {
    const drag = draggingRef.current;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (drag.kind === "node") {
      // A short tap (no movement) counts as click → select; longer drags
      // already moved the node so we don't fire onSelect to avoid hiding the
      // inspector while the user reorganises the layout.
      const { sx, sy } = localXY(e);
      const hit = hitNode(sx, sy);
      if (hit && hit.id === drag.node.id) {
        onSelect(drag.node.id);
      }
    } else if (drag.kind === "pan") {
      // Tap on empty bg with no actual pan → deselect.
      const { sx, sy } = localXY(e);
      if (Math.abs(sx - drag.lastX) < 2 && Math.abs(sy - drag.lastY) < 2) {
        onSelect(null);
      }
    }
    draggingRef.current = { kind: "none" };
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>): void {
    e.preventDefault();
    const { sx, sy } = localXY(
      e as unknown as React.PointerEvent<HTMLCanvasElement>,
    );
    const factor = Math.exp(-e.deltaY * 0.001);
    const nextScale = Math.max(0.3, Math.min(3, viewport.scale * factor));
    // Keep the zoom centred on the cursor.
    const wx = (sx - viewport.tx) / viewport.scale;
    const wy = (sy - viewport.ty) / viewport.scale;
    setViewport({
      scale: nextScale,
      tx: sx - wx * nextScale,
      ty: sy - wy * nextScale,
    });
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, touchAction: "none" }}
      className="block cursor-grab"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
    />
  );
}

function hashIds(ids: string[]): number {
  let h = 2166136261;
  const joined = ids.join("|");
  for (let i = 0; i < joined.length; i += 1) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
