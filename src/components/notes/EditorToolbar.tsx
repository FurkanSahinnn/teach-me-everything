"use client";

import {
  Bold,
  Brackets,
  CheckSquare,
  Code,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ButtonHTMLAttributes, type ReactNode } from "react";
import type { EditorView } from "@codemirror/view";
import {
  insertLink,
  insertWikilinkStub,
  setHeading,
  toggleBlockquote,
  toggleBold,
  toggleCheckbox,
  toggleInlineCode,
  toggleItalic,
  toggleOrderedList,
  toggleStrike,
  toggleUnorderedList,
} from "@/lib/notes/toolbar-commands";
import { cn } from "@/lib/utils/cn";

export type EditorToolbarProps = {
  /**
   * Returns the live `EditorView` instance — buttons read this on click so
   * they always operate on the current state without forcing the toolbar to
   * re-render whenever the CM6 view fires an update.
   */
  getView: () => EditorView | null;
  /**
   * Optional right-aligned actions appended after the standard formatting
   * controls. Phase 6.9.4 uses this slot for the "Embed as source" button;
   * future surfaces (mode switcher, export, …) can hang off the same seam
   * without bloating the toolbar's required props.
   */
  trailingActions?: ReactNode;
  className?: string;
};

export function EditorToolbar({
  getView,
  trailingActions,
  className,
}: EditorToolbarProps) {
  const t = useTranslations("notes.editor.toolbar");
  const tEditor = useTranslations("notes.editor");

  function dispatch(action: (view: EditorView) => void) {
    return () => {
      const view = getView();
      if (view) action(view);
    };
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-0.5 border-b border-rule bg-paper-2/40 px-2 py-1.5",
        className,
      )}
      role="toolbar"
      aria-label={t("bold")}
    >
      <ToolbarButton
        aria-label={t("heading_2")}
        icon={<Heading2 className="h-4 w-4" />}
        onClick={dispatch((v) => setHeading(v, 2))}
      />
      <ToolbarButton
        aria-label={t("heading_3")}
        icon={<Heading3 className="h-4 w-4" />}
        onClick={dispatch((v) => setHeading(v, 3))}
      />
      <ToolbarDivider />
      <ToolbarButton
        aria-label={t("bold")}
        icon={<Bold className="h-4 w-4" />}
        onClick={dispatch(toggleBold)}
      />
      <ToolbarButton
        aria-label={t("italic")}
        icon={<Italic className="h-4 w-4" />}
        onClick={dispatch(toggleItalic)}
      />
      <ToolbarButton
        aria-label={t("strike")}
        icon={<Strikethrough className="h-4 w-4" />}
        onClick={dispatch(toggleStrike)}
      />
      <ToolbarButton
        aria-label={t("code")}
        icon={<Code className="h-4 w-4" />}
        onClick={dispatch(toggleInlineCode)}
      />
      <ToolbarDivider />
      <ToolbarButton
        aria-label={t("list_unordered")}
        icon={<List className="h-4 w-4" />}
        onClick={dispatch(toggleUnorderedList)}
      />
      <ToolbarButton
        aria-label={t("list_ordered")}
        icon={<ListOrdered className="h-4 w-4" />}
        onClick={dispatch(toggleOrderedList)}
      />
      <ToolbarButton
        aria-label={t("checkbox")}
        icon={<CheckSquare className="h-4 w-4" />}
        onClick={dispatch(toggleCheckbox)}
      />
      <ToolbarButton
        aria-label={t("blockquote")}
        icon={<Quote className="h-4 w-4" />}
        onClick={dispatch(toggleBlockquote)}
      />
      <ToolbarDivider />
      <ToolbarButton
        aria-label={t("link")}
        icon={<LinkIcon className="h-4 w-4" />}
        onClick={dispatch((v) =>
          insertLink(v, {
            placeholderUrl: tEditor("link_placeholder_url"),
            placeholderLabel: tEditor("link_placeholder_label"),
          }),
        )}
      />
      <ToolbarButton
        aria-label={t("wikilink")}
        icon={<Brackets className="h-4 w-4" />}
        onClick={dispatch(insertWikilinkStub)}
      />
      {trailingActions ? (
        <>
          <div className="flex-1" />
          {trailingActions}
        </>
      ) : null}
    </div>
  );
}

function ToolbarDivider() {
  return <div aria-hidden className="mx-1 h-5 w-px shrink-0 bg-rule-strong/60" />;
}

type ToolbarButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
};

function ToolbarButton({ icon, className, ...rest }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={rest["aria-label"]}
      {...rest}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-ink-3",
        "transition-colors duration-150",
        "hover:bg-paper-3 hover:text-ink",
        "active:bg-paper-4",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {icon}
    </button>
  );
}
