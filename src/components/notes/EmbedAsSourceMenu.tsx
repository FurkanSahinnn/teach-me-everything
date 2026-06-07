"use client";

/**
 * Phase 6.9.5 — Cog dropdown next to the Embed-as-Source button.
 *
 * Owns the per-note `autoEmbedOnSave` checkbox. The actual auto-sync timer
 * + cost guard live at the route level (`/w/[id]/notes/page.tsx`) so the
 * menu stays a thin form control — easy to test, easy to swap out when
 * Phase 7 (Tauri) adds disk-filesystem export.
 *
 * Toggle wiring: clicking the checkbox calls `setNoteAutoEmbed(noteId, v)`
 * directly against Dexie; `useLiveQuery` on the note row pushes the new
 * value back through `autoEmbedOnSave` so the checkmark UI stays in sync
 * across tabs without extra plumbing.
 */

import { Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { setNoteAutoEmbed } from "@/lib/db/notes";
import { cn } from "@/lib/utils/cn";

export type EmbedAsSourceMenuProps = {
  noteId: string;
  /** Current persisted state of the per-note auto-sync flag. */
  autoEmbedOnSave: boolean;
  /** Disable the toggle when the embedder can't even resolve a key. */
  disabled?: boolean;
  className?: string;
};

export function EmbedAsSourceMenu({
  noteId,
  autoEmbedOnSave,
  disabled,
  className,
}: EmbedAsSourceMenuProps) {
  const t = useTranslations("notes.embed.menu");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape — same pattern as `NoteTreeContextMenu`
  // so the cog feels native alongside the rest of the notes surface.
  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: MouseEvent) {
      if (!rootRef.current) return;
      if (e.target instanceof Node && rootRef.current.contains(e.target)) {
        return;
      }
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const handleToggle = useCallback(
    async (next: boolean) => {
      try {
        await setNoteAutoEmbed(noteId, next);
      } catch {
        // Dexie writes here are idempotent — a transient failure (storage
        // quota) surfaces as the checkbox staying in its previous state
        // on the next live-query tick.
      }
    },
    [noteId],
  );

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("trigger_aria")}
        title={t("trigger_aria")}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        data-testid="note-embed-menu-trigger"
        data-state={open ? "open" : "closed"}
        className={cn(
          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-rule",
          "bg-paper-2/40 text-ink-2 transition-colors duration-150",
          "hover:bg-paper-3 hover:text-ink active:bg-paper-4",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper",
          "disabled:cursor-not-allowed disabled:opacity-60",
          open && "bg-paper-3 text-ink",
        )}
      >
        <Settings2 className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={t("trigger_aria")}
          data-testid="note-embed-menu"
          className={cn(
            "absolute right-0 top-[calc(100%+4px)] z-30 w-[260px] rounded-[10px] border border-rule bg-paper shadow-lg",
            "p-2",
          )}
        >
          <label
            htmlFor={`note-auto-sync-${noteId}`}
            className="flex cursor-pointer items-start gap-2 rounded-[8px] px-2 py-1.5 text-[12.5px] text-ink hover:bg-paper-2"
          >
            <input
              id={`note-auto-sync-${noteId}`}
              type="checkbox"
              checked={autoEmbedOnSave}
              onChange={(e) => void handleToggle(e.target.checked)}
              data-testid="note-auto-sync-toggle"
              className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-accent"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{t("auto_sync_label")}</span>
              <span className="text-[11px] text-ink-3">
                {t("auto_sync_description")}
              </span>
            </span>
          </label>
        </div>
      ) : null}
    </div>
  );
}
