"use client";

import { Check, Maximize2, RotateCcw } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  boundsForGraph,
  buildRoadmapLayoutGraph,
  runRoadmapLayout,
  type RoadmapLayoutNode,
} from "@/lib/roadmap/layout";
import type {
  RoadmapEdgeRecord,
  RoadmapNodeRecord,
} from "@/lib/roadmap/types";
import { useLocalePick } from "@/i18n/IntlProvider";
import { cn } from "@/lib/utils/cn";

type Props = {
  nodes: RoadmapNodeRecord[];
  edges: RoadmapEdgeRecord[];
  selectedId: string | null;
  onSelectNode: (id: string | null) => void;
  // Node ids that count as complete via activity (linked deck fully learned),
  // in addition to the manual `status === "done"`. Drives the dim/checkmark
  // so the canvas matches the progress bar.
  completeIds?: ReadonlySet<string>;
  // Persist a hand-dragged node position. Omitted => drag is disabled.
  onMoveNode?: (id: string, x: number, y: number) => void;
  // Clear every hand-placed position (revert to auto layout).
  onResetLayout?: () => void;
};

type ViewBox = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };

// Card footprint per depth (SVG units). Rectangular so multi-word titles wrap
// to two lines and stay inside the node instead of spilling over a circle.
const NODE_BOX: Record<0 | 1 | 2, { w: number; h: number }> = {
  0: { w: 200, h: 60 },
  1: { w: 176, h: 52 },
  2: { w: 156, h: 46 },
};

const FONT_SIZE: Record<0 | 1 | 2, number> = {
  0: 13,
  1: 11.5,
  2: 10.5,
};

// Gap added to the target box when anchoring an arrow so the head doesn't
// touch the card border.
const ARROW_GAP = 7;

// Viewport padding — must exceed the widest node half-width (100) so cards on
// the far edges don't clip against the SVG bounds.
const VIEW_PAD = 120;

// Zoom range relative to the auto-fit view: 0.25 = zoomed in 4×, 4 = out 4×.
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

// Pixels of pointer travel before a press is treated as a drag rather than a
// click/tap (matches the pan threshold).
const DRAG_THRESHOLD = 3;

export function RoadmapCanvas({
  nodes,
  edges,
  selectedId,
  onSelectNode,
  completeIds,
  onMoveNode,
  onResetLayout,
}: Props) {
  const pick = useLocalePick();
  const svgRef = useRef<SVGSVGElement>(null);

  // Memoized so a drag (which only bumps dragPos) doesn't re-run the layered
  // layout every pointer frame — node/edge identity is what matters here.
  const layout = useMemo(
    () =>
      nodes.length === 0
        ? null
        : runRoadmapLayout(buildRoadmapLayoutGraph(nodes, edges)),
    [nodes, edges],
  );

  const base = useMemo(
    () =>
      layout
        ? boundsForGraph(layout, VIEW_PAD)
        : { x: 0, y: 0, width: 600, height: 400 },
    [layout],
  );

  // Structural signature: re-fit the view only when the node set / edge count
  // changes — a drag or a status toggle keeps the user's current pan/zoom.
  const sig = useMemo(
    () => `${nodes.map((n) => n.id).join(",")}|${edges.length}`,
    [nodes, edges],
  );

  const [view, setView] = useState<ViewBox | null>(null);
  const [fitKey, setFitKey] = useState<string | null>(null);
  // Live positions for nodes mid-drag, plus a "previous nodes" marker so we can
  // drop those overrides the moment a fresh `nodes` array settles (a DB write
  // landed) and let the persisted/auto coordinates take over.
  const [dragPos, setDragPos] = useState<Record<string, Point>>({});
  const [prevNodes, setPrevNodes] = useState(nodes);

  // Render-phase state adjustment (React's documented "adjust state when a prop
  // changes" pattern) — avoids a setState-in-effect cascade and re-fits/clears
  // exactly when the relevant input changes.
  if (prevNodes !== nodes) {
    setPrevNodes(nodes);
    if (Object.keys(dragPos).length > 0) setDragPos({});
  }
  if (fitKey !== sig) {
    setFitKey(sig);
    setView({ x: base.x, y: base.y, w: base.width, h: base.height });
  }

  // Wheel zoom toward the cursor. Attached non-passively so preventDefault
  // actually stops the page from scrolling.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      setView((v) => {
        if (!v) return v;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return v;
        const mx = (e.clientX - rect.left) / rect.width;
        const my = (e.clientY - rect.top) / rect.height;
        const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
        const minW = base.width * MIN_ZOOM;
        const maxW = base.width * MAX_ZOOM;
        const newW = Math.min(maxW, Math.max(minW, v.w * factor));
        const newH = v.h * (newW / v.w);
        const cursorX = v.x + mx * v.w;
        const cursorY = v.y + my * v.h;
        return {
          x: cursorX - mx * newW,
          y: cursorY - my * newH,
          w: newW,
          h: newH,
        };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [base.width]);

  // Background pan. `moved` distinguishes a pan from a click (which deselects).
  const pan = useRef<{
    startX: number;
    startY: number;
    viewX: number;
    viewY: number;
    moved: boolean;
  } | null>(null);

  // Active single-node drag. Pointer capture lives on the node element, so the
  // node's own move/up handlers drive this — far more reliable than capturing
  // on the SVG when the press started on a child element.
  const drag = useRef<{
    id: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Convert a screen-pixel delta to SVG units. preserveAspectRatio
  // "xMidYMid meet" scales the viewBox UNIFORMLY to fit (letterboxing the
  // axis with spare room), so the SAME units-per-pixel applies to both axes —
  // it's the larger of the two ratios. Using the per-axis ratio (as before)
  // made a dragged node lag the cursor whenever the graph and the canvas had
  // different aspect ratios.
  function svgDelta(dxPx: number, dyPx: number, v: ViewBox): Point | null {
    const el = svgRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const unitsPerPixel = Math.max(v.w / rect.width, v.h / rect.height);
    return { x: dxPx * unitsPerPixel, y: dyPx * unitsPerPixel };
  }

  function onNodeDragStart(node: RoadmapLayoutNode, cx: number, cy: number): void {
    if (!view) return;
    const live = dragPos[node.id];
    drag.current = {
      id: node.id,
      startX: cx,
      startY: cy,
      origX: live ? live.x : node.x,
      origY: live ? live.y : node.y,
      moved: false,
    };
    setDraggingId(node.id);
  }

  function onNodeDragMove(cx: number, cy: number): void {
    const d = drag.current;
    if (!d || !view) return;
    if (Math.abs(cx - d.startX) + Math.abs(cy - d.startY) > DRAG_THRESHOLD) {
      d.moved = true;
    }
    const delta = svgDelta(cx - d.startX, cy - d.startY, view);
    if (!delta) return;
    setDragPos((prev) => ({
      ...prev,
      [d.id]: { x: d.origX + delta.x, y: d.origY + delta.y },
    }));
  }

  function onNodeDragEnd(cx: number, cy: number): void {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDraggingId(null);
    if (!d.moved) {
      // A press that didn't travel = select the node.
      onSelectNode(d.id);
      return;
    }
    if (!view) return;
    const delta = svgDelta(cx - d.startX, cy - d.startY, view);
    if (!delta) return;
    const x = d.origX + delta.x;
    const y = d.origY + delta.y;
    setDragPos((prev) => ({ ...prev, [d.id]: { x, y } }));
    onMoveNode?.(d.id, x, y);
  }

  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>): void {
    if (!view) return;
    pan.current = {
      startX: e.clientX,
      startY: e.clientY,
      viewX: view.x,
      viewY: view.y,
      moved: false,
    };
    svgRef.current?.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>): void {
    const ps = pan.current;
    const el = svgRef.current;
    if (!ps || !el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    if (Math.abs(e.clientX - ps.startX) + Math.abs(e.clientY - ps.startY) > DRAG_THRESHOLD) {
      ps.moved = true;
    }
    setView((v) => {
      if (!v) return v;
      const unitsPerPixel = Math.max(v.w / rect.width, v.h / rect.height);
      const dx = (e.clientX - ps.startX) * unitsPerPixel;
      const dy = (e.clientY - ps.startY) * unitsPerPixel;
      return { ...v, x: ps.viewX - dx, y: ps.viewY - dy };
    });
  }
  function onPointerUp(e: ReactPointerEvent<SVGSVGElement>): void {
    const ps = pan.current;
    pan.current = null;
    svgRef.current?.releasePointerCapture?.(e.pointerId);
    // A click that didn't drag on the background = deselect.
    if (ps && !ps.moved) onSelectNode(null);
  }

  function fit(): void {
    setView({ x: base.x, y: base.y, w: base.width, h: base.height });
  }

  if (!layout || !view) {
    return (
      <div className="flex h-full w-full items-center justify-center text-[13px] text-ink-3">
        —
      </div>
    );
  }

  // Merge live drag positions over the layout so both the dragged node and the
  // edges attached to it follow the pointer in real time.
  const liveNodes = layout.nodes.map((n) => {
    const o = dragPos[n.id];
    return o ? { ...n, x: o.x, y: o.y } : n;
  });
  const nodeIndex = new Map<string, RoadmapLayoutNode>();
  for (const n of liveNodes) nodeIndex.set(n.id, n);

  // Entry points = top-level nodes with no prerequisite pointing at them. These
  // get a "Başla" badge so the reader knows exactly where to start.
  const hasIncoming = new Set(layout.edges.map((e) => e.target));
  const rootIds = new Set(
    liveNodes
      .filter((n) => n.parentId === null && !hasIncoming.has(n.id))
      .map((n) => n.id),
  );
  const startLabel = pick("Başla", "Start");

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        role="img"
        aria-label={pick("Roadmap grafiği", "Roadmap graph")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <defs>
          <marker
            id="rmp-arrowhead"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-rule-strong" />
          </marker>
          <marker
            id="rmp-arrowhead-on"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6.5"
            markerHeight="6.5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-accent" />
          </marker>
        </defs>
        <g>
          {layout.edges.map((e) => {
            const from = nodeIndex.get(e.source);
            const to = nodeIndex.get(e.target);
            if (!from || !to) return null;
            const on =
              selectedId != null &&
              (e.source === selectedId || e.target === selectedId);
            const dimmed = selectedId != null && !on;
            return (
              <path
                key={`${e.source}-${e.target}`}
                d={edgePath(from, to)}
                fill="none"
                className={on ? "stroke-accent" : "stroke-rule-strong"}
                strokeWidth={on ? 2.1 : 1.4}
                style={{ opacity: dimmed ? 0.22 : 1 }}
                markerEnd={
                  on ? "url(#rmp-arrowhead-on)" : "url(#rmp-arrowhead)"
                }
              />
            );
          })}
        </g>
        <g>
          {liveNodes.map((n) => (
            <NodeMark
              key={n.id}
              node={n}
              selected={n.id === selectedId}
              dimmed={selectedId != null && n.id !== selectedId}
              dragging={n.id === draggingId}
              done={n.status === "done" || (completeIds?.has(n.id) ?? false)}
              isRoot={rootIds.has(n.id)}
              startLabel={startLabel}
              draggable={Boolean(onMoveNode)}
              onDragStart={onNodeDragStart}
              onDragMove={onNodeDragMove}
              onDragEnd={onNodeDragEnd}
            />
          ))}
        </g>
      </svg>
      <div className="absolute bottom-3 right-3 flex items-center gap-2">
        {onResetLayout ? (
          <button
            type="button"
            onClick={onResetLayout}
            aria-label={pick("Düzeni sıfırla", "Reset layout")}
            title={pick("Düzeni sıfırla", "Reset layout")}
            className={cn(
              "grid h-8 w-8 place-items-center rounded-[8px]",
              "border border-rule-soft bg-paper-2 text-ink-3",
              "hover:bg-paper-3 hover:text-ink",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            )}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          onClick={fit}
          aria-label={pick("Sığdır", "Fit")}
          title={pick("Sığdır", "Fit")}
          className={cn(
            "grid h-8 w-8 place-items-center rounded-[8px]",
            "border border-rule-soft bg-paper-2 text-ink-3",
            "hover:bg-paper-3 hover:text-ink",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          )}
        >
          <Maximize2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function NodeMark(props: {
  node: RoadmapLayoutNode;
  selected: boolean;
  dimmed: boolean;
  dragging: boolean;
  done: boolean;
  isRoot: boolean;
  startLabel: string;
  draggable: boolean;
  onDragStart: (node: RoadmapLayoutNode, cx: number, cy: number) => void;
  onDragMove: (cx: number, cy: number) => void;
  onDragEnd: (cx: number, cy: number) => void;
}) {
  const {
    node,
    selected,
    dimmed,
    dragging,
    done,
    isRoot,
    startLabel,
    draggable,
    onDragStart,
    onDragMove,
    onDragEnd,
  } = props;
  const box = NODE_BOX[node.depth];
  const fontSize = FONT_SIZE[node.depth];
  const hw = box.w / 2;
  const hh = box.h / 2;
  const isDone = done;

  function handleDown(e: ReactPointerEvent<SVGRectElement>): void {
    if (!draggable) return;
    // Keep the SVG's pan from also starting on this press.
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    onDragStart(node, e.clientX, e.clientY);
  }
  function handleMove(e: ReactPointerEvent<SVGRectElement>): void {
    if (draggable) onDragMove(e.clientX, e.clientY);
  }
  function handleUp(e: ReactPointerEvent<SVGRectElement>): void {
    if (!draggable) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    onDragEnd(e.clientX, e.clientY);
  }

  return (
    <g
      transform={`translate(${node.x},${node.y})`}
      style={{ opacity: dimmed && !selected ? 0.45 : 1 }}
    >
      {/* Native tooltip shows the full title on hover when it's clamped. */}
      <title>{node.title}</title>
      {isRoot ? (
        <g transform={`translate(0,${-hh - 14})`} pointerEvents="none">
          <rect
            x={-27}
            y={-9}
            width={54}
            height={18}
            rx={9}
            ry={9}
            className="fill-accent"
          />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-paper"
            style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.02em" }}
          >
            {startLabel}
          </text>
        </g>
      ) : null}
      {selected ? (
        <rect
          x={-hw - 4}
          y={-hh - 4}
          width={box.w + 8}
          height={box.h + 8}
          rx={13}
          ry={13}
          className="fill-none stroke-accent"
          strokeWidth={2}
          pointerEvents="none"
        />
      ) : null}
      <rect
        x={-hw}
        y={-hh}
        width={box.w}
        height={box.h}
        rx={10}
        ry={10}
        className={cn(
          "stroke-rule-strong transition-[fill,opacity] duration-[120ms]",
          isDone ? "fill-paper-3 opacity-70" : "fill-paper",
          draggable
            ? dragging
              ? "cursor-grabbing"
              : "cursor-grab"
            : "cursor-pointer",
        )}
        strokeWidth={1.5}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
      />
      <foreignObject
        x={-hw}
        y={-hh}
        width={box.w}
        height={box.h}
        style={{ pointerEvents: "none" }}
      >
        <div
          className="flex h-full w-full items-center justify-center px-2.5 py-1 text-center"
          style={{ fontSize: `${fontSize}px` }}
        >
          <span
            className={cn(
              "line-clamp-2 font-medium leading-tight",
              isDone ? "text-ink-3" : "text-ink",
            )}
          >
            {node.title}
          </span>
        </div>
      </foreignObject>
      {isDone ? (
        <g transform={`translate(${hw - 9},${-hh + 9})`} pointerEvents="none">
          <circle r={7} className="fill-ok" />
          <Check
            className="text-paper"
            x={-4}
            y={-4}
            width={8}
            height={8}
            strokeWidth={3}
          />
        </g>
      ) : null}
    </g>
  );
}

// A smooth cubic-Bézier edge between two cards. Anchors on the card faces that
// face each other and uses tangents along the dominant axis so every link
// reads as a clean directional flow (mostly top→bottom for a prerequisite
// chain) instead of a straight diagonal slashing across the canvas. Cards are
// painted over the edges, so a long link reads as passing "behind" the graph.
function edgePath(from: RoadmapLayoutNode, to: RoadmapLayoutNode): string {
  const fb = NODE_BOX[from.depth];
  const tb = NODE_BOX[to.depth];
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (Math.abs(dy) >= Math.abs(dx)) {
    // Vertical-dominant: exit the bottom (or top) face, enter the opposite.
    const down = dy >= 0;
    const sx = from.x;
    const sy = from.y + (down ? fb.h / 2 : -fb.h / 2);
    const tx = to.x;
    const ty = to.y + (down ? -(tb.h / 2 + ARROW_GAP) : tb.h / 2 + ARROW_GAP);
    const k = Math.max(22, Math.abs(ty - sy) * 0.42);
    const c1y = sy + (down ? k : -k);
    const c2y = ty + (down ? -k : k);
    return `M ${sx} ${sy} C ${sx} ${c1y} ${tx} ${c2y} ${tx} ${ty}`;
  }

  // Horizontal-dominant (e.g. after a sideways drag): exit a left/right face.
  const right = dx >= 0;
  const sx = from.x + (right ? fb.w / 2 : -fb.w / 2);
  const sy = from.y;
  const tx = to.x + (right ? -(tb.w / 2 + ARROW_GAP) : tb.w / 2 + ARROW_GAP);
  const ty = to.y;
  const k = Math.max(22, Math.abs(tx - sx) * 0.42);
  const c1x = sx + (right ? k : -k);
  const c2x = tx + (right ? -k : k);
  return `M ${sx} ${sy} C ${c1x} ${sy} ${c2x} ${ty} ${tx} ${ty}`;
}
