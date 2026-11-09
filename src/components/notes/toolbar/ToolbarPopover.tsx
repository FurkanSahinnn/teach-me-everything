"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

type Props = {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  /** Preferred width; the panel never exceeds the viewport. */
  width?: number;
  align?: "start" | "end";
};

const VIEWPORT_MARGIN = 8;

/**
 * Dropdown panel for toolbar menus (headings, colours, table size). Portalled
 * so the editor pane's overflow can't clip it; flips above the anchor when
 * there is no room below. Closes on Escape and on pointer-down outside.
 *
 * Mouse-down inside the panel is prevented by default so the editor keeps its
 * selection while the user picks a colour; inputs opt back in.
 */
export function ToolbarPopover({ anchorRef, open, onClose, label, children, width, align = "start" }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Layout effect so the panel is placed before paint; a stale position from
  // the previous opening is overwritten in the same frame.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const pw = panel?.offsetWidth ?? width ?? 220;
      const ph = panel?.offsetHeight ?? 200;
      let left = align === "end" ? r.right - pw : r.left;
      left = Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - pw - VIEWPORT_MARGIN));
      const below = r.bottom + 6;
      const top =
        below + ph > window.innerHeight - VIEWPORT_MARGIN && r.top - ph - 6 > VIEWPORT_MARGIN
          ? r.top - ph - 6
          : below;
      setPos({ top, left });
    };
    place();
    const frame = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorRef, width, align]);

  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, anchorRef, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
      className="fixed z-50 rounded-[10px] border border-rule bg-paper p-1.5 text-ink shadow-[var(--shadow-deep)]"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width,
        maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
