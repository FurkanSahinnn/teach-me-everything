/**
 * CodeMirror 6 view-level commands that back the note editor toolbar (and
 * keyboard shortcuts). Pure markdown manipulation lives in `markdown-edits.ts`;
 * this layer turns those pure transforms into `view.dispatch` transactions.
 */

import { EditorSelection, type ChangeSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  type HeadingLevel,
  setHeadingLevel,
  toggleBlockquoteLine,
  toggleCheckboxLine,
  toggleOrderedListLine,
  toggleUnorderedListLine,
} from "./markdown-edits";

type LineTransform = (line: string, lineIdx: number) => string;

function dispatchLineTransform(
  view: EditorView,
  transform: LineTransform,
  userEvent: string,
): void {
  const { state } = view;
  const seen = new Set<number>();
  const changes: ChangeSpec[] = [];
  for (const r of state.selection.ranges) {
    const fromLine = state.doc.lineAt(r.from);
    const toLine = state.doc.lineAt(r.to);
    for (let n = fromLine.number; n <= toLine.number; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      const next = transform(line.text, n);
      if (next !== line.text) {
        changes.push({ from: line.from, to: line.to, insert: next });
      }
    }
  }
  if (changes.length > 0) {
    view.dispatch({ changes, userEvent });
  }
  view.focus();
}

export function setHeading(view: EditorView, level: HeadingLevel): void {
  dispatchLineTransform(view, (line) => setHeadingLevel(line, level), "input.markdown.heading");
}

export function toggleUnorderedList(view: EditorView): void {
  dispatchLineTransform(view, toggleUnorderedListLine, "input.markdown.list-ul");
}

export function toggleOrderedList(view: EditorView): void {
  let counter = 0;
  dispatchLineTransform(
    view,
    (line) => toggleOrderedListLine(line, ++counter),
    "input.markdown.list-ol",
  );
}

export function toggleCheckbox(view: EditorView): void {
  dispatchLineTransform(view, toggleCheckboxLine, "input.markdown.checkbox");
}

export function toggleBlockquote(view: EditorView): void {
  dispatchLineTransform(view, toggleBlockquoteLine, "input.markdown.blockquote");
}

function dispatchInlineToggle(view: EditorView, marker: string): void {
  const { state } = view;
  const text = state.doc.toString();
  const changes: ChangeSpec[] = [];
  const newRanges = [];

  for (const r of state.selection.ranges) {
    const before = text.slice(Math.max(0, r.from - marker.length), r.from);
    const after = text.slice(r.to, Math.min(text.length, r.to + marker.length));
    if (before === marker && after === marker) {
      changes.push({ from: r.from - marker.length, to: r.from, insert: "" });
      changes.push({ from: r.to, to: r.to + marker.length, insert: "" });
      newRanges.push(
        EditorSelection.range(r.from - marker.length, r.to - marker.length),
      );
    } else {
      changes.push({ from: r.from, insert: marker });
      changes.push({ from: r.to, insert: marker });
      newRanges.push(
        EditorSelection.range(r.from + marker.length, r.to + marker.length),
      );
    }
  }

  if (changes.length === 0) {
    view.focus();
    return;
  }

  view.dispatch({
    changes,
    selection: EditorSelection.create(newRanges, state.selection.mainIndex),
    userEvent: "input.markdown.inline",
  });
  view.focus();
}

export function toggleBold(view: EditorView): void {
  dispatchInlineToggle(view, "**");
}

export function toggleItalic(view: EditorView): void {
  dispatchInlineToggle(view, "_");
}

export function toggleStrike(view: EditorView): void {
  dispatchInlineToggle(view, "~~");
}

export function toggleInlineCode(view: EditorView): void {
  dispatchInlineToggle(view, "`");
}

export type InsertLinkOptions = {
  /** URL placeholder shown when no selection / URL is supplied. */
  placeholderUrl?: string;
  /** Label placeholder used when the selection is empty. */
  placeholderLabel?: string;
};

/**
 * Insert a markdown link `[label](url)` at the main cursor / selection.
 * Caret lands inside the parens so the user can paste / type the URL.
 */
export function insertLink(view: EditorView, opts: InsertLinkOptions = {}): void {
  const placeholderUrl = opts.placeholderUrl ?? "url";
  const placeholderLabel = opts.placeholderLabel ?? "text";
  const { state } = view;
  const r = state.selection.main;
  const sel = state.doc.sliceString(r.from, r.to);
  const label = sel.length > 0 ? sel : placeholderLabel;
  const insertText = `[${label}](${placeholderUrl})`;
  const urlAnchor = r.from + label.length + 3;
  const urlHead = urlAnchor + placeholderUrl.length;

  view.dispatch({
    changes: { from: r.from, to: r.to, insert: insertText },
    selection: EditorSelection.single(urlAnchor, urlHead),
    userEvent: "input.markdown.link",
  });
  view.focus();
}

/**
 * Insert a wikilink stub `[[]]` at the main cursor and place the caret between
 * the brackets. Phase 6.5 will hook autocomplete onto this so a popup of
 * matching notes / sources / concepts appears immediately.
 */
export function insertWikilinkStub(view: EditorView): void {
  const { state } = view;
  const r = state.selection.main;
  const insertText = "[[]]";
  view.dispatch({
    changes: { from: r.from, to: r.to, insert: insertText },
    selection: EditorSelection.single(r.from + 2),
    userEvent: "input.markdown.wikilink",
  });
  view.focus();
}
