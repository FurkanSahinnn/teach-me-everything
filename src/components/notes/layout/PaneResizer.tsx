"use client";

import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils/cn";

type Props = {
  /** Which edge of the pane the handle sits on; drag direction follows it. */
  side: "left" | "right";
  width: number;
  min: number;
  max: number;
  label: string;
  /** Live width while dragging. */
  onResize: (width: number) => void;
  /** Final width when the drag ends (persist here). */
  onCommit: (width: number) => void;
};

const KEY_STEP = 16;

/**
 * Drag handle between two panes. Pointer capture keeps the drag alive when
 * the cursor leaves the 6px hit area; arrow keys resize for keyboard users.
 */
export function PaneResizer({ side, width, min, max, label, onResize, onCommit }: Props) {
  const startRef = useRef<{ x: number; width: number } | null>(null);
  const lastRef = useRef(width);

  const clamp = (w: number) => Math.min(max, Math.max(min, Math.round(w)));

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = { x: e.clientX, width };
    lastRef.current = width;
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start) return;
    const delta = side === "right" ? e.clientX - start.x : start.x - e.clientX;
    lastRef.current = clamp(start.width + delta);
    onResize(lastRef.current);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return;
    startRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onCommit(lastRef.current);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const grow = (e.key === "ArrowRight") === (side === "right");
        onCommit(clamp(width + (grow ? KEY_STEP : -KEY_STEP)));
      }}
      className={cn(
        "group absolute top-0 z-20 hidden h-full w-[7px] cursor-col-resize touch-none lg:block",
        side === "right" ? "-right-[4px]" : "-left-[4px]",
      )}
    >
      <span className="absolute inset-y-0 left-[3px] w-px bg-transparent transition-colors group-hover:bg-accent group-focus-visible:bg-accent group-active:bg-accent" />
    </div>
  );
}
