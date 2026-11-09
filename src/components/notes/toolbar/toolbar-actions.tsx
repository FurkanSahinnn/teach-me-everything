"use client";

import { redo, undo, indentLess, indentMore } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import type { ReactNode } from "react";
import {
  Baseline,
  Bold,
  Brackets,
  Code,
  Eraser,
  Heading,
  Highlighter,
  Image,
  Italic,
  LinkIcon,
  List,
  ListIndentDecrease,
  ListIndentIncrease,
  ListOrdered,
  ListTodo,
  type LucideIcon,
  MessageSquareQuote,
  Paintbrush,
  Quote,
  Redo2,
  SeparatorHorizontal,
  Sigma,
  SquareCode,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  Underline,
  Undo2,
  Asterisk,
} from "@/components/icons";
import type { ToolbarItemId } from "@/lib/notes/editor-prefs";
import {
  applyBackgroundColor,
  applyTextColor,
  clearFormatting,
  removeColor,
  setAlignment,
  toggleHighlight,
  toggleSubscript,
  toggleSuperscript,
  toggleUnderline,
} from "@/lib/notes/format-commands";
import type { Align, FormatState } from "@/lib/notes/format-edits";
import {
  CALLOUT_TYPES,
  insertCallout,
  insertCodeBlock,
  insertFootnote,
  insertHorizontalRule,
  insertImage,
  insertInlineMath,
  insertMathBlock,
  insertTable,
} from "@/lib/notes/insert-commands";
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
import { ColorPalette } from "./ColorPalette";
import { TableGridPicker } from "./TableGridPicker";

type Translate = (key: string, values?: Record<string, string | number>) => string;

export type ToolbarContext = {
  formats: FormatState | null;
  canUndo: boolean;
  canRedo: boolean;
  painterActive: boolean;
  onTogglePainter: () => void;
  textColors: readonly string[];
  backgroundColors: readonly string[];
  recentColors: readonly string[];
  /** Remembered so the split buttons re-apply the last pick in one click. */
  lastTextColor: string;
  lastBackgroundColor: string;
  onColorUsed: (kind: "text" | "background", color: string) => void;
  t: Translate;
  /** Platform-aware modifier label, e.g. "Ctrl" or "⌘". */
  mod: string;
};

type Run = (view: EditorView) => void;

export type ToolbarButtonDef = {
  kind: "button";
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  run: Run;
};

export type ToolbarMenuDef = {
  kind: "menu";
  icon: LucideIcon;
  label: string;
  active?: boolean;
  /** Colour bar under the icon (text / highlight colour menus). */
  swatch?: string;
  /** Split button: clicking the icon runs this, the chevron opens the menu. */
  primary?: Run;
  width?: number;
  renderMenu: (view: EditorView, close: () => void) => ReactNode;
};

export type ToolbarItemDef = ToolbarButtonDef | ToolbarMenuDef;

function MenuRow({
  icon: Icon,
  label,
  hint,
  active,
  onClick,
  children,
}: {
  icon?: LucideIcon;
  label: string;
  hint?: string;
  active?: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink",
        active && "bg-accent-wash text-ink",
      )}
    >
      {Icon ? <Icon className="h-4 w-4 shrink-0 text-ink-3" aria-hidden /> : null}
      <span className="flex-1 truncate">{children ?? label}</span>
      {hint ? <span className="text-[11px] tabular-nums text-ink-4">{hint}</span> : null}
    </button>
  );
}

const HEADING_PREVIEW: Record<number, string> = {
  1: "text-[19px] font-semibold font-serif",
  2: "text-[17px] font-semibold font-serif",
  3: "text-[15.5px] font-semibold font-serif",
  4: "text-[14.5px] font-semibold",
  5: "text-[13.5px] font-semibold",
  6: "text-[12.5px] font-semibold uppercase tracking-wide",
};

const ALIGN_ICONS: Record<Align, LucideIcon> = {
  left: TextAlignStart,
  center: TextAlignCenter,
  right: TextAlignEnd,
  justify: TextAlignJustify,
};

/** Build the definition for one toolbar command id. */
export function buildToolbarItem(id: ToolbarItemId, ctx: ToolbarContext): ToolbarItemDef {
  const { t, formats: f, mod } = ctx;
  switch (id) {
    case "undo":
      return { kind: "button", icon: Undo2, label: t("undo"), shortcut: `${mod}+Z`, disabled: !ctx.canUndo, run: (v) => void undo(v) };
    case "redo":
      return { kind: "button", icon: Redo2, label: t("redo"), shortcut: `${mod}+Shift+Z`, disabled: !ctx.canRedo, run: (v) => void redo(v) };
    case "formatPainter":
      return { kind: "button", icon: Paintbrush, label: t("format_painter"), active: ctx.painterActive, run: () => ctx.onTogglePainter() };
    case "clearFormatting":
      return { kind: "button", icon: Eraser, label: t("clear_formatting"), run: (v) => void clearFormatting(v) };
    case "heading":
      return {
        kind: "menu",
        icon: Heading,
        label: t("heading"),
        active: (f?.heading ?? 0) > 0,
        width: 220,
        renderMenu: (view, close) => (
          <div role="menu" className="flex flex-col">
            <MenuRow label={t("paragraph")} active={(f?.heading ?? 0) === 0} onClick={() => { if (f && f.heading > 0) setHeading(view, f.heading); close(); }} />
            {([1, 2, 3, 4, 5, 6] as const).map((level) => (
              <MenuRow
                key={level}
                label={t("heading_n", { level })}
                hint={`H${level}`}
                active={f?.heading === level}
                onClick={() => {
                  setHeading(view, level);
                  close();
                }}
              >
                <span className={HEADING_PREVIEW[level]}>{t("heading_n", { level })}</span>
              </MenuRow>
            ))}
          </div>
        ),
      };
    case "bold":
      return { kind: "button", icon: Bold, label: t("bold"), shortcut: `${mod}+B`, active: !!f?.bold, run: toggleBold };
    case "italic":
      return { kind: "button", icon: Italic, label: t("italic"), shortcut: `${mod}+I`, active: !!f?.italic, run: toggleItalic };
    case "underline":
      return { kind: "button", icon: Underline, label: t("underline"), shortcut: `${mod}+U`, active: !!f?.underline, run: (v) => void toggleUnderline(v) };
    case "strike":
      return { kind: "button", icon: Strikethrough, label: t("strike"), shortcut: `${mod}+Shift+X`, active: !!f?.strike, run: toggleStrike };
    case "highlight":
      return {
        kind: "menu",
        icon: Highlighter,
        label: t("highlight"),
        active: !!f?.highlight || !!f?.background,
        swatch: f?.background ?? ctx.lastBackgroundColor,
        primary: (v) => void toggleHighlight(v),
        renderMenu: (view, close) => (
          <div className="flex flex-col gap-1">
            <MenuRow icon={Highlighter} label={t("highlight_marks")} hint={`${mod}+Shift+H`} active={!!f?.highlight} onClick={() => { toggleHighlight(view); close(); }} />
            <div className="px-1 pt-1 text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink-4">{t("highlight_color")}</div>
            <ColorPalette
              colors={ctx.backgroundColors}
              recent={ctx.recentColors}
              active={f?.background ?? null}
              variant="background"
              onPick={(c) => {
                if (applyBackgroundColor(view, c)) ctx.onColorUsed("background", c);
                close();
              }}
              onRemove={() => {
                removeColor(view);
                close();
              }}
            />
          </div>
        ),
      };
    case "textColor":
      return {
        kind: "menu",
        icon: Baseline,
        label: t("text_color"),
        active: !!f?.color,
        swatch: f?.color ?? ctx.lastTextColor,
        primary: (v) => {
          if (applyTextColor(v, ctx.lastTextColor)) ctx.onColorUsed("text", ctx.lastTextColor);
        },
        renderMenu: (view, close) => (
          <ColorPalette
            colors={ctx.textColors}
            recent={ctx.recentColors}
            active={f?.color ?? null}
            variant="text"
            onPick={(c) => {
              if (applyTextColor(view, c)) ctx.onColorUsed("text", c);
              close();
            }}
            onRemove={() => {
              removeColor(view);
              close();
            }}
          />
        ),
      };
    case "superscript":
      return { kind: "button", icon: Superscript, label: t("superscript"), active: !!f?.sup, run: (v) => void toggleSuperscript(v) };
    case "subscript":
      return { kind: "button", icon: Subscript, label: t("subscript"), active: !!f?.sub, run: (v) => void toggleSubscript(v) };
    case "inlineCode":
      return { kind: "button", icon: Code, label: t("code"), shortcut: `${mod}+\``, active: !!f?.code, run: toggleInlineCode };
    case "bulletList":
      return { kind: "button", icon: List, label: t("list_unordered"), active: f?.list === "ul", run: toggleUnorderedList };
    case "orderedList":
      return { kind: "button", icon: ListOrdered, label: t("list_ordered"), active: f?.list === "ol", run: toggleOrderedList };
    case "taskList":
      return { kind: "button", icon: ListTodo, label: t("checkbox"), shortcut: `${mod}+Enter`, active: f?.list === "task", run: toggleCheckbox };
    case "outdent":
      return { kind: "button", icon: ListIndentDecrease, label: t("outdent"), shortcut: "Shift+Tab", run: (v) => { indentLess(v); v.focus(); } };
    case "indent":
      return { kind: "button", icon: ListIndentIncrease, label: t("indent"), shortcut: "Tab", run: (v) => { indentMore(v); v.focus(); } };
    case "align":
      return {
        kind: "menu",
        icon: TextAlignStart,
        label: t("align"),
        width: 200,
        renderMenu: (view, close) => (
          <div role="menu" className="flex flex-col">
            {(["left", "center", "right", "justify"] as const).map((a) => (
              <MenuRow key={a} icon={ALIGN_ICONS[a]} label={t(`align_${a}`)} onClick={() => { setAlignment(view, a === "left" ? null : a); close(); }} />
            ))}
          </div>
        ),
      };
    case "blockquote":
      return { kind: "button", icon: Quote, label: t("blockquote"), active: !!f?.quote, run: toggleBlockquote };
    case "callout":
      return {
        kind: "menu",
        icon: MessageSquareQuote,
        label: t("callout"),
        width: 210,
        renderMenu: (view, close) => (
          <div role="menu" className="flex max-h-[320px] flex-col overflow-y-auto">
            {CALLOUT_TYPES.map((type) => (
              <MenuRow key={type} label={t(`callout_${type}`)} hint={type} onClick={() => { insertCallout(view, type); close(); }} />
            ))}
          </div>
        ),
      };
    case "codeBlock":
      return { kind: "button", icon: SquareCode, label: t("code_block"), run: (v) => insertCodeBlock(v) };
    case "table":
      return {
        kind: "menu",
        icon: Table,
        label: t("table"),
        renderMenu: (view, close) => (
          <TableGridPicker
            onPick={(rows, cols) => {
              insertTable(view, rows, cols, (n) => t("table_header", { n }));
              close();
            }}
          />
        ),
      };
    case "horizontalRule":
      return { kind: "button", icon: SeparatorHorizontal, label: t("horizontal_rule"), run: insertHorizontalRule };
    case "link":
      return {
        kind: "button",
        icon: LinkIcon,
        label: t("link"),
        shortcut: `${mod}+K`,
        run: (v) => insertLink(v, { placeholderUrl: t("link_placeholder_url"), placeholderLabel: t("link_placeholder_label") }),
      };
    case "wikilink":
      return { kind: "button", icon: Brackets, label: t("wikilink"), run: insertWikilinkStub };
    case "image":
      return { kind: "button", icon: Image, label: t("image"), run: (v) => insertImage(v, t("image_placeholder_url")) };
    case "math":
      return {
        kind: "menu",
        icon: Sigma,
        label: t("math"),
        primary: insertInlineMath,
        width: 200,
        renderMenu: (view, close) => (
          <div role="menu" className="flex flex-col">
            <MenuRow label={t("math_inline")} hint="$…$" onClick={() => { insertInlineMath(view); close(); }} />
            <MenuRow label={t("math_block")} hint="$$…$$" onClick={() => { insertMathBlock(view); close(); }} />
          </div>
        ),
      };
    case "footnote":
      return { kind: "button", icon: Asterisk, label: t("footnote"), run: insertFootnote };
  }
}
