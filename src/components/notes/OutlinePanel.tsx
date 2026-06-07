"use client";

/**
 * Phase 6.8 — Note outline (heading nav) side panel.
 *
 * Renders the current note's ATX headings as an indented clickable list.
 * Clicking a row dispatches a CM6 `selection: cursor(line) + scrollIntoView`
 * transaction on the editor view supplied by the route via `getView`. The
 * panel doesn't own the editor lifecycle — it just borrows the live view
 * accessor (same pattern as `EditorToolbar`'s `getView` prop).
 *
 * The outline is recomputed from `content` on every render — pure helper,
 * cheap for the realistic note size (sub-1MB). For very large vault items
 * a memoization layer can be added later, but it's premature now.
 */

import { Hash } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { buildNoteOutline, type NoteOutlineItem } from "@/lib/notes/outline";
import { cn } from "@/lib/utils/cn";

export type OutlinePanelProps = {
  content: string;
  /** Live editor view accessor — used to dispatch a scroll on row click. */
  getView?: () => EditorView | null;
  className?: string;
};

export function OutlinePanel({ content, getView, className }: OutlinePanelProps) {
  const t = useTranslations("notes.outline");
  const items = useMemo(() => buildNoteOutline(content), [content]);

  const handleJump = (item: NoteOutlineItem): void => {
    const view = getView?.();
    if (!view) return;
    const total = view.state.doc.lines;
    const line = Math.min(Math.max(item.line, 1), total);
    const lineStart = view.state.doc.line(line).from;
    view.dispatch({
      selection: EditorSelection.cursor(lineStart),
      scrollIntoView: true,
    });
    view.focus();
  };

  return (
    <aside
      data-testid="note-outline-panel"
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-[12px] border border-rule bg-paper",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-rule px-3 py-2">
        <div className="flex items-center gap-2 text-ink-2">
          <Hash className="h-3.5 w-3.5" aria-hidden />
          <span className="text-[11px] font-mono uppercase tracking-[0.08em]">
            {t("title")}
          </span>
        </div>
        {items.length > 0 ? (
          <span
            className="rounded-full bg-paper-2 px-1.5 py-[1px] font-mono text-[10px] text-ink-3"
            aria-label={t("count_aria", { count: items.length })}
          >
            {items.length}
          </span>
        ) : null}
      </header>

      {items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-3 py-6 text-center text-[12px] text-ink-4">
          {t("empty_description")}
        </div>
      ) : (
        <ul
          role="list"
          className="flex-1 overflow-auto px-2 py-2 text-[13px]"
          data-testid="note-outline-list"
        >
          {items.map((item, idx) => (
            <li key={`${item.line}-${idx}`}>
              <button
                type="button"
                onClick={() => handleJump(item)}
                className={cn(
                  "block w-full truncate rounded-md px-2 py-1 text-left text-ink-2 transition-colors",
                  "hover:bg-paper-2 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                )}
                style={{ paddingLeft: 8 + (item.level - 1) * 12 }}
                data-testid="note-outline-row"
                data-level={item.level}
                data-line={item.line}
                title={item.text}
              >
                {item.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
