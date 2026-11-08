"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { computePopoverPosition, type PopoverPosition } from "./picker-utils";

type Props = {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  width: number;
  height: number;
  label: string;
  children: ReactNode;
};

function positionFor(anchor: HTMLElement, width: number, height: number): PopoverPosition {
  const r = anchor.getBoundingClientRect();
  return computePopoverPosition(
    { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
    { width: window.innerWidth, height: window.innerHeight },
    width,
    height,
  );
}

/**
 * Floating panel anchored to a trigger. Rendered in a portal because settings
 * cards clip overflow; closes on Escape and on pointer-down outside.
 */
export function AnchoredPopover({ anchorRef, open, onClose, width, height, label, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;
    const update = () => setPosition(positionFor(anchor, width, height));
    const frame = requestAnimationFrame(update);
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        anchor.focus();
      }
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, anchorRef, width, height, onClose]);

  if (!open || !position || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      className="fixed z-50 flex overflow-hidden rounded-[var(--radius-lg)] border border-rule bg-paper shadow-[var(--shadow-deep)]"
      style={{ top: position.top, left: position.left, width: position.width, height: position.maxHeight }}
    >
      {children}
    </div>,
    document.body,
  );
}
