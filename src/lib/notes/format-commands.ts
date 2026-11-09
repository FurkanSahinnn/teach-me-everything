/**
 * CodeMirror dispatch layer over the pure transforms in `format-edits.ts`.
 * Every command returns whether the document changed, works on every
 * selection range, moves the selection to follow the edit and refocuses the
 * editor so toolbar clicks do not steal focus.
 */

import { EditorSelection, type ChangeSpec, type SelectionRange } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  type Align,
  type EditResult,
  type FormatState,
  clearFormatting as clearFormattingText,
  detectFormats,
  removeColorAt,
  setAlignment as setAlignmentLine,
  toggleHighlightMarks,
  toggleHtmlTag,
  wrapWithBackground,
  wrapWithColor,
} from "./format-edits";

export type RangeTransform = (text: string, from: number, to: number) => EditResult;

type WindowEdit = { from: number; to: number; insert: string };

/** Smallest single replacement that turns `before` into `after`. */
function diffWindow(before: string, after: string): WindowEdit {
  const max = Math.min(before.length, after.length);
  let start = 0;
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start += 1;
  let endB = before.length;
  let endA = after.length;
  while (endB > start && endA > start && before.charCodeAt(endB - 1) === after.charCodeAt(endA - 1)) {
    endB -= 1;
    endA -= 1;
  }
  return { from: start, to: endB, insert: after.slice(start, endA) };
}

/**
 * Run `transform` for each selection range and dispatch one transaction.
 * Ranges are computed independently against the original text; a range whose
 * edit window would overlap an earlier one is skipped rather than corrupting
 * the transaction.
 */
export function dispatchRangeEdits(
  view: EditorView,
  transform: RangeTransform,
  userEvent: string,
): boolean {
  const { state } = view;
  const text = state.doc.toString();
  const changes: ChangeSpec[] = [];
  const ranges: SelectionRange[] = [];
  let delta = 0;
  let lastEnd = -1;

  for (const r of state.selection.ranges) {
    const res = transform(text, r.from, r.to);
    if (res.text === text) {
      ranges.push(EditorSelection.range(r.anchor + delta, r.head + delta));
      continue;
    }
    const win = diffWindow(text, res.text);
    if (win.from < lastEnd) {
      ranges.push(EditorSelection.range(r.anchor + delta, r.head + delta));
      continue;
    }
    changes.push(win);
    ranges.push(EditorSelection.range(res.from + delta, res.to + delta));
    delta += win.insert.length - (win.to - win.from);
    lastEnd = win.to;
  }

  view.focus();
  if (changes.length === 0) return false;
  view.dispatch({
    changes,
    selection: EditorSelection.create(ranges, state.selection.mainIndex),
    userEvent,
  });
  return true;
}

export function applyTextColor(view: EditorView, color: string): boolean {
  return dispatchRangeEdits(view, (t, f, e) => wrapWithColor(t, f, e, color), "input.format.color");
}

export function applyBackgroundColor(view: EditorView, color: string): boolean {
  return dispatchRangeEdits(
    view,
    (t, f, e) => wrapWithBackground(t, f, e, color),
    "input.format.background",
  );
}

export function removeColor(view: EditorView): boolean {
  return dispatchRangeEdits(view, removeColorAt, "input.format.color-remove");
}

export function toggleUnderline(view: EditorView): boolean {
  return dispatchRangeEdits(view, (t, f, e) => toggleHtmlTag(t, f, e, "u"), "input.format.underline");
}

export function toggleSuperscript(view: EditorView): boolean {
  return dispatchRangeEdits(view, (t, f, e) => toggleHtmlTag(t, f, e, "sup"), "input.format.sup");
}

export function toggleSubscript(view: EditorView): boolean {
  return dispatchRangeEdits(view, (t, f, e) => toggleHtmlTag(t, f, e, "sub"), "input.format.sub");
}

export function toggleHighlight(view: EditorView): boolean {
  return dispatchRangeEdits(view, toggleHighlightMarks, "input.format.highlight");
}

export function clearFormatting(view: EditorView): boolean {
  return dispatchRangeEdits(view, clearFormattingText, "input.format.clear");
}

/** Align every line touched by a selection; `null` removes alignment. */
export function setAlignment(view: EditorView, align: Align | null): boolean {
  const { state } = view;
  const seen = new Set<number>();
  const changes: ChangeSpec[] = [];
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n += 1) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      const next = setAlignmentLine(line.text, align);
      if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next });
    }
  }
  view.focus();
  if (changes.length === 0) return false;
  view.dispatch({ changes, userEvent: "input.format.align" });
  return true;
}

/** Formatting state at the main selection, for toolbar active styling. */
export function getActiveFormats(view: EditorView): FormatState {
  const { state } = view;
  const main = state.selection.main;
  return detectFormats(state.doc.toString(), main.from, main.to);
}
