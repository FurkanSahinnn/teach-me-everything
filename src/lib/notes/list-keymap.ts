/**
 * Obsidian-style Enter inside markdown lists.
 *
 * CodeMirror's `insertNewlineContinueMarkup` turns Enter on an empty nested
 * item into a blank line holding a single space while keeping the marker, so
 * leaving a sub-list took three presses and left `" "` lines behind. Obsidian
 * instead outdents an empty nested item one level, and clears the marker of an
 * empty top-level item. This command handles exactly those empty-item cases
 * and delegates everything else to CodeMirror.
 */

import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { indentUnit } from "@codemirror/language";
import { EditorSelection, Prec, type StateCommand } from "@codemirror/state";
import { keymap } from "@codemirror/view";

// indent, marker (bullet or ordered with . or )), optional task box, nothing else.
const EMPTY_ITEM_RE = /^([ \t]*)([-*+]|(\d+)([.)]))[ \t]+(\[[ xX]\][ \t]*)?$/;
const ORDERED_LINE_RE = /^([ \t]*)(\d+)([.)])[ \t]/;

function indentWidth(indent: string, tabSize: number): number {
  let width = 0;
  for (const ch of indent) width += ch === "\t" ? tabSize - (width % tabSize) : 1;
  return width;
}

export const listAwareEnter: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main;
  if (state.selection.ranges.length > 1 || !range.empty) {
    return insertNewlineContinueMarkup({ state, dispatch });
  }
  const line = state.doc.lineAt(range.head);
  if (range.head !== line.to) return insertNewlineContinueMarkup({ state, dispatch });
  const match = EMPTY_ITEM_RE.exec(line.text);
  if (!match) return insertNewlineContinueMarkup({ state, dispatch });

  const indent = match[1] ?? "";
  const tabSize = state.tabSize;
  const width = indentWidth(indent, tabSize);

  if (width === 0) {
    // Empty top-level item: drop the marker and leave a blank line, otherwise
    // the next paragraph is a lazy continuation of the last item in markdown.
    dispatch(
      state.update({
        changes: { from: line.from, to: line.to, insert: "\n" },
        selection: EditorSelection.cursor(line.from + 1),
        userEvent: "input",
        scrollIntoView: true,
      }),
    );
    return true;
  }

  // Empty nested item: move it to the parent's indentation, i.e. the nearest
  // previous list line that is indented less than this one.
  let parentIndent = "";
  let parentOrdinal: number | null = null;
  for (let n = line.number - 1; n >= 1; n -= 1) {
    const text = state.doc.line(n).text;
    if (text.trim() === "") continue;
    const lead = /^[ \t]*/.exec(text)?.[0] ?? "";
    if (indentWidth(lead, tabSize) < width) {
      parentIndent = lead;
      const ordered = ORDERED_LINE_RE.exec(text);
      parentOrdinal = ordered ? Number.parseInt(ordered[2] ?? "0", 10) : null;
      break;
    }
  }
  const unit = state.facet(indentUnit);
  const fallbackIndent = indent.slice(0, Math.max(0, indent.length - unit.length));
  const newIndent = parentIndent.length > 0 || parentOrdinal !== null ? parentIndent : fallbackIndent;

  let marker = match[2] ?? "-";
  if (match[3] !== undefined) {
    marker = `${parentOrdinal !== null ? parentOrdinal + 1 : 1}${match[4] ?? "."}`;
  }
  const insert = `${newIndent}${marker} ${match[5] ? "[ ] " : ""}`;
  dispatch(
    state.update({
      changes: { from: line.from, to: line.to, insert },
      selection: EditorSelection.cursor(line.from + insert.length),
      userEvent: "input",
      scrollIntoView: true,
    }),
  );
  return true;
};

/**
 * Enter binding that outranks the markdown language keymap. That keymap is
 * itself `Prec.high` and registered earlier, so `high` here would lose the tie.
 */
export const listKeymap = Prec.highest(keymap.of([{ key: "Enter", run: listAwareEnter }]));
