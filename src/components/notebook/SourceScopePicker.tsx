"use client";

/**
 * Workspace Chat — source-scope picker.
 *
 * A chip-styled dropdown that sits next to the "Sources" context chip and lets
 * the user narrow cross-source retrieval to a SUBSET of the workspace's sources
 * instead of always searching all of them.
 *
 * Selection convention (mirrors the persisted `selectedSourceIds`):
 *   - `[]` (empty) ⇒ ALL sources — the default, backward-compatible state.
 *   - a non-empty array ⇒ only those sources are fed to the RAG retrieval.
 * "None" is intentionally not representable — narrowing to zero sources is what
 * turning the Sources chip off conceptually means, so unchecking the last box
 * snaps back to "all".
 *
 * Close-on-outside-click / Escape follows the same pattern as
 * `EmbedAsSourceMenu` so the popover feels native alongside the rest of the app.
 */

import {
  Check,
  ChevronDown,
  FileText,
  Globe,
  ListFilter,
  Notebook,
  Video,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocalePick } from "@/i18n/IntlProvider";
import { cn } from "@/lib/utils/cn";

export type PickableSource = {
  id: string;
  title: string;
  titleEn?: string | undefined;
  type: string;
};

export type SourceScopePickerProps = {
  /** Ready sources in the workspace, in display order. */
  sources: PickableSource[];
  /** Empty ⇒ all sources; non-empty ⇒ that subset. */
  selectedSourceIds: string[];
  onChange: (next: string[]) => void;
  /** Disabled while a chat turn is in flight (mirrors the composer) so an
   *  in-stream toggle can't diverge from the value the turn actually used. */
  disabled?: boolean;
};

const TYPE_ICON: Record<string, LucideIcon> = {
  note: Notebook,
  url: Globe,
  youtube: Video,
};

function iconFor(type: string): LucideIcon {
  return TYPE_ICON[type] ?? FileText;
}

export function SourceScopePicker({
  sources,
  selectedSourceIds,
  onChange,
  disabled = false,
}: SourceScopePickerProps) {
  const t = useTranslations("workspace_chat");
  const pick = useLocalePick();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Collapse the popover if the turn starts while it's open.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

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

  const availableIds = useMemo(() => sources.map((s) => s.id), [sources]);
  const selectedSet = useMemo(
    () => new Set(selectedSourceIds),
    [selectedSourceIds],
  );
  // Count only ids that still map to a live source. This also drives `isAll`,
  // so a selection left holding ONLY stale ids (every chosen source deleted)
  // reads as "all sources" rather than a forbidden "0 / N" none-state — it
  // self-heals to [] on the next toggle via commit()'s availableIds filter.
  const selectedCount = sources.filter((s) => selectedSet.has(s.id)).length;
  const isAll = selectedCount === 0;

  function commit(nextSet: Set<string>): void {
    let next = availableIds.filter((id) => nextSet.has(id));
    // Both "unchecked everything" and "checked everything" collapse to the
    // canonical all-sources sentinel ([]).
    if (next.length === 0 || next.length === availableIds.length) next = [];
    onChange(next);
  }

  function toggle(id: string): void {
    const effective = new Set(
      isAll ? availableIds : availableIds.filter((x) => selectedSet.has(x)),
    );
    if (effective.has(id)) effective.delete(id);
    else effective.add(id);
    commit(effective);
  }

  const triggerLabel = isAll
    ? t("source_scope_all")
    : t("source_scope_count", { selected: selectedCount, total: sources.length });

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("source_scope_trigger_aria")}
        title={t("source_scope_hint")}
        data-testid="workspace-source-scope-trigger"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em] transition-colors",
          isAll
            ? "border-rule text-ink-4 hover:border-ink-3 hover:text-ink-3"
            : "border-accent bg-accent-wash text-accent-ink",
          open && "border-ink-3 text-ink-3",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <ListFilter className="h-3 w-3" aria-hidden />
        <span>{triggerLabel}</span>
        <ChevronDown
          className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-multiselectable
          aria-label={t("source_scope_title")}
          data-testid="workspace-source-scope-menu"
          className="absolute left-0 top-[calc(100%+6px)] z-[120] w-[280px] max-w-[80vw] rounded-[10px] border border-rule bg-paper p-1.5 shadow-[var(--shadow-medium)]"
        >
          <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-4">
            {t("source_scope_title")}
          </div>

          <button
            type="button"
            role="option"
            aria-selected={isAll}
            onClick={() => onChange([])}
            className={cn(
              "flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-paper-2",
              isAll ? "text-accent-ink" : "text-ink",
            )}
          >
            <span
              className={cn(
                "flex h-3.5 w-3.5 shrink-0 items-center justify-center",
                isAll ? "text-accent" : "text-transparent",
              )}
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
            </span>
            <span className="font-medium">{t("source_scope_all")}</span>
          </button>

          <div className="my-1 h-px bg-rule" />

          <div className="max-h-[260px] space-y-0.5 overflow-y-auto">
            {sources.map((s) => {
              const Icon = iconFor(s.type);
              const checked = isAll || selectedSet.has(s.id);
              const title = pick(s.title, s.titleEn ?? s.title);
              return (
                <button
                  key={s.id}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onClick={() => toggle(s.id)}
                  title={title}
                  data-testid="workspace-source-scope-option"
                  className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12.5px] text-ink transition-colors hover:bg-paper-2"
                >
                  <span
                    className={cn(
                      "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border",
                      checked
                        ? "border-accent bg-accent text-paper"
                        : "border-rule text-transparent",
                    )}
                  >
                    <Check className="h-2.5 w-2.5" aria-hidden />
                  </span>
                  <Icon className="h-3.5 w-3.5 shrink-0 text-ink-4" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{title}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
