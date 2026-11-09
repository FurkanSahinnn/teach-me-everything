"use client";

import { type MouseEvent, useCallback, useMemo } from "react";
import { findChunkForRef } from "@/components/notebook/CitationChip";
import type { ChunkRecord } from "@/lib/db/types";
import { type CodeStylerLabels, readCodeForCopy } from "@/lib/markdown/code-styler";
import { renderMarkdownToHtml } from "@/lib/markdown/render";
import { cn } from "@/lib/utils/cn";

const COPIED_RESET_MS = 1500;

function copyCode(button: HTMLElement): void {
  const idle = button.dataset.label ?? button.textContent ?? "";
  void navigator.clipboard
    ?.writeText(readCodeForCopy(button))
    .then(() => {
      button.textContent = button.dataset.copiedLabel ?? idle;
      setTimeout(() => {
        button.textContent = idle;
      }, COPIED_RESET_MS);
    })
    .catch(() => {
      /* Clipboard access can be denied; the button just stays idle. */
    });
}

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
  labels,
}: {
  text: string;
  className?: string;
  citationChunks?: ChunkRecord[] | undefined;
  onCitationClick?: ((chunk: ChunkRecord) => void) | undefined;
  /** Overrides for the code block header strings (copy / copied / collapsed). */
  labels?: Partial<CodeStylerLabels> | undefined;
}) {
  const html = useMemo(
    () => renderMarkdownToHtml(text, citationChunks, labels ? { labels } : {}),
    [text, citationChunks, labels],
  );

  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      const copyButton = target?.closest<HTMLElement>("[data-code-copy]");
      if (copyButton) {
        // The button may sit inside a <summary>: keep the click from toggling it.
        event.preventDefault();
        event.stopPropagation();
        copyCode(copyButton);
        return;
      }
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
