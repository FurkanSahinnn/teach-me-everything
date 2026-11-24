"use client";

import { useLayoutEffect, useRef } from "react";
import type { ReadingPosition } from "@/lib/db/types";

function capturePosition(root: HTMLDivElement): ReadingPosition {
  const { scrollTop } = root;
  if (scrollTop <= 0) return { scrollTop: 0 };

  const viewport = root.getBoundingClientRect();
  const viewportTop = viewport.top + root.clientTop;
  // Hit-test the visible content instead of measuring skipped chunks. Their
  // intrinsic placeholders can shift which chunk appears to be at this offset.
  const chunk = document
    .elementFromPoint(viewport.left + root.clientWidth / 2, viewportTop + 1)
    ?.closest<HTMLElement>("[data-reader-chunk]");
  if (!chunk || !root.contains(chunk)) return { scrollTop };

  return {
    scrollTop,
    anchor: {
      chunkIndex: Number(chunk.dataset.readerChunk),
      offset: viewportTop - chunk.getBoundingClientRect().top,
    },
  };
}

function restorePosition(root: HTMLDivElement, position: ReadingPosition) {
  const { anchor } = position;
  const target = anchor && Number.isInteger(anchor.chunkIndex) && Number.isFinite(anchor.offset)
    ? root.querySelector<HTMLElement>(`[data-reader-chunk="${anchor.chunkIndex}"]`)
    : null;
  if (!target || !anchor) {
    root.scrollTo({ top: position.scrollTop, behavior: "instant" });
    return;
  }

  // Measure the destination even if content-visibility was using a placeholder.
  const previous = target.style.contentVisibility;
  target.style.contentVisibility = "visible";
  const viewportTop = root.getBoundingClientRect().top + root.clientTop;
  const top = root.scrollTop + target.getBoundingClientRect().top - viewportTop + anchor.offset;
  root.scrollTo({ top, behavior: "instant" });
  target.style.contentVisibility = previous;
}

export function useReadingPosition(
  initial: ReadingPosition | undefined,
  hasContent: boolean,
  resume: boolean,
  onSave: (position: ReadingPosition) => void,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingRestore = useRef(resume && initial && Number.isFinite(initial.scrollTop) ? initial : null);
  const restoredScrollTop = useRef<number | null>(null);

  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root || !hasContent) return;
    if (!resume) pendingRestore.current = null;

    let pendingSave: ReadingPosition | null = null;
    let savedPosition: ReadingPosition | null = null;
    let didScroll = false;
    let timer: number | undefined;
    let restoreFrame: number | null = null;
    const flush = () => {
      window.clearTimeout(timer);
      const position = pendingSave;
      pendingSave = null;
      if (!position) return;
      if (
        savedPosition?.scrollTop === position.scrollTop &&
        savedPosition.anchor?.chunkIndex === position.anchor?.chunkIndex &&
        savedPosition.anchor?.offset === position.anchor?.offset
      ) return;
      savedPosition = position;
      onSave(position);
    };
    const saveVisiblePosition = () => {
      if (didScroll && root.clientHeight > 0) pendingSave = capturePosition(root);
      flush();
    };

    const restore = () => {
      if (!pendingRestore.current || root.clientHeight === 0 || restoreFrame !== null) return;
      restorePosition(root, pendingRestore.current);
      // The first jump brings neighboring chunks into layout. Reapply the
      // offset after their intrinsic placeholders have been replaced.
      restoreFrame = window.requestAnimationFrame(() => {
        restoreFrame = window.requestAnimationFrame(() => {
          restoreFrame = null;
          const position = pendingRestore.current;
          if (!position || root.clientHeight === 0) return;
          restorePosition(root, position);
          pendingRestore.current = null;
          restoredScrollTop.current = root.scrollTop;
          observer.disconnect();
        });
      });
    };
    const observer = new ResizeObserver(restore);
    if (pendingRestore.current) observer.observe(root);
    restore();

    const scroll = () => {
      if (root.clientHeight === 0 || pendingRestore.current) return;
      const restored = restoredScrollTop.current;
      restoredScrollTop.current = null;
      if (restored === root.scrollTop) return;
      didScroll = true;
      pendingSave = capturePosition(root);
      window.clearTimeout(timer);
      timer = window.setTimeout(saveVisiblePosition, 180);
    };
    root.addEventListener("scroll", scroll, { passive: true });
    // Capture the still-visible layout before following a link. Cleanup can
    // run after the route has already invalidated the chunk measurements.
    window.addEventListener("pointerdown", saveVisiblePosition, true);
    window.addEventListener("pagehide", saveVisiblePosition);
    return () => {
      if (restoreFrame !== null) window.cancelAnimationFrame(restoreFrame);
      observer.disconnect();
      root.removeEventListener("scroll", scroll);
      window.removeEventListener("pointerdown", saveVisiblePosition, true);
      window.removeEventListener("pagehide", saveVisiblePosition);
      flush();
    };
  }, [hasContent, resume, onSave]);

  return scrollRef;
}
