"use client";

import type { EditorView } from "@codemirror/view";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronsRight } from "@/components/icons";
import type { ToolbarItemId } from "@/lib/notes/editor-prefs";
import { cn } from "@/lib/utils/cn";
import { ToolbarPopover } from "./ToolbarPopover";
import {
  type ToolbarButtonDef,
  type ToolbarContext,
  type ToolbarItemDef,
  type ToolbarMenuDef,
  buildToolbarItem,
} from "./toolbar-actions";
import { computeToolbarLayout, resolveToolbarItems } from "./toolbar-layout";

export type EditingToolbarProps = Omit<ToolbarContext, "t" | "mod"> & {
  getView: () => EditorView | null;
  items: readonly ToolbarItemId[];
  /** "row" = docked ribbon with overflow; "compact" = floating selection bar. */
  variant?: "row" | "compact";
  className?: string;
};

// Keep the editor selection when a toolbar control is pressed with the mouse.
function keepEditorFocus(e: React.MouseEvent): void {
  e.preventDefault();
}

const noopSubscribe = () => () => {};

// Platform never changes at runtime; the server snapshot keeps SSR stable.
function useModifierLabel(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"),
    () => "Ctrl",
  );
}

function titleFor(def: { label: string; shortcut?: string }): string {
  return def.shortcut ? `${def.label} (${def.shortcut})` : def.label;
}

function IconButton({
  def,
  onRun,
}: {
  def: ToolbarButtonDef;
  onRun: () => void;
}) {
  const Icon = def.icon;
  return (
    <button
      type="button"
      title={titleFor(def)}
      aria-label={def.label}
      aria-pressed={def.active ?? undefined}
      disabled={def.disabled}
      onMouseDown={keepEditorFocus}
      onClick={onRun}
      className={cn(
        "inline-grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[7px] text-ink-3 transition-colors",
        "hover:bg-paper-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        "disabled:pointer-events-none disabled:opacity-35",
        def.active && "bg-accent-soft/70 text-ink",
      )}
    >
      <Icon className="h-[17px] w-[17px]" strokeWidth={2} aria-hidden />
    </button>
  );
}

function MenuButton({
  def,
  getView,
}: {
  def: ToolbarMenuDef;
  getView: () => EditorView | null;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const Icon = def.icon;
  const view = getView();

  const runPrimary = () => {
    const v = getView();
    if (!v) return;
    if (def.primary) def.primary(v);
    else setOpen((o) => !o);
  };

  return (
    <div
      ref={anchorRef}
      className={cn(
        "inline-flex h-[30px] shrink-0 items-center rounded-[7px] text-ink-3 transition-colors",
        (def.active || open) && "bg-accent-soft/70 text-ink",
      )}
    >
      <button
        type="button"
        title={def.label}
        aria-label={def.label}
        aria-haspopup={def.primary ? undefined : "menu"}
        aria-expanded={def.primary ? undefined : open}
        onMouseDown={keepEditorFocus}
        onClick={runPrimary}
        className="relative inline-grid h-[30px] w-[28px] place-items-center rounded-l-[7px] hover:bg-paper-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Icon className="h-[17px] w-[17px]" strokeWidth={2} aria-hidden />
        {def.swatch ? (
          <span
            aria-hidden
            className="absolute bottom-[4px] left-1/2 h-[3px] w-[16px] -translate-x-1/2 rounded-full"
            style={{ backgroundColor: def.swatch }}
          />
        ) : null}
      </button>
      <button
        type="button"
        aria-label={def.label}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={keepEditorFocus}
        onClick={() => setOpen((o) => !o)}
        className="inline-grid h-[30px] w-[14px] place-items-center rounded-r-[7px] hover:bg-paper-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ChevronDown className="h-3 w-3" aria-hidden />
      </button>
      <ToolbarPopover anchorRef={anchorRef} open={open && !!view} onClose={close} label={def.label} {...(def.width ? { width: def.width } : {})}>
        {view ? def.renderMenu(view, close) : null}
      </ToolbarPopover>
    </div>
  );
}

function OverflowMenu({
  defs,
  getView,
  label,
}: {
  defs: Array<{ id: ToolbarItemId; def: ToolbarItemDef }>;
  getView: () => EditorView | null;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const view = getView();

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={keepEditorFocus}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-grid h-[30px] w-[32px] shrink-0 place-items-center rounded-[7px] text-ink-3 hover:bg-paper-3 hover:text-ink",
          open && "bg-paper-3 text-ink",
        )}
        data-testid="toolbar-overflow"
      >
        <ChevronsRight className="h-4 w-4" aria-hidden />
      </button>
      <ToolbarPopover anchorRef={anchorRef} open={open && !!view} onClose={close} label={label} width={260} align="end">
        {view ? (
          <div role="menu" className="flex max-h-[min(70vh,520px)] flex-col gap-0.5 overflow-y-auto">
            {defs.map(({ id, def }) => {
              const Icon = def.icon;
              if (def.kind === "button") {
                return (
                  <button
                    key={id}
                    type="button"
                    role="menuitem"
                    disabled={def.disabled}
                    onClick={() => {
                      def.run(view);
                      close();
                    }}
                    className={cn(
                      "flex items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink disabled:opacity-40",
                      def.active && "text-accent-ink",
                    )}
                  >
                    <Icon className="h-4 w-4 text-ink-3" aria-hidden />
                    <span className="flex-1">{def.label}</span>
                    {def.shortcut ? <span className="text-[11px] text-ink-4">{def.shortcut}</span> : null}
                  </button>
                );
              }
              return (
                <details key={id} className="group rounded-[6px]">
                  <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink">
                    <Icon className="h-4 w-4 text-ink-3" aria-hidden />
                    <span className="flex-1">{def.label}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-ink-4 transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  <div className="py-1 pl-3">{def.renderMenu(view, close)}</div>
                </details>
              );
            })}
          </div>
        ) : null}
      </ToolbarPopover>
    </>
  );
}

/**
 * Word-style editing ribbon (the "Editing Toolbar" plugin's top mode). One
 * row; commands that don't fit move into the "»" menu instead of wrapping.
 * The same component renders the compact floating bar for "following" mode.
 */
export function EditingToolbar({ getView, items, variant = "row", className, ...ctxProps }: EditingToolbarProps) {
  const t = useTranslations("notes.editor.toolbar");
  const mod = useModifierLabel();
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || variant !== "row") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === "number") setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [variant]);

  const ctx: ToolbarContext = { ...ctxProps, t: t as ToolbarContext["t"], mod };
  const specs = useMemo(() => resolveToolbarItems(items), [items]);
  const layout = variant === "row" && width > 0 ? computeToolbarLayout(specs, width) : { visible: specs, overflow: [] };

  const run = (def: ToolbarButtonDef) => () => {
    const view = getView();
    if (view) def.run(view);
  };

  return (
    <div
      ref={containerRef}
      role="toolbar"
      aria-label={t("aria_label")}
      data-testid="editing-toolbar"
      className={cn(
        "flex min-w-0 items-center gap-[2px]",
        variant === "row" ? "overflow-hidden" : "flex-wrap",
        className,
      )}
    >
      {layout.visible.map((spec, i) => {
        const prev = layout.visible[i - 1];
        const def = buildToolbarItem(spec.id, ctx);
        return (
          <span key={spec.id} className="contents">
            {prev && prev.group !== spec.group ? (
              <span aria-hidden className="mx-[4px] h-[18px] w-px shrink-0 bg-rule" />
            ) : null}
            {def.kind === "button" ? (
              <IconButton def={def} onRun={run(def)} />
            ) : (
              <MenuButton def={def} getView={getView} />
            )}
          </span>
        );
      })}
      {layout.overflow.length > 0 ? (
        <OverflowMenu
          label={t("more")}
          getView={getView}
          defs={layout.overflow.map((spec) => ({ id: spec.id, def: buildToolbarItem(spec.id, ctx) }))}
        />
      ) : null}
    </div>
  );
}
