"use client";

/**
 * Phase 6.5 — Backlinks side panel for the notes editor.
 *
 * Lists every note in the current workspace whose `wikilinks[]` includes
 * the current note's title (i.e. anyone who has typed `[[<currentTitle>]]`).
 * Driven by `useBacklinks` → Dexie multiEntry index, so writes elsewhere
 * propagate live without manual refresh.
 *
 * Layout: compact stacked rows under a header. Each row shows the
 * referencer's title, the short content excerpt around the first hit,
 * and is keyboard-focusable. `onSelect(id)` lets the parent navigate.
 */

import { FileText, Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { useBacklinks } from "@/lib/db/hooks";
import { cn } from "@/lib/utils/cn";

export type BacklinksPanelProps = {
  workspaceId: string;
  /** The title of the currently-open note. Empty / undefined hides the list. */
  currentNoteTitle: string;
  /** The id of the currently-open note — used to skip self-references. */
  currentNoteId?: string | undefined;
  /** Fires when the user clicks a row. */
  onSelect?: (noteId: string) => void;
  /** Maximum excerpt length around the first wikilink hit. */
  excerptRadius?: number;
  className?: string;
};

export function BacklinksPanel({
  workspaceId,
  currentNoteTitle,
  currentNoteId,
  onSelect,
  excerptRadius = 60,
  className,
}: BacklinksPanelProps) {
  const t = useTranslations("notes.backlinks");
  const rows = useBacklinks(workspaceId, currentNoteTitle) ?? [];

  // Skip self-references — a note that wikilinks to itself shouldn't show
  // up as its own backlink. Also memoise the excerpt extraction so we
  // don't re-scan content on unrelated re-renders.
  const items = useMemo(() => {
    return rows
      .filter((n) => n.id !== currentNoteId)
      .map((n) => ({
        id: n.id,
        title: n.title,
        excerpt: extractExcerpt(n.content, currentNoteTitle, excerptRadius),
      }));
  }, [rows, currentNoteId, currentNoteTitle, excerptRadius]);

  return (
    <aside
      data-testid="backlinks-panel"
      className={cn(
        "flex h-full min-h-0 flex-col rounded-[12px] border border-rule bg-paper",
        className,
      )}
    >
      <header className="flex items-center gap-2 border-b border-rule px-3 py-2">
        <Link2 className="h-4 w-4 text-ink-4" aria-hidden />
        <span className="flex-1 text-[13px] font-medium text-ink-2">
          {t("title")}
        </span>
        <span
          data-testid="backlinks-count"
          className="rounded-full bg-paper-3 px-2 py-0.5 text-[11px] tabular-nums text-ink-4"
        >
          {items.length}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {items.length === 0 ? (
          <EmptyState
            title={currentNoteTitle.length === 0 ? t("no_note_title") : t("empty_title")}
            description={t("empty_description")}
          />
        ) : (
          <ul className="flex flex-col gap-1" role="list">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect?.(item.id)}
                  data-testid="backlinks-row"
                  data-note-id={item.id}
                  className={cn(
                    "group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left",
                    "transition-colors hover:bg-paper-3 focus:bg-paper-3",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  )}
                >
                  <FileText
                    className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-ink-4 group-hover:text-ink-2"
                    aria-hidden
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[13px] font-medium text-ink-1">
                      {item.title}
                    </span>
                    {item.excerpt.length > 0 ? (
                      <span className="line-clamp-2 text-[11.5px] leading-snug text-ink-4">
                        {item.excerpt}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-1 px-4 py-6 text-center"
      data-testid="backlinks-empty"
    >
      <Link2 className="h-5 w-5 text-ink-5" aria-hidden />
      <p className="text-[13px] font-medium text-ink-3">{title}</p>
      <p className="text-[11.5px] leading-snug text-ink-4">{description}</p>
    </div>
  );
}

/**
 * Extract a short excerpt around the first occurrence of `[[<title>]]` in
 * the referencing note. Falls back to the first non-empty line when no
 * bracketed hit is found (e.g. the wikilinks index hit on a different
 * cased version that the regex won't re-match — rare but possible after
 * a rename-sweep race).
 */
function extractExcerpt(
  content: string,
  title: string,
  radius: number,
): string {
  if (title.length === 0) return "";
  // Use a literal substring search (case-insensitive) so we don't have to
  // escape regex metacharacters in the title.
  const lower = content.toLowerCase();
  const needle = `[[${title.toLowerCase()}`;
  const idx = lower.indexOf(needle);
  if (idx === -1) {
    // Fallback: first non-empty line, trimmed to the radius budget.
    const firstLine = content.split(/\n/).find((l) => l.trim().length > 0) ?? "";
    return firstLine.trim().slice(0, radius * 2);
  }
  const start = Math.max(0, idx - radius);
  const end = Math.min(content.length, idx + needle.length + radius);
  const slice = content.slice(start, end).replace(/\s+/g, " ").trim();
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  return `${prefix}${slice}${suffix}`;
}
