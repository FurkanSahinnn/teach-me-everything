"use client";

import {
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils/cn";

export type ContextMenuKind = "folder" | "note";

export type ContextMenuAction =
  | "new_note"
  | "new_folder"
  | "rename"
  | "delete";

export type NoteTreeContextMenuProps = {
  open: boolean;
  /** Viewport-relative coordinates of the right-click. */
  anchor: { x: number; y: number } | null;
  kind: ContextMenuKind;
  labels: Record<ContextMenuAction, string>;
  onSelect: (action: ContextMenuAction) => void;
  onClose: () => void;
};

type Item = {
  action: ContextMenuAction;
  icon: LucideIcon;
  destructive?: boolean;
};

const FOLDER_ITEMS: Item[] = [
  { action: "new_note", icon: FilePlus },
  { action: "new_folder", icon: FolderPlus },
  { action: "rename", icon: Pencil },
  { action: "delete", icon: Trash2, destructive: true },
];

const NOTE_ITEMS: Item[] = [
  { action: "rename", icon: Pencil },
  { action: "delete", icon: Trash2, destructive: true },
];

const MENU_WIDTH = 200;
const MENU_PADDING = 6;

export function NoteTreeContextMenu({
  open,
  anchor,
  kind,
  labels,
  onSelect,
  onClose,
}: NoteTreeContextMenuProps): ReactNode {
  const items = kind === "folder" ? FOLDER_ITEMS : NOTE_ITEMS;
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(
    null,
  );

  // Stabilise onClose so the global click listener doesn't tear down on
  // every parent render — same pattern the Modal uses.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Compute final position after the menu has measured itself, so we can
  // flip when the click happens near the right or bottom edge of the
  // viewport. Without this a right-click on the last row would render the
  // menu off-screen.
  useLayoutEffect(() => {
    if (!open || !anchor) {
      setPosition(null);
      return;
    }
    const node = menuRef.current;
    const height = node?.offsetHeight ?? 200;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
    const vh = typeof window !== "undefined" ? window.innerHeight : 768;
    let left = anchor.x;
    let top = anchor.y;
    if (left + MENU_WIDTH + MENU_PADDING > vw) {
      left = Math.max(MENU_PADDING, vw - MENU_WIDTH - MENU_PADDING);
    }
    if (top + height + MENU_PADDING > vh) {
      top = Math.max(MENU_PADDING, vh - height - MENU_PADDING);
    }
    setPosition({ left, top });
  }, [open, anchor]);

  // Click-outside + Escape close.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      const node = menuRef.current;
      if (node && event.target instanceof Node && node.contains(event.target)) {
        return;
      }
      onCloseRef.current();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    // mousedown so the close fires before the next click resolves a button.
    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("contextmenu", onPointerDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("contextmenu", onPointerDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (!open || !anchor || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      data-testid="note-tree-context-menu"
      className={cn(
        "fixed z-[60] w-[200px] rounded-[10px] border border-rule bg-paper shadow-[var(--shadow-lifted)]",
        "py-1 text-[13px] text-ink",
        position ? "" : "invisible",
      )}
      style={{
        left: position?.left ?? anchor.x,
        top: position?.top ?? anchor.y,
      }}
    >
      {items.map((item, idx) => {
        const Icon = item.icon;
        const showDivider = item.destructive && idx > 0;
        return (
          <div key={item.action}>
            {showDivider ? (
              <div className="my-1 h-px bg-rule" aria-hidden />
            ) : null}
            <button
              type="button"
              role="menuitem"
              data-action={item.action}
              onClick={() => {
                onSelect(item.action);
                onClose();
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left",
                "transition-colors duration-[120ms]",
                item.destructive
                  ? "text-rose-600 hover:bg-rose-50/70 dark:hover:bg-rose-950/40"
                  : "hover:bg-paper-3",
                "focus:bg-paper-3 focus:outline-none",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              <span className="flex-1 truncate">{labels[item.action]}</span>
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
