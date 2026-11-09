"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  BookOpen,
  ChevronRight,
  FileCode,
  type LucideIcon,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PenLine,
} from "@/components/icons";
import type { NoteViewMode } from "@/lib/notes/editor-prefs";
import { cn } from "@/lib/utils/cn";

type Props = {
  /** Folder segments above the note, root first. */
  folders: string[];
  title: string;
  mode: NoteViewMode;
  onModeChange: (mode: NoteViewMode) => void;
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onToggleFocus: () => void;
  /** Note-level actions (embed as source, …) on the right. */
  actions?: ReactNode;
};

const MODES: Array<{ mode: NoteViewMode; icon: LucideIcon }> = [
  { mode: "live", icon: PenLine },
  { mode: "source", icon: FileCode },
  { mode: "reading", icon: BookOpen },
];

function HeaderIconButton({
  icon: Icon,
  label,
  onClick,
  pressed,
  className,
  testid,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  className?: string;
  testid?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      data-testid={testid}
      className={cn(
        "grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-ink-3 transition-colors hover:bg-paper-3 hover:text-ink",
        className,
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}

/**
 * Title bar of the editor pane: pane toggles, folder breadcrumb, the
 * live / source / reading switch and note actions.
 */
export function NoteHeader({
  folders,
  title,
  mode,
  onModeChange,
  leftOpen,
  rightOpen,
  onToggleLeft,
  onToggleRight,
  onToggleFocus,
  actions,
}: Props) {
  const t = useTranslations("notes.page");
  const focus = !leftOpen && !rightOpen;

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-rule px-2" data-testid="note-header">
      <HeaderIconButton
        icon={leftOpen ? PanelLeftClose : PanelLeftOpen}
        label={leftOpen ? t("collapse_left_panel") : t("expand_left_panel")}
        onClick={onToggleLeft}
        testid={leftOpen ? "notes-left-collapse" : "notes-left-expand"}
      />
      <nav aria-label={t("breadcrumb")} className="flex min-w-[80px] flex-1 items-center gap-1 overflow-hidden text-[13px]">
        {folders.map((folder, i) => (
          <span key={`${folder}-${i}`} className="flex min-w-0 shrink items-center gap-1 text-ink-4">
            <span className="truncate">{folder}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </span>
        ))}
        <span className="truncate font-medium text-ink" data-testid="note-header-title">
          {title}
        </span>
      </nav>

      <div
        role="radiogroup"
        aria-label={t("view_mode")}
        className="flex items-center rounded-[8px] border border-rule bg-paper-2 p-0.5"
      >
        {MODES.map(({ mode: m, icon: Icon }) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            title={`${t(`mode_${m}`)}${m === "reading" ? " (Ctrl+E)" : ""}`}
            aria-label={t(`mode_${m}`)}
            onClick={() => onModeChange(m)}
            data-testid={`note-mode-${m}`}
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-[6px] px-2 text-[12px] transition-colors",
              mode === m ? "bg-paper text-ink shadow-[var(--shadow-soft)]" : "text-ink-3 hover:text-ink",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden whitespace-nowrap 2xl:inline">{t(`mode_${m}`)}</span>
          </button>
        ))}
      </div>

      {actions ? <div className="flex items-center gap-1">{actions}</div> : null}

      <HeaderIconButton
        icon={focus ? Minimize2 : Maximize2}
        label={focus ? t("exit_focus_mode") : t("focus_mode")}
        onClick={onToggleFocus}
        pressed={focus}
        className="hidden lg:grid"
        testid="notes-focus-toggle"
      />
      <HeaderIconButton
        icon={rightOpen ? PanelRightClose : PanelRightOpen}
        label={rightOpen ? t("collapse_right_panel") : t("expand_right_panel")}
        onClick={onToggleRight}
        className="hidden lg:grid"
        testid="notes-right-toggle"
      />
    </div>
  );
}
