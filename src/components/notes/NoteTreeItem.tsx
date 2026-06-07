"use client";

import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Sparkles,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils/cn";
import {
  setDragPayload,
  type DragPayload,
} from "@/lib/notes/tree";

export type DropPosition = "before" | "into" | "after";

export type NoteTreeItemProps = {
  /** Discriminator chosen by the parent so render logic stays branchless. */
  variant: "folder" | "note";
  id: string;
  /** Display label. For unnamed items the parent supplies the i18n fallback. */
  label: string;
  depth: number;
  /** Folder-only — toggles the chevron + icon style. */
  expanded?: boolean;
  /** True when this item is the editor's currently open note. */
  selected?: boolean;
  /** Tracks the drop indicator the parent computed for this row, if any. */
  dropIndicator?: DropPosition | null;
  /** Editing the inline rename input. */
  renaming?: boolean;
  /** Phase 6.9.8 — note-only. True when the note has a linked SourceRecord
   *  (type:"note") in the workspace's sources table, signalling that it's
   *  been embedded into the RAG layer. Folders ignore this prop. */
  embedded?: boolean;
  /** Locale-resolved aria/title fallbacks. */
  labels: {
    expand: string;
    collapse: string;
    openMenu: string;
    untitledNote: string;
    untitledFolder: string;
    renameSave: string;
    renameCancel: string;
    /** Phase 6.9.8 — tooltip on the Sparkles dot. */
    embeddedTooltip: string;
  };
  onClick: () => void;
  onContextMenu: (event: ReactMouseEvent) => void;
  onMenuButtonClick: (event: ReactMouseEvent) => void;
  /** Folder-only — clicking the chevron toggles expanded. */
  onToggleExpand?: () => void;
  // DnD wiring — payloads are encoded by this row, decoded by the parent.
  onDragStart: (event: ReactDragEvent) => void;
  onDragOver: (event: ReactDragEvent) => void;
  onDragLeave: (event: ReactDragEvent) => void;
  onDrop: (event: ReactDragEvent) => void;
  // Inline rename editor
  initialRenameValue?: string | undefined;
  onRenameCommit?: ((next: string) => void) | undefined;
  onRenameCancel?: (() => void) | undefined;
};

// Indent step for nested rows. Matches the chevron column width so the
// label of a nested row aligns with the icon of its parent.
const INDENT_STEP = 14;

export function NoteTreeItem({
  variant,
  id,
  label,
  depth,
  expanded = false,
  selected = false,
  dropIndicator = null,
  renaming = false,
  embedded = false,
  labels,
  onClick,
  onContextMenu,
  onMenuButtonClick,
  onToggleExpand,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  initialRenameValue,
  onRenameCommit,
  onRenameCancel,
}: NoteTreeItemProps): ReactNode {
  const isFolder = variant === "folder";
  const displayLabel =
    label.trim().length > 0
      ? label
      : isFolder
        ? labels.untitledFolder
        : labels.untitledNote;

  return (
    <div
      data-testid={`tree-item-${variant}-${id}`}
      data-tree-item-id={id}
      data-tree-item-kind={variant}
      data-selected={selected ? "true" : "false"}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "group relative flex h-7 items-center gap-1 pr-1 text-[12.5px]",
        "rounded-[6px] cursor-pointer select-none",
        "transition-colors duration-[100ms]",
        selected
          ? "bg-paper text-accent-ink font-semibold border border-accent-soft"
          : "border border-transparent text-ink-2 hover:bg-paper-3 hover:text-ink",
      )}
      style={{ paddingLeft: `${depth * INDENT_STEP + 4}px` }}
      onClick={(event) => {
        if (renaming) return;
        // Chevron + menu button stop propagation themselves; this is the
        // row-body click.
        if (event.defaultPrevented) return;
        onClick();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenu(event);
      }}
    >
      {/* Drop indicator lines — render above/below the row when the parent
          has set them. The "into" indicator paints the row background tinted
          accent-soft so the user sees a folder is going to receive a child. */}
      {dropIndicator === "before" ? (
        <span
          aria-hidden
          className="pointer-events-none absolute left-1 right-1 top-0 h-[2px] bg-accent"
        />
      ) : null}
      {dropIndicator === "after" ? (
        <span
          aria-hidden
          className="pointer-events-none absolute left-1 right-1 bottom-0 h-[2px] bg-accent"
        />
      ) : null}
      {dropIndicator === "into" ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[6px] border border-accent bg-accent-soft/40"
        />
      ) : null}

      {/* Chevron column — 14px wide. Folders get a real button; notes
          render an empty spacer so labels stay aligned with their parents. */}
      <div className="flex h-7 w-[14px] items-center justify-center">
        {isFolder && onToggleExpand ? (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleExpand();
            }}
            aria-label={expanded ? labels.collapse : labels.expand}
            className={cn(
              "grid h-4 w-4 place-items-center rounded-[4px] text-ink-3",
              "transition-colors hover:bg-paper-4 hover:text-ink",
            )}
            data-testid={`tree-toggle-${id}`}
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" aria-hidden />
            ) : (
              <ChevronRight className="h-3 w-3" aria-hidden />
            )}
          </button>
        ) : null}
      </div>

      {/* Type icon */}
      <div className="flex h-7 w-[16px] items-center justify-center text-ink-3 group-hover:text-ink-2">
        {isFolder ? (
          expanded ? (
            <FolderOpen className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Folder className="h-3.5 w-3.5" aria-hidden />
          )
        ) : (
          <FileText className="h-3.5 w-3.5" aria-hidden />
        )}
      </div>

      {/* Phase 6.9.8 — embedded-as-source dot. Notes only. Coarse signal:
          presence means a linked SourceRecord exists; we don't compute the
          dirty/synced state at the row level (the per-note toolbar button
          is the precise surface). Sparkles + emerald mirrors the embed-button
          synced palette + Sources-page "from note" badge, so the user sees
          one consistent visual language for "this note is in the RAG layer". */}
      {!isFolder && embedded ? (
        <span
          data-testid={`tree-embedded-dot-${id}`}
          data-embedded="true"
          title={labels.embeddedTooltip}
          aria-label={labels.embeddedTooltip}
          className="flex h-7 w-[12px] items-center justify-center text-emerald-500"
        >
          <Sparkles className="h-2.5 w-2.5" aria-hidden />
        </span>
      ) : null}

      {/* Label / inline rename input */}
      {renaming ? (
        <RenameInput
          initialValue={initialRenameValue ?? displayLabel}
          ariaLabelSave={labels.renameSave}
          ariaLabelCancel={labels.renameCancel}
          onCommit={(v) => onRenameCommit?.(v)}
          onCancel={() => onRenameCancel?.()}
        />
      ) : (
        <span className="flex-1 truncate" title={displayLabel}>
          {displayLabel}
        </span>
      )}

      {/* Hover-only menu button (always rendered for keyboard access) */}
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onMenuButtonClick(event);
        }}
        aria-label={labels.openMenu}
        className={cn(
          "grid h-5 w-5 place-items-center rounded-[4px] text-ink-3",
          "opacity-0 group-hover:opacity-100",
          "focus:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent",
          "hover:bg-paper-4 hover:text-ink",
        )}
        data-testid={`tree-menu-${id}`}
      >
        <MoreHorizontal className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
}

// Small helper so the row can call setDragPayload(...) with the right kind
// without exposing the import to every parent that wants to wrap the props.
export function buildDragStartHandler(
  payload: DragPayload,
  onAfter?: () => void,
): (event: ReactDragEvent) => void {
  return (event) => {
    setDragPayload(event.dataTransfer, payload);
    event.dataTransfer.effectAllowed = "move";
    onAfter?.();
  };
}

// Inline rename input — lives next to the label, autofocused, commits on
// Enter / blur, cancels on Escape. Kept inside the row so the drop target /
// drag handle / context menu state all stay co-located on the same DOM node.
function RenameInput({
  initialValue,
  ariaLabelSave,
  ariaLabelCancel,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  ariaLabelSave: string;
  ariaLabelCancel: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}): ReactNode {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.focus();
    // Select the basename without an extension so the user starts typing
    // straight into the meaningful part of the title.
    const dot = node.value.lastIndexOf(".");
    if (dot > 0) node.setSelectionRange(0, dot);
    else node.select();
  }, []);

  function commit(): void {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(value);
  }

  function cancel(): void {
    if (committedRef.current) return;
    committedRef.current = true;
    onCancel();
  }

  function onKey(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    } else {
      // Stop the global Escape listener inside the context menu / shell from
      // intercepting other keys.
      event.stopPropagation();
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKey}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      aria-label={`${ariaLabelSave} / ${ariaLabelCancel}`}
      data-testid="tree-rename-input"
      className={cn(
        "flex-1 min-w-0 rounded-[4px] border border-rule bg-paper px-1.5 text-[12.5px] text-ink",
        "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
        "h-5 leading-tight",
      )}
    />
  );
}
