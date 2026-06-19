"use client";

import { type MouseEvent, useCallback, useMemo } from "react";
import { findChunkForRef } from "@/components/notebook/CitationChip";
import type { ChunkRecord } from "@/lib/db/types";
import { renderMarkdownToHtml } from "@/lib/markdown/render";
import { cn } from "@/lib/utils/cn";

/**
 * Standalone markdown reading surface (study lessons, journal, the reader).
 * Renders through the markdown-it pipeline in `lib/markdown/render` — the same
 * engine VS Code's preview uses — and mounts the resulting HTML. That HTML is
 * safe: the renderer runs markdown-it with `html: false`, so no source byte can
 * inject markup (see render.ts). Citations are plain buttons in the HTML; one
 * delegated click handler turns them back into navigations.
 */
export function MarkdownPreview({
  text,
  className,
  citationChunks,
  onCitationClick,
}: {
  text: string;
  className?: string;
  citationChunks?: ChunkRecord[] | undefined;
  onCitationClick?: ((chunk: ChunkRecord) => void) | undefined;
}) {
  const html = useMemo(
    () => renderMarkdownToHtml(text, citationChunks),
    [text, citationChunks],
  );

  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!onCitationClick || !citationChunks) return;
      const el = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        "[data-citation-ref]",
      );
      const ref = el?.getAttribute("data-citation-ref");
      if (!ref) return;
      const chunk = findChunkForRef(ref, citationChunks);
      if (chunk) onCitationClick(chunk);
    },
    [onCitationClick, citationChunks],
  );

  return (
    <div
      className={cn("markdown-preview text-ink-2", className)}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
