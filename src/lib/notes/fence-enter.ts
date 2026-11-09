/**
 * Enter on a freshly typed code fence closes it, like Obsidian.
 *
 * Without this, typing ```` ``` ```` + Enter leaves an unclosed fence: the
 * block swallows everything below it, and Enter inside it only adds more
 * numbered code lines, so there is no way out. When the caret ends an opening
 * fence that has no partner, insert the matching closing fence and put the
 * caret on the empty line between.
 */

import { EditorSelection, type EditorState, type StateCommand } from "@codemirror/state";

const FENCE_LINE_RE = /^([ \t]{0,3})(`{3,}|~{3,})(.*)$/;

type Fence = { indent: string; marker: string; info: string };

function parseFence(text: string): Fence | null {
  const m = FENCE_LINE_RE.exec(text);
  if (!m) return null;
  const marker = m[2] ?? "";
  const info = m[3] ?? "";
  // A backtick info string may not contain backticks (CommonMark).
  if (marker.startsWith("`") && info.includes("`")) return null;
  return { indent: m[1] ?? "", marker, info };
}

/** Fence lines of the same character as `marker`, by line number. */
function fenceLines(state: EditorState, char: string): number[] {
  const lines: number[] = [];
  for (let n = 1; n <= state.doc.lines; n += 1) {
    const fence = parseFence(state.doc.line(n).text);
    if (fence && fence.marker.startsWith(char)) lines.push(n);
  }
  return lines;
}

export const fenceAwareEnter: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main;
  if (state.selection.ranges.length > 1 || !range.empty) return false;
  const line = state.doc.lineAt(range.head);
  if (range.head !== line.to) return false;
  const fence = parseFence(line.text);
  if (!fence) return false;

  const char = fence.marker.charAt(0);
  const fences = fenceLines(state, char);
  const index = fences.indexOf(line.number);
  // Fences pair up in document order: an odd position is a closing fence,
  // and an even one with a partner later on is an already closed block.
  if (index % 2 === 1) return false;
  if (fences.length % 2 === 0) return false;

  const closing = `${fence.indent}${fence.marker}`;
  const insert = `\n${fence.indent}\n${closing}`;
  dispatch(
    state.update({
      changes: { from: line.to, insert },
      selection: EditorSelection.cursor(line.to + 1 + fence.indent.length),
      userEvent: "input",
      scrollIntoView: true,
    }),
  );
  return true;
};
